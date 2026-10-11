import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { fork, spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { HostClocks, clockValue } from "../src/components/obs/clockSync";
import { formatClock, formatShotClock } from "../src/components/obs/clockFormat";
import { REMOTE_PROTOCOL_VERSION, type RemoteServerMessage } from "../src/components/remote/remoteProtocol";

test("local JPEG → real OCR → Python client → relay → authoritative host", { timeout: 90000 }, async (t) => {
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
  for (const path of ["/clock-preview.mjs", "/shared/clock-format.mjs"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
  }
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
  assert.equal(hidden.confirmed.text, "51", "occlusion retains the confirmed display without resending");
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
    assert.equal(result.confirmed.text, "07:00");
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
  assert.equal(reacquired.confirmed.text, "8.0");
  assert.equal(reacquired.sent, true, "explicit reacquisition establishes a new multi-frame baseline");
  for (let i = 0; i < 20 && host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs !== 8000; i++) await delay(20);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 8000);

  const twentyFour = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "24"]);
  const twentyThree = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "23"]);
  generation = (await json("/api/settings", { enabled: true, maximum: 60, mode: "auto", compensation_seconds: 1 })).generation;
  assert.equal((await frame(twentyFour)).sent, false);
  await delay(150);
  assert.equal((await frame(twentyFour)).sent, false);
  await delay(150);
  assert.equal((await frame(twentyFour)).sent, true);
  await delay(80);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running, false, "24s preset waits for an observed decrement");
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 24000, "no running compensation while reset is held");
  await delay(1000);
  assert.equal((await frame(blank)).sent, false);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 24000);
  await delay(180);
  for (let i = 0; i < 4; i++) {
    if (i) await delay(180);
    const result = await frame(twentyThree);
    assert.equal(result.sent, i === 3, result.reason);
  }
  for (let i = 0; i < 50 && !host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running; i++) await delay(20);
  const running = host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK;
  assert.equal(running.running, true, "confirmed 24 to 23 decrement starts the timer");
  assert.ok(running.baseMs <= 22000 && running.baseMs > 21000, "apply one second compensation exactly once, plus frame age");
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
    await frame(twentyThree);
    await delay(20);
    paused = !host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.running;
  }
  assert.equal(paused, true);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 23000);

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
  assert.equal((await frame(blank, false, generation, shotKey)).confirmed.text, "51");
  const states = (await json("/api/status")).clocks;
  assert.equal(states[shotKey].confirmed.text, "51");
  assert.equal(states[gameKey].confirmed.text, "07:00");
  generation = (await json("/api/reacquire", { key: shotKey })).generation;
  assert.equal((await json("/api/status")).clocks[shotKey].confirmed, null);
  assert.equal((await json("/api/status")).clocks[gameKey].confirmed.text, "07:00", "reacquiring one ROI preserves the other clock");

  generation = (await json("/api/settings", { enabled: true, keys: [shotKey, gameKey], mode: "auto" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    assert.equal((await frame(twentyFour, false, generation, shotKey)).sent, i === 2);
    assert.equal((await frame(minutes, false, generation, gameKey)).sent, i === 2);
  }
  for (let i = 0; i < 50 && !host.snapshot().clocks[gameKey].running; i++) await delay(20);
  const gameRunning = host.snapshot().clocks[gameKey];
  assert.equal(gameRunning.running, true, "auto mode starts the game clock independently");
  assert.equal(host.snapshot().clocks[shotKey].running, false, "shot reset can hold while the game clock runs");
  const gameBeforeBlank = clockValue(gameRunning, "down", Date.now());
  assert.equal((await frame(blank, false, generation, gameKey)).sent, false);
  await delay(1100);
  assert.equal((await frame(blank, false, generation, gameKey)).sent, false);
  assert.deepEqual(host.snapshot().clocks[gameKey], gameRunning, "occlusion does not rewrite or pause the game clock");
  assert.ok(clockValue(gameRunning, "down", Date.now()) < gameBeforeBlank - 1000, "game clock keeps counting without camera values");
  // The last five shot-clock seconds belong to the running host, including
  // stationary decimals and delayed higher reads that used to stop/rewind it.
  const six = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "6"]);
  const five = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "5"]);
  const fourNine = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "4.9"]);
  const fourteen = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "14"]);
  generation = (await json("/api/settings", { enabled: true, keys: [shotKey], mode: "auto" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    const result = await frame(twentyFour, false, generation, shotKey);
    assert.equal(result.accepted, i === 2, JSON.stringify(result));
  }
  for (let i = 0; i < 50 && host.snapshot().clocks[shotKey].baseMs !== 24000; i++) await delay(20);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 24000);
  assert.equal(host.snapshot().clocks[shotKey].running, false);
  for (let i = 0; i < 4; i++) {
    await delay(180);
    const result = await frame(six, false, generation, shotKey);
    assert.equal(result.sent, i === 3, JSON.stringify(result));
  }
  for (let i = 0; i < 50 && !host.snapshot().clocks[shotKey].running; i++) await delay(20);
  const lastFiveTimer = host.snapshot().clocks[shotKey];
  assert.equal(lastFiveTimer.running, true);
  const beforeLastFive = clockValue(lastFiveTimer, "down", Date.now());
  for (const image of [...Array(10).fill(six), ...Array(3).fill(five), ...Array(8).fill(fourNine), blank]) {
    await delay(180);
    const result = await frame(image, false, generation, shotKey);
    assert.equal(result.sent, false, JSON.stringify(result));
    assert.deepEqual(host.snapshot().clocks[shotKey], lastFiveTimer, "OCR cannot alter the last five seconds");
  }
  assert.ok(clockValue(lastFiveTimer, "down", Date.now()) < beforeLastFive - 3000);
  assert.equal((await json("/api/status")).clocks[shotKey].confirmed.text, "4.9", "recognition remains visible while playback runs independently");
  for (let i = 0; i < 4; i++) {
    await delay(180);
    const result = await frame(fourteen, false, generation, shotKey);
    assert.equal(result.sent, i === 3, JSON.stringify(result));
  }
  for (let i = 0; i < 50 && host.snapshot().clocks[shotKey].baseMs !== 14000; i++) await delay(20);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 14000, "a corroborated reset exits timer-only playback");
  assert.equal(host.snapshot().clocks[shotKey].running, false, "14 reset still waits for a decrement");

  // Decimal observations fit a running line; the host keeps ticking between frames.
  for (const [key, integer, decimals] of [
    [gameKey, "1:00", ["59.9", "59.7", "59.5"]],
  ] as const) {
    const images = [integer, ...decimals].map(text => execFileSync(python, ["local-clock/benchmark.py", "--jpeg", text]));
    generation = (await json("/api/settings", { enabled: true, keys: [key], mode: "auto" })).generation;
    for (let i = 0; i < 3; i++) {
      if (i) await delay(180);
      const result = await frame(images[0], false, generation, key);
      assert.equal(result.sent, i === 2, `${key} ${integer} frame ${i}: ${JSON.stringify(result)}`);
    }
    for (let i = 0; i < 50 && !host.snapshot().clocks[key].running; i++) await delay(20);
    assert.equal(host.snapshot().clocks[key].running, true);
    for (let i = 0; i < 3; i++) {
      await delay(180);
      const result = await frame(images[i + 1], false, generation, key);
      assert.equal(result.accepted, i === 2, `${key} ${decimals[i]}: ${JSON.stringify(result)}`);
    }
    await delay(80);
    const moving = host.snapshot().clocks[key];
    assert.equal(moving.running, true);
    const valueBefore = clockValue(moving, 'down', Date.now());
    await delay(500);
    assert.equal((await frame(blank, false, generation, key)).sent, false);
    assert.deepEqual(host.snapshot().clocks[key], moving);
    assert.ok(clockValue(moving, 'down', Date.now()) < valueBefore - 450, 'tenths keep counting between observations');
    let stopped = false;
    for (let i = 0; i < 10 && !stopped; i++) {
      await delay(180);
      await frame(images[3], false, generation, key);
      await delay(20);
      stopped = !host.snapshot().clocks[key].running;
    }
    assert.equal(stopped,true,'stationary decimal points must replace the running hypothesis');
    assert.equal(host.snapshot().clocks[key].baseMs,Number(decimals[2])*1000);
    const held = host.snapshot().clocks[key];
    const outlier = await frame(wrong, false, generation, key);
    assert.equal(outlier.sent,false);
    assert.deepEqual(host.snapshot().clocks[key],held);
    const resumeImages = ['59.3','59.1','58.9'].map(text => execFileSync(python, ['local-clock/benchmark.py','--jpeg',text]));
    for (const image of resumeImages) {
      await delay(180);
      await frame(image,false,generation,key);
    }
    await delay(80);
    assert.equal(host.snapshot().clocks[key].running,true,'new decreasing points restart tenths playback');
  }

  // Under one minute, a brief decimal stop/resume must reach the host without
  // waiting for the old 1.5-second trajectory window to expire.
  const transitionImages = ['8.9','8.7','8.5','8:3','8:1'].map(text =>
    execFileSync(python,['local-clock/benchmark.py','--jpeg',text]));
  generation = (await json('/api/settings', { enabled: true, keys: [gameKey], mode: 'auto', game_low_sync: true })).generation;
  for (const image of transitionImages.slice(0,3)) {
    await delay(180);
    await frame(image,false,generation,gameKey);
  }
  await delay(40);
  assert.equal(host.snapshot().clocks[gameKey].running,true);
  for (let i=0;i<2;i++) {
    await delay(180);
    await frame(transitionImages[2],false,generation,gameKey);
  }
  await delay(40);
  assert.equal(host.snapshot().clocks[gameKey].running,false,'three identical tenths must stop the host promptly');
  assert.equal(host.snapshot().clocks[gameKey].baseMs,8500);
  for (const image of transitionImages.slice(3)) {
    await delay(180);
    const result=await frame(image,false,generation,gameKey);
    assert.equal(result.reading.resolution_ms,100,'single-digit colons also participate in fast resume');
  }
  await delay(40);
  const resumedDecimal=host.snapshot().clocks[gameKey];
  assert.equal(resumedDecimal.running,true,'two plausible decreasing reads restart a confirmed stop');
  const resumedValue=clockValue(resumedDecimal,'down',Date.now());
  await delay(500);
  assert.equal((await frame(blank,false,generation,gameKey)).sent,false);
  assert.deepEqual(host.snapshot().clocks[gameKey],resumedDecimal);
  assert.ok(clockValue(resumedDecimal,'down',Date.now())<resumedValue-450,'resumed timer keeps counting while occluded');

  // Hold mode still needs a useful local preview when synchronization is off.
  generation = (await json("/api/settings", { enabled: false, keys: [shotKey, gameKey], mode: "hold" })).generation;
  const beforePreview = host.snapshot().revision;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    assert.equal((await frame(jpg, false, generation, shotKey)).sent, false);
    assert.equal((await frame(minutes, false, generation, gameKey)).sent, false);
  }
  const previewStates = (await json("/api/status")).clocks;
  assert.deepEqual(previewStates[shotKey].preview, { seconds: 50.1, running: false });
  assert.deepEqual(previewStates[gameKey].preview, { seconds: 420, running: false });
  assert.equal(host.snapshot().revision, beforePreview);

  // Game recognition, not host playback, enforces elapsed-time plausibility.
  // Exact 7:00 / 3:00 presets are separate four-frame reset exceptions.
  const gameBaseline = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "6:40"]);
  const impossibleGame = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "6:20"]);
  const threeMinutes = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "3:00"]);
  generation = (await json("/api/settings", { enabled: true, keys: [gameKey], mode: "auto" })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    assert.equal((await frame(gameBaseline, false, generation, gameKey)).sent, i === 2);
  }
  for (let i = 0; i < 50 && Math.abs(host.snapshot().clocks[gameKey].baseMs - 400000) > 1000; i++) await delay(20);
  const beforeBadRead = host.snapshot().clocks[gameKey];
  for (let i = 0; i < 4; i++) {
    await delay(180);
    const result = await frame(impossibleGame, false, generation, gameKey);
    assert.equal(result.reading.text, '6:20', 'raw candidate remains visible');
    assert.equal(result.accepted, false);
    assert.equal(result.sent, false);
    assert.equal(result.confirmed.text, '06:40');
    assert.match(result.reason, /실제 경과 시간/);
  }
  assert.deepEqual(host.snapshot().clocks[gameKey], beforeBadRead, 'rejecting OCR does not pause or rewrite the host timer');
  for (const [image, expectedMs] of [[threeMinutes, 180000], [minutes, 420000]] as const) {
    for (let i = 0; i < 4; i++) {
      await delay(180);
      const result = await frame(image, false, generation, gameKey);
      assert.equal(result.sent, i === 3, JSON.stringify(result));
    }
    for (let i = 0; i < 50 && Math.abs(host.snapshot().clocks[gameKey].baseMs - expectedMs) > 1000; i++) await delay(20);
    const reset = host.snapshot().clocks[gameKey];
    assert.ok(reset.baseMs <= expectedMs && reset.baseMs > expectedMs - 1000);
    assert.equal(reset.running, true, 'a confirmed new game baseline retains auto-mode start behavior');
  }
  // Raw OCR may omit a leading zero. The confirmed response, status API,
  // and actual timer must all use the sport format, without inventing precision.
  generation = (await json("/api/settings", { enabled: true, keys: [gameKey, shotKey], mode: "hold" })).generation;
  for (const [key, text, expectedMs, expectedText, resolutionMs] of [
    [gameKey, "1:43", 103000, "01:43", 1000],
    [gameKey, "2:05", 125000, "02:05", 1000],
    [gameKey, "59", 59000, "59.0", 1000],
    [shotKey, "24", 24000, "24", 1000],
    [shotKey, "4.2", 4200, "4.2", 100],
    [shotKey, "4", 4000, "4.0", 1000],
  ] as const) {
    generation = (await json("/api/reacquire", { key })).generation;
    const timerOnly = key === shotKey && expectedMs <= 5000;
    const unchangedTimer = host.snapshot().clocks[key];
    const image = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", text]);
    for (let i = 0; i < 3; i++) {
      if (i) await delay(180);
      const result = await frame(image, false, generation, key);
      assert.equal(result.reading.text, text, "raw candidate remains unformatted");
      assert.equal(result.reading.seconds, expectedMs / 1000);
      assert.equal(result.sent, i === 2 && !timerOnly, JSON.stringify(result));
      assert.equal(result.confirmed?.text ?? null, i === 2 ? expectedText : null);
    }
    for (let i = 0; !timerOnly && i < 50 && host.snapshot().clocks[key].baseMs !== expectedMs; i++) await delay(20);
    const actualTimer = host.snapshot().clocks[key];
    if (timerOnly) {
      assert.deepEqual(actualTimer, unchangedTimer, "confirmed low shot values are display-only");
    } else {
      assert.equal(actualTimer.baseMs, expectedMs);
      assert.equal(actualTimer.running, false);
      assert.equal(key === gameKey ? formatClock(actualTimer.baseMs, true) : formatShotClock(actualTimer.baseMs), expectedText);
      assert.equal(actualTimer.observedDisplay?.resolutionMs, resolutionMs);
    }
    const statusClock = (await json("/api/status")).clocks[key];
    assert.equal(statusClock.confirmed.text, expectedText);
    assert.deepEqual(statusClock.preview, timerOnly ? null : { seconds: expectedMs / 1000, running: false });
    assert.equal((await frame(blank, false, generation, key)).confirmed.text, expectedText, "occlusion retains the canonical confirmed value");
  }
  for (const mode of ["auto", "hold", "preserve"]) {
    generation = (await json("/api/settings", { enabled: true, keys: [shotKey], mode })).generation;
    const existingTimer = host.snapshot().clocks[shotKey];
    for (let i = 0; i < 3; i++) {
      if (i) await delay(180);
      const result = await frame(five, false, generation, shotKey);
      assert.equal(result.sent, false, `${mode} must not set, pause, or start a five-second observation`);
      assert.equal(result.accepted, i === 2);
    }
    assert.deepEqual(host.snapshot().clocks[shotKey], existingTimer);
  }

  // A plausible stationary time can recover upward from an OCR mistake,
  // even with missing frames, and must restore the full uncompensated value.
  const pausedGame = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "6:43"]);
  const resumedGame = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "6:42"]);
  generation = (await json("/api/settings", { enabled: true, keys: [gameKey], mode: "auto", compensation_seconds: 1 })).generation;
  for (let i = 0; i < 3; i++) {
    if (i) await delay(180);
    await frame(gameBaseline, false, generation, gameKey);
  }
  let gameStopped = false;
  for (let i = 0; i < 14 && !gameStopped; i++) {
    await delay(180);
    const result = await frame(i % 3 === 1 ? blank : pausedGame, false, generation, gameKey);
    await delay(20);
    gameStopped = result.sent && !host.snapshot().clocks[gameKey].running;
  }
  assert.equal(gameStopped, true, 'stationary recovery must reach the host as hold, not run');
  assert.equal(host.snapshot().clocks[gameKey].baseMs, 403000);
  assert.equal((await json('/api/status')).clocks[gameKey].confirmed.text, '06:43');
  for (let i = 0; i < 4; i++) {
    await delay(180);
    await frame(resumedGame, false, generation, gameKey);
  }
  await delay(80);
  assert.equal(host.snapshot().clocks[gameKey].running, true, 'a confirmed decrement resumes the game');

  const colonTenths = execFileSync(python, ["local-clock/benchmark.py", "--jpeg", "3:9"]);
  for (const sync of [false, true]) {
    generation = (await json('/api/settings', { enabled: true, keys: [shotKey, gameKey], mode: 'auto',
      shot_low_sync: sync, game_low_sync: sync })).generation;
    const unchanged = host.snapshot().clocks;
    const sent = new Set<string>();
    for (let i = 0; i < 6; i++) {
      if (i) await delay(180);
      for (const key of [shotKey, gameKey]) {
        const result = await frame(colonTenths, false, generation, key);
        assert.equal(result.reading.text, '3:9');
        assert.equal(result.reading.seconds, 3.9);
        if (result.sent) sent.add(key);
        if (!sync) assert.equal(result.sent,false);
        if (i === 5) assert.equal(result.confirmed.text, '3.9');
      }
    }
    await delay(80);
    for (const key of [shotKey, gameKey] as const) {
      if (sync) {
        assert.ok(sent.has(key));
        assert.equal(host.snapshot().clocks[key].baseMs, 3900);
        assert.equal(host.snapshot().clocks[key].running, false);
      } else assert.deepEqual(host.snapshot().clocks[key], unchanged[key]);
    }
  }
  const runningShotImages = ['4.9','4.7','4.5'].map(text =>
    execFileSync(python,['local-clock/benchmark.py','--jpeg',text]));
  generation = (await json('/api/settings', { enabled: true, keys: [shotKey], mode: 'auto', shot_low_sync: true })).generation;
  for (const image of runningShotImages) {
    await delay(180);
    await frame(image,false,generation,shotKey);
  }
  await delay(80);
  const decimalShot=host.snapshot().clocks[shotKey];
  assert.equal(decimalShot.running,true);
  const beforeGap=clockValue(decimalShot,'down',Date.now());
  await delay(700);
  assert.equal((await frame(blank,false,generation,shotKey)).sent,false);
  assert.deepEqual(host.snapshot().clocks[shotKey],decimalShot);
  assert.ok(clockValue(decimalShot,'down',Date.now()) < beforeGap-650);
  host.apply(shotKey,{action:'pause'});
  socket.send(JSON.stringify({type:'clock-state',snapshot:host.snapshot()}));
  await delay(80);

  // Double-click is an explicit manual reset. It works while automatic sync is
  // disabled, bypasses low-time suppression, preserves playback, and rejects
  // stale generations instead of replaying an older camera result.
  generation = (await json('/api/settings', { enabled: false, keys: [shotKey, gameKey], shot_low_sync: false, game_low_sync: false })).generation;
  const beforeManualGeneration = generation;
  const unchangedGame = host.snapshot().clocks[gameKey];
  let applied = await json('/api/apply', { key: shotKey, value: '4.2', generation });
  generation = applied.generation;
  assert.equal(applied.confirmed.text, '4.2');
  await delay(80);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 4200);
  assert.equal(host.snapshot().clocks[shotKey].running, false);
  assert.deepEqual(host.snapshot().clocks[gameKey], unchangedGame);
  assert.equal((await frame(fourNine, false, beforeManualGeneration, shotKey)).accepted, false);
  let invalid = await fetch(origin + '/api/apply', { method: 'POST', headers: { 'X-Local-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: shotKey, value: '24', generation: beforeManualGeneration }) });
  assert.equal(invalid.status, 409);
  invalid = await fetch(origin + '/api/apply', { method: 'POST', headers: { 'X-Local-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: shotKey, value: '—', generation }) });
  assert.equal(invalid.status, 400);
  applied = await json('/api/apply', { key: gameKey, value: '1:43', generation });
  generation = applied.generation;
  assert.equal(applied.confirmed.text, '01:43');
  await delay(80);
  assert.equal(host.snapshot().clocks[gameKey].baseMs, 103000);
  host.apply(shotKey, { action: 'start' });
  socket.send(JSON.stringify({ type: 'clock-state', snapshot: host.snapshot() }));
  await delay(80);
  generation = (await json('/api/apply', { key: shotKey, value: '3:9', generation })).generation;
  await delay(80);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 3900);
  assert.equal(host.snapshot().clocks[shotKey].running, true, 'manual tenths preserve a running timer');
  generation = (await json('/api/apply', { key: shotKey, value: '14', generation })).generation;
  await delay(80);
  assert.equal(host.snapshot().clocks[shotKey].baseMs, 14000);
  assert.equal(host.snapshot().clocks[shotKey].running, false, 'manual shot presets also wait for a decrement');
  await json("/api/settings", { enabled: false });
});
