import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { fork, spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { HostClocks, clockValue } from "../src/components/obs/clockSync";
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
  async function frame(image = jpg, stale = false, version = generation, key?: string) {
    const { now_ms } = await json("/api/status");
    const response = await fetch(origin + "/api/frame", { method: "POST", body: image,
      headers: { "X-Local-Token": token, "Content-Type": "image/jpeg", "X-Captured-Ms": String(now_ms - (stale ? 1500 : 0)), "X-Generation": String(version), ...(key ? { "X-Clock-Key": key } : {}) } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  assert.equal((await frame()).reading.seconds, 50.1);
  await delay(100);
  assert.equal((await frame()).sent, false, "preview never writes to host");
  assert.equal(host.snapshot().revision, 0);
  host.apply("OBS_BASKETBALL_SHOT_CLOCK", { action: "start" });
  const startedRevision = host.snapshot().revision;
  generation = (await json("/api/settings", { enabled: true, maximum: 60, mode: "preserve" })).generation;
  assert.equal((await frame()).sent, false, "first read needs confirmation");
  await delay(150);
  assert.equal((await frame()).sent, false, "two frames cannot establish a new value");
  await delay(150);
  assert.equal((await frame()).sent, true);
  for (let i = 0; i < 20 && host.snapshot().revision === startedRevision; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 50100);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running, false, "decimal observations stop playback even in preserve mode");
  assert.deepEqual(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.observedDisplay, { format: "seconds", resolutionMs: 100 });
  const revision = host.snapshot().revision;
  await delay(100);
  assert.equal((await frame()).sent, true);
  await delay(50);
  assert.equal(host.snapshot().revision, revision, "equal observations do not reset the host");
  const hidden = await frame(blank);
  assert.equal(hidden.sent, false);
  assert.equal(hidden.confirmed.text, "50.1", "occlusion retains the confirmed display without resending");
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

  generation = (await json("/api/settings", { enabled: true, maximum: 1200, key: "OBS_BASKETBALL_GAME_CLOCK", mode: "hold" })).generation;
  assert.equal((await frame(minutes)).sent, false);
  await delay(150);
  assert.equal((await frame(minutes)).sent, false);
  await delay(150);
  assert.equal((await frame(minutes)).sent, true);
  for (let i = 0; i < 20 && host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs !== 420000; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 420000);
  assert.deepEqual(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.observedDisplay, { format: "minutes", resolutionMs: 1000 });

  // Real model outliers must not move either the confirmed preview or the host.
  const wrong = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "8"]);
  for (let i = 0; i < 4; i++) {
    await delay(180);
    const result = await frame(wrong);
    assert.equal(result.sent, false);
    assert.equal(result.confirmed.text, "7:00");
  }
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 420000);

  const oldGeneration = generation;
  generation = (await json("/api/reacquire", {})).generation;
  assert.equal((await frame(wrong, false, oldGeneration)).accepted, false);
  assert.equal((await frame(wrong)).confirmed, null);
  await delay(150);
  assert.equal((await frame(wrong)).sent, false);
  await delay(150);
  const reacquired = await frame(wrong);
  assert.equal(reacquired.confirmed.text, "8");
  assert.equal(reacquired.sent, true, "explicit reacquisition establishes a new multi-frame baseline");
  for (let i = 0; i < 20 && host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs !== 8000; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 8000);

  const twentyFour = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "24"]);
  generation = (await json("/api/settings", { enabled: true, maximum: 60, mode: "auto", compensation_seconds: 1 })).generation;
  assert.equal((await frame(twentyFour)).sent, false);
  await delay(150);
  assert.equal((await frame(twentyFour)).sent, false);
  await delay(150);
  assert.equal((await frame(twentyFour)).sent, true);
  await delay(80);
  const running = host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK;
  assert.equal(running.running, true, "default mode starts the integer clock without a manual Start");
  assert.ok(running.baseMs <= 23000 && running.baseMs > 22000, "apply one second compensation exactly once, plus frame age");
  const runningRevision = host.snapshot().revision;
  assert.equal((await frame(blank)).sent, false);
  await delay(1200);
  assert.equal((await frame(blank)).sent, false);
  assert.equal(host.snapshot().revision, runningRevision, "occlusion does not reanchor the running timer");
  assert.ok(Date.now() - running.startedAt > 1200);

  // A stationary display must stop the prediction and restore its physical value,
  // without retaining the one-second running compensation.
  let paused = false;
  for (let i = 0; i < 15 && !paused; i++) {
    await delay(180);
    await frame(twentyFour);
    await delay(20);
    paused = !host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running;
  }
  assert.equal(paused, true);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 24000);

  // A hidden 14s reset may first reappear as 13 → 12. Confirm the moving
  // sequence, not just the exact reset digit, then restart the host at that value.
  const thirteen = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "13"]);
  const twelve = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "12"]);
  generation = (await json("/api/reacquire", { key: "OBS_BASKETBALL_SHOT_CLOCK" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    assert.equal((await frame(wrong)).sent, i === 2); // establish 8s
  }
  assert.equal((await frame(blank)).sent, false);
  await delay(1250);
  for (let i = 0; i < 4; i++) {
    if (i) await delay(180);
    const result = await frame(i < 2 ? thirteen : twelve);
    assert.equal(result.sent, i === 3, "hidden reset still requires four corroborating frames");
  }
  for (let i = 0; i < 50 && host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs < 10000; i++) await delay(20);
  const recovered = host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK;
  assert.equal(recovered.running, true);
  assert.ok(recovered.baseMs > 10000 && recovered.baseMs <= 11000, "recover to 12s with the configured 1s compensation");

  const shotKey = "OBS_BASKETBALL_SHOT_CLOCK", gameKey = "OBS_BASKETBALL_GAME_CLOCK";
  generation = (await json("/api/settings", { enabled: true, keys: [shotKey, gameKey], mode: "hold" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(160);
    const shotRead = await frame(jpg, false, generation, shotKey);
    const gameRead = await frame(minutes, false, generation, gameKey);
    assert.equal(shotRead.sent, i === 2);
    assert.equal(gameRead.sent, i === 2);
  }
  await delay(80);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 50100);
  assert.equal(host.snapshot().clocks[gameKey].baseMs, 420000);
  assert.equal((await frame(blank, false, generation, shotKey)).confirmed.text, "50.1");
  const states = (await json("/api/status")).clocks;
  assert.equal(states[shotKey].confirmed.text, "50.1");
  assert.equal(states[gameKey].confirmed.text, "7:00");
  generation = (await json("/api/reacquire", { key: shotKey })).generation;
  assert.equal((await json("/api/status")).clocks[shotKey].confirmed, null);
  assert.equal((await json("/api/status")).clocks[gameKey].confirmed.text, "7:00", "reacquiring one ROI preserves the other clock");

  generation = (await json("/api/settings", { enabled: true, keys: [shotKey, gameKey], mode: "auto" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    assert.equal((await frame(twentyFour, false, generation, shotKey)).sent, i === 2);
    assert.equal((await frame(minutes, false, generation, gameKey)).sent, i === 2);
  }
  for (let i = 0; i < 50 && !host.snapshot().clocks[gameKey].running; i++) await delay(20);
  const gameRunning = host.snapshot().clocks[gameKey];
  assert.equal(gameRunning.running, true, "auto mode starts the game clock independently");
  assert.equal(host.snapshot().clocks[shotKey].running, true);
  const gameBeforeBlank = clockValue(gameRunning, "down", Date.now());
  assert.equal((await frame(blank, false, generation, gameKey)).sent, false);
  await delay(1100);
  assert.equal((await frame(blank, false, generation, gameKey)).sent, false);
  assert.deepEqual(host.snapshot().clocks[gameKey], gameRunning, "occlusion does not rewrite or pause the game clock");
  assert.ok(clockValue(gameRunning, "down", Date.now()) < gameBeforeBlank - 1000, "game clock keeps counting without camera values");
  await json("/api/settings", { enabled: false });
});
