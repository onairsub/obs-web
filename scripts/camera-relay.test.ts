import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { fork, spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { HostClocks } from "../src/components/obs/clockSync";
import { REMOTE_PROTOCOL_VERSION, type RemoteServerMessage } from "../src/components/remote/remoteProtocol";

test("local JPEG → real OCR → Python client → relay → authoritative host", { timeout: 30000 }, async (t) => {
  const relay = fork(new URL("./clock-relay-server.ts", import.meta.url), [], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: { ...process.env, CLOCK_TEST_REDIS_URL: "" },
  });
  t.after(() => relay.kill());
  const [{ port: relayPort }] = await once(relay, "message");
  const socket = new WebSocket(`ws://127.0.0.1:${relayPort}`);
  t.after(() => socket.terminate());
  await once(socket, "open");
  const sessionId = randomBytes(16).toString("hex");
  const host = new HostClocks(randomUUID(), Date.now, () => 24, () => null, () => {});
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as RemoteServerMessage;
    if (message.type === "clock-sync") socket.send(JSON.stringify({ type: "clock-state", snapshot: host.snapshot(), replyTo: message.requestId }));
    if (message.type === "clock-command") {
      const next = host.receive(message.command);
      if (next) socket.send(JSON.stringify({ type: "clock-state", snapshot: next }));
    }
  });
  const joined = once(socket, "message");
  socket.send(JSON.stringify({ type: "join", role: "host", sessionId, hostSecret: randomBytes(24).toString("hex"), clientId: randomUUID(), protocolVersion: REMOTE_PROTOCOL_VERSION }));
  await joined;
  const temporary = createServer();
  temporary.listen(0, "127.0.0.1"); await once(temporary, "listening");
  const port = (temporary.address() as { port: number }).port;
  await new Promise<void>(resolve => temporary.close(() => resolve()));
  const python = "local-clock/.venv/bin/python";
  const app = spawn(python, ["local-clock/app.py", "--port", String(port)], { stdio: "ignore" });
  t.after(() => app.kill());
  const origin = `http://127.0.0.1:${port}`;
  let token = "";
  for (let i = 0; i < 100 && !token; i++) {
    try { token = (await (await fetch(origin)).text()).match(/name="local-token" content="([^"]+)"/)?.[1] ?? ""; } catch { /* starting */ }
    if (!token) await delay(50);
  }
  assert.ok(token, "local server started");
  assert.equal((await fetch(`${origin}/api/status`)).status, 403);
  async function json(path: string, body?: unknown) {
    const response = await fetch(origin + path, { headers: { "X-Local-Token": token, "Content-Type": "application/json" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  await json("/api/connect", { link: `http://127.0.0.1:${relayPort}/obs/remote/${sessionId}` });
  for (let i = 0; i < 100; i++) {
    const state = await json("/api/status");
    if (state.connected && state.model_ready) break;
    await delay(50);
  }
  assert.equal((await json("/api/status")).connected, true);
  const jpg = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "50.1"]);
  const blank = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", ""]);
  const minutes = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "7:00"]);
  let generation = (await json("/api/settings", { enabled: false, maximum: 60 })).generation;
  async function frame(image = jpg, stale = false, version = generation) {
    const { now_ms } = await json("/api/status");
    const response = await fetch(origin + "/api/frame", { method: "POST", body: image,
      headers: { "X-Local-Token": token, "Content-Type": "image/jpeg", "X-Captured-Ms": String(now_ms - (stale ? 1500 : 0)), "X-Generation": String(version) } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  assert.equal((await frame()).reading.seconds, 50.1);
  await delay(100);
  assert.equal((await frame()).sent, false, "preview never writes to host");
  assert.equal(host.snapshot().revision, 0);
  generation = (await json("/api/settings", { enabled: true, maximum: 60, mode: "hold" })).generation;
  assert.equal((await frame()).sent, false, "first read needs confirmation");
  await delay(150);
  assert.equal((await frame()).sent, true);
  for (let i = 0; i < 20 && host.snapshot().revision === 0; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 50100);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running, false);
  assert.deepEqual(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.observedDisplay, { format: "seconds", resolutionMs: 100 });
  const revision = host.snapshot().revision;
  await delay(100);
  assert.equal((await frame()).sent, true);
  await delay(50);
  assert.equal(host.snapshot().revision, revision, "equal observations do not reset the host");
  assert.equal((await frame(blank)).sent, false);
  assert.equal((await frame(jpg, true)).accepted, false);
  assert.equal((await frame(jpg, false, generation - 1)).accepted, false);
  assert.equal(host.snapshot().revision, revision, "blank/stale/config-changed frames do not write");
  const overLimit = await frame(minutes);
  assert.equal(overLimit.reading.text, "7:00", "range limit must not hide a successfully recognized clock");
  assert.equal(overLimit.reading.seconds, 420);
  assert.equal(overLimit.sent, false);
  assert.equal(overLimit.accepted, false);
  assert.match(overLimit.reason, /420.*60/);
  assert.match(overLimit.raw_text, /7:00/);
  assert.equal(host.snapshot().revision, revision);

  generation = (await json("/api/settings", { enabled: true, maximum: 1200, key: "OBS_BASKETBALL_GAME_CLOCK" })).generation;
  assert.equal((await frame(minutes)).sent, false);
  await delay(150);
  assert.equal((await frame(minutes)).sent, true);
  for (let i = 0; i < 20 && host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs !== 420000; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 420000);
  assert.deepEqual(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.observedDisplay, { format: "minutes", resolutionMs: 1000 });
  await json("/api/settings", { enabled: false });
});
