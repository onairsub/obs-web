import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { HostClocks, RemoteClocks } from "../src/components/obs/clockSync";
import type { RemoteClientMessage, RemoteServerMessage } from "../src/components/remote/remoteProtocol";

test("three live remote sockets converge, reconnect to current host time, and cannot overwrite timers", { timeout: 20000 }, async (t) => {
  async function startServer() {
    const child = fork(new URL("./clock-relay-server.ts", import.meta.url), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
    t.after(() => child.kill());
    const [{ port }] = await once(child, "message");
    return `ws://127.0.0.1:${port}`;
  }
  const hostURL = process.env.CLOCK_TEST_WS_URL || await startServer();
  const mobileURL = !process.env.CLOCK_TEST_WS_URL && process.env.CLOCK_TEST_REDIS_URL ? await startServer() : hostURL;
  const sessionId = randomBytes(16).toString("hex");
  const hostSecret = randomBytes(24).toString("hex");
  const sockets: WebSocket[] = [];
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  function send(socket: WebSocket, message: RemoteClientMessage) { socket.send(JSON.stringify(message)); }
  function waitFor(socket: WebSocket, predicate: (message: RemoteServerMessage) => boolean) {
    return new Promise<RemoteServerMessage>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.off("message", listener); };
      const listener = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString()) as RemoteServerMessage;
        if (message.type === "error") { cleanup(); reject(new Error(message.message)); }
        else if (predicate(message)) { cleanup(); resolve(message); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("relay response timed out")); }, 5000);
      socket.on("message", listener);
    });
  }
  async function connect(url: string, role: "host" | "remote") {
    const socket = new WebSocket(url);
    sockets.push(socket);
    await once(socket, "open");
    const ready = waitFor(socket, (m) => m.type === "ready");
    send(socket, { type: "join", role, sessionId, hostSecret: role === "host" ? hostSecret : undefined, clientId: randomUUID(), protocolVersion: 2 });
    await ready;
    return socket;
  }
  const host = await connect(hostURL, "host");
  let hostTime = 1000000;
  const authority = new HostClocks(randomUUID(), () => hostTime, () => 24, () => null, () => {});
  host.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as RemoteServerMessage;
    if (message.type === "clock-sync") send(host, { type: "clock-state", snapshot: authority.snapshot(), replyTo: message.requestId });
    if (message.type === "clock-command") {
      const snapshot = authority.receive(message.command);
      if (snapshot) send(host, { type: "clock-state", snapshot });
    }
  });
  const phones = await Promise.all([connect(mobileURL, "remote"), connect(mobileURL, "remote"), connect(mobileURL, "remote")]);
  const replicas = phones.map((_, i) => new RemoteClocks(() => hostTime + (i - 1) * 3600000));
  phones.forEach((socket, i) => socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as RemoteServerMessage;
    if (message.type === "clock-state") replicas[i].accept(message.snapshot, message.replyTo);
  }));
  await Promise.all(phones.map(async (socket, i) => {
    const requestId = randomUUID();
    replicas[i].probe(requestId);
    const reply = waitFor(socket, (m) => m.type === "clock-state" && m.replyTo === requestId);
    send(socket, { type: "clock-sync", requestId });
    await reply;
    assert.equal(replicas[i].ready(), true);
  }));

  // 30 concurrent +1s operations, with duplicate network messages from each phone.
  const done = phones.map((socket) => waitFor(socket, (m) => m.type === "clock-state" && m.snapshot.revision === 30));
  phones.forEach((socket) => {
    for (let i = 0; i < 10; i++) {
      const message: RemoteClientMessage = { type: "clock-command", command: { id: randomUUID(), epoch: authority.epoch, issuedAt: hostTime, key: "OBS_BASKETBALL_SHOT_CLOCK", operation: { action: "adjust", seconds: 1, keepRunning: true } } };
      send(socket, message);
      send(socket, message);
    }
  });
  await Promise.all(done);
  for (const replica of replicas) assert.equal(replica.snapshot?.clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 54000);

  // Neither a legacy storage write nor a forged host snapshot may change timers.
  phones[0].send(JSON.stringify({ type: "storage", key: "OBS_BASKETBALL_SHOT_CLOCK", value: '{"running":false,"baseMs":0,"startedAt":0}' }));
  send(phones[0], { type: "clock-state", snapshot: { ...authority.snapshot(), revision: 9999 } });
  const pong = waitFor(phones[0], (m) => m.type === "pong");
  send(phones[0], { type: "ping" });
  await pong;
  assert.equal(replicas[1].snapshot?.revision, 30);
  assert.equal(authority.snapshot().clocks.OBS_BASKETBALL_SHOT_CLOCK.baseMs, 54000);

  // The host continues to edit clocks while a phone disconnects.
  phones[0].close();
  authority.apply("OBS_BASKETBALL_GAME_CLOCK", { action: "start" });
  hostTime += 3000;
  authority.apply("OBS_BASKETBALL_GAME_CLOCK", { action: "reset", seconds: 600, keepRunning: true });
  const rejoined = await connect(mobileURL, "remote");
  const sync = waitFor(rejoined, (m) => m.type === "clock-state" && m.replyTo === "rejoined-probe");
  send(rejoined, { type: "clock-sync", requestId: "rejoined-probe" });
  const state = await sync;
  assert.equal(state.type, "clock-state");
  if (state.type === "clock-state") {
    assert.equal(state.snapshot.clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 600000);
    assert.equal(state.snapshot.clocks.OBS_BASKETBALL_GAME_CLOCK.running, true);
  }
  const closed = waitFor(phones[1], (m) => m.type === "closed");
  send(host, { type: "close-session" });
  await closed;
});
