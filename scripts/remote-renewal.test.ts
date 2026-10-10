import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { HostClocks, RemoteClocks, clockValue } from "../src/components/obs/clockSync";
import { RemoteRelayConnection } from "../src/components/remote/RemoteRelayConnection";
import { REMOTE_PROTOCOL_VERSION, type RemoteServerMessage } from "../src/components/remote/remoteProtocol";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeout = 5000) {
  const started = performance.now();
  while (!predicate()) {
    assert.ok(performance.now() - started < timeout, "timed out waiting for relay state");
    await delay(10);
  }
}

test("host and three phones renew across live servers without a gap, duplicate commands, or clock rollback", { timeout: Number(process.env.RENEWAL_TEST_DURATION_MS ?? 3500) + 25000 }, async (t) => {
  async function server() {
    const child = fork(new URL("./clock-relay-server.ts", import.meta.url), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
    t.after(() => child.kill());
    const [{ port }] = await once(child, "message");
    return `ws://127.0.0.1:${port}`;
  }
  const url = process.env.CLOCK_TEST_WS_URL || await server();
  const second = !process.env.CLOCK_TEST_WS_URL && process.env.CLOCK_TEST_REDIS_URL ? await server() : url;
  const sessionId = randomBytes(16).toString("hex");
  const hostSecret = randomBytes(24).toString("hex");
  const clients: { relay: RemoteRelayConnection; online: boolean[]; messages: RemoteServerMessage[]; sockets: WebSocket[]; readyCount: number }[] = [];
  t.after(() => clients.forEach((c) => { c.relay.stop(); c.sockets.forEach((s) => s.terminate()); }));
  let clockCommands = 0;
  let obsCommands = 0;
  const authority = new HostClocks(randomUUID(), () => performance.now() + 1000000, () => 600, () => null, () => {});
  authority.apply("OBS_BASKETBALL_GAME_CLOCK", { action: "start" });
  authority.apply("OBS_BASKETBALL_SHOT_CLOCK", { action: "start" });
  function connect(role: "host" | "remote", receive: (message: RemoteServerMessage, relay: RemoteRelayConnection) => void) {
    const client = { relay: null as unknown as RemoteRelayConnection, online: [] as boolean[], messages: [] as RemoteServerMessage[], sockets: [] as WebSocket[], readyCount: 0 };
    const renewal = process.env.RENEWAL_TEST_INTERVAL_MS;
    client.relay = new RemoteRelayConnection({
      // Alternating instances exercises real Redis fan-out while both sockets overlap.
      createSocket: () => {
        const socket = new WebSocket(client.sockets.length % 2 ? second : url);
        client.sockets.push(socket);
        return socket as unknown as globalThis.WebSocket;
      },
      join: { type: "join", sessionId, hostSecret: role === "host" ? hostSecret : undefined, role, clientId: randomUUID(), protocolVersion: REMOTE_PROTOCOL_VERSION },
      renewAfterMs: renewal ? Number(renewal) : 700 + clients.length * 100,
      heartbeatMs: renewal ? 25000 : 250, heartbeatTimeoutMs: 10000, drainMs: renewal ? 5000 : 300,
      onConnected: (connected) => client.online.push(connected),
      onMessage: (message) => {
        client.messages.push(message);
        if (message.type === "ready") client.readyCount++;
        receive(message, client.relay);
      },
    });
    clients.push(client);
    client.relay.start();
    return client;
  }
  const host = connect("host", (message, relay) => {
    if (message.type === "clock-sync") relay.send({ type: "clock-state", snapshot: authority.snapshot(), replyTo: message.requestId });
    if (message.type === "clock-command") {
      clockCommands++;
      const snapshot = authority.receive(message.command);
      if (snapshot) relay.send({ type: "clock-state", snapshot });
    }
    if (message.type === "command") obsCommands++;
  });
  await until(() => host.readyCount === 1);
  host.relay.send({ type: "snapshot", state: { OBS_BASKETBALL_SCORE: "[5,6]" } });
  const replicas = [0, 1, 2].map((i) => new RemoteClocks(() => performance.now() + i * 3600000));
  const phones = replicas.map((replica) => connect("remote", (message, relay) => {
    if (message.type === "ready") {
      const requestId = randomUUID();
      replica.probe(requestId);
      relay.send({ type: "clock-sync", requestId });
    }
    if (message.type === "clock-state") replica.accept(message.snapshot, message.replyTo);
  }));
  await until(() => replicas.every((r) => r.ready()));
  const started = performance.now();
  let operations = 0;
  const duration = Number(process.env.RENEWAL_TEST_DURATION_MS ?? 3500);
  while (performance.now() - started < duration) {
    for (const [i, phone] of phones.entries()) {
      assert.ok(phone.relay.send({ type: "clock-command", command: { id: randomUUID(), epoch: authority.epoch, issuedAt: replicas[i].now(), key: "OBS_BASKETBALL_SHOT_CLOCK", operation: { action: "adjust", seconds: 1, keepRunning: true } } }));
      assert.ok(phone.relay.send({ type: "command", command: { action: "refresh" } }));
      operations++;
    }
    host.relay.send({ type: "storage", key: "OBS_BASKETBALL_SCORE", value: JSON.stringify([operations, 6]) });
    await delay(Number(process.env.RENEWAL_TEST_STEP_MS ?? 80));
  }
  await until(() => replicas.every((r) => r.snapshot?.revision === operations + 2) && obsCommands === operations);
  for (const client of clients) {
    assert.deepEqual(client.online, [true], "no connecting state during planned expiry");
    assert.ok(client.readyCount >= 2, "each device completed a renewal");
    assert.equal(client.messages.filter((m) => m.type === "snapshot").length, client === host ? 0 : 1, "renewal never replays stale stored state");
  }
  assert.equal(clockCommands, operations, "even before HostClocks' own dedup, commands arrive once");
  assert.equal(obsCommands, operations, "non-idempotent OBS refresh also arrives once");
  assert.ok(!host.messages.some((m) => m.type === "storage"), "overlapping host sockets must not echo their own score updates");
  const hostClock = authority.snapshot();
  for (const replica of replicas) {
    assert.equal(replica.snapshot?.clocks.OBS_BASKETBALL_SHOT_CLOCK.running, true);
    assert.equal(replica.snapshot?.epoch, hostClock.epoch);
    const clock = replica.snapshot!.clocks.OBS_BASKETBALL_GAME_CLOCK;
    assert.ok(Math.abs(clockValue(clock, "down", replica.now()) - clockValue(hostClock.clocks.OBS_BASKETBALL_GAME_CLOCK, "down", authority.now())) < 150);
  }
  console.log(JSON.stringify({ durationMs: Math.round(performance.now() - started), operations, renewals: clients.map((c) => c.readyCount - 1), disconnects: clients.map((c) => c.online.filter((s) => !s).length) }));
  host.relay.send({ type: "close-session" });
  await until(() => phones.every((p) => p.messages.some((m) => m.type === "closed")));
  // A delayed standby handshake cannot resurrect a manually closed session.
  const late = new WebSocket(url);
  t.after(() => late.terminate());
  await once(late, "open");
  const response = once(late, "message");
  late.send(JSON.stringify({ type: "join", sessionId, hostSecret, role: "host", clientId: randomUUID(), protocolVersion: REMOTE_PROTOCOL_VERSION, resume: true }));
  const [raw] = await response;
  const rejected = JSON.parse(raw.toString());
  assert.equal(rejected.code, "SESSION_NOT_FOUND");
  late.close();
});
