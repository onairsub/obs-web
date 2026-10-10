import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { RemoteRelayConnection } from "../src/components/remote/RemoteRelayConnection";
import { REMOTE_PROTOCOL_VERSION, type RemoteClientMessage, type RemoteServerMessage } from "../src/components/remote/remoteProtocol";

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: RemoteClientMessage[] = [];
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  receive(message: RemoteServerMessage) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  acknowledge() {
    const ping = this.sent.findLast((m) => m.type === "ping" && m.requestId);
    assert.equal(ping?.type, "ping");
    if (ping?.type === "ping") this.receive({ type: "pong", requestId: ping.requestId });
  }
}

function setup(t: TestContext, extra: Partial<ConstructorParameters<typeof RemoteRelayConnection>[0]> = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const sockets: FakeSocket[] = [];
  const states: boolean[] = [];
  const messages: RemoteServerMessage[] = [];
  const relay = new RemoteRelayConnection({
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
    join: { type: "join", sessionId: "a".repeat(32), hostSecret: "b".repeat(48), clientId: "test-client", role: "host", protocolVersion: REMOTE_PROTOCOL_VERSION },
    now: () => Date.now(), renewAfterMs: 1000, retryMs: 100, heartbeatMs: 10000, drainMs: 200,
    onConnected: (value) => states.push(value), onMessage: (message) => messages.push(message), ...extra,
  });
  t.after(() => relay.stop());
  relay.start();
  sockets[0].open();
  sockets[0].receive({ type: "ready", role: "host" });
  return { relay, sockets, states, messages };
}

const score: RemoteClientMessage = { type: "storage", key: "OBS_BASKETBALL_SCORE", value: "[3,2]" };

test("hot renewal keeps one logical connection, fences writes and deduplicates live events", (t) => {
  const { relay, sockets, states, messages } = setup(t);
  relay.send(score);
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.equal((sockets[1].sent[0] as { resume: boolean }).resume, true);
  sockets[1].receive({ type: "ready", role: "host" });
  const laterScore: RemoteClientMessage = { ...score, value: "[4,2]" };
  relay.send(laterScore);
  assert.equal(sockets[0].sent.includes(laterScore), false);
  assert.equal(sockets[1].sent.some((m) => m.type === "storage"), false, "new writes wait for the old instance's barrier");
  sockets[0].acknowledge();
  assert.deepEqual(sockets[1].sent.filter((m) => m.type === "storage"), [laterScore]);
  const command: RemoteServerMessage = { type: "command", command: { action: "refresh" }, relayId: "one-logical-event" };
  sockets[0].receive(command);
  sockets[1].receive(command);
  assert.equal(messages.filter((m) => m.type === "command").length, 1);
  sockets[1].receive({ type: "snapshot", state: { OBS_BASKETBALL_SCORE: "[0,0]" } });
  assert.equal(messages.filter((m) => m.type === "snapshot").length, 0, "no stale bootstrap during handover");
  assert.deepEqual(states, [true], "the UI never enters reconnecting during a successful renewal");
  t.mock.timers.tick(200);
  assert.equal(sockets[0].readyState, 3);
  assert.equal(sockets[1].readyState, 1);
});

test("replacement failure keeps the old connection usable and retries", (t) => {
  const { relay, sockets, states } = setup(t);
  t.mock.timers.tick(1000);
  sockets[1].close();
  assert.equal(relay.send(score), true);
  assert.deepEqual(states, [true]);
  t.mock.timers.tick(100);
  assert.equal(sockets.length, 3);
  sockets[2].open();
  sockets[2].receive({ type: "ready", role: "host" });
  sockets[0].acknowledge();
  assert.deepEqual(states, [true]);
});

test("failed or unacknowledged handover flushes queued writes back to the old socket", (t) => {
  const { relay, sockets, states } = setup(t);
  t.mock.timers.tick(1000);
  sockets[1].open();
  sockets[1].receive({ type: "ready", role: "host" });
  relay.send(score);
  t.mock.timers.tick(2000);
  assert.equal(sockets[1].readyState, 3);
  assert.deepEqual(sockets[0].sent.filter((m) => m.type === "storage"), [score]);
  assert.deepEqual(states, [true]);
});

test("unexpected failure during preparation restarts with a cold snapshot, not a warm join", (t) => {
  const { relay, sockets, states } = setup(t);
  t.mock.timers.tick(1000);
  sockets[0].close();
  assert.equal(sockets[1].readyState, 3);
  assert.equal(relay.send(score), false, "do not queue offline clicks for later execution");
  t.mock.timers.tick(100);
  sockets[2].open();
  assert.equal((sockets[2].sent[0] as { resume: boolean }).resume, false);
  sockets[2].receive({ type: "ready", role: "host" });
  assert.deepEqual(states, [true, false, true]);
});

test("prepared replacement recovers an old-socket failure without dropping the handover queue", (t) => {
  const { relay, sockets, states } = setup(t);
  t.mock.timers.tick(1000);
  sockets[1].open();
  sockets[1].receive({ type: "ready", role: "host" });
  relay.send(score);
  sockets[0].close();
  assert.deepEqual(sockets[1].sent.filter((m) => m.type === "storage"), [score]);
  assert.deepEqual(states, [true]);
});

test("missing heartbeat closes a half-open socket and reconnects", (t) => {
  const { sockets, states } = setup(t, { renewAfterMs: 100000, heartbeatMs: 100, heartbeatTimeoutMs: 50 });
  t.mock.timers.tick(100);
  assert.equal(sockets[0].sent.at(-1)?.type, "ping");
  t.mock.timers.tick(50);
  assert.equal(sockets[0].readyState, 3);
  assert.deepEqual(states, [true, false]);
  t.mock.timers.tick(100);
  assert.equal(sockets.length, 2);
});

test("manual close during handover is sent immediately; all sockets and retry timers stop", (t) => {
  const { relay, sockets } = setup(t);
  t.mock.timers.tick(1000);
  sockets[1].open();
  sockets[1].receive({ type: "ready", role: "host" });
  relay.send({ type: "close-session" });
  assert.equal(sockets[0].sent.at(-1)?.type, "close-session");
  relay.stop();
  assert.ok(sockets.every((s) => s.readyState === 3));
  t.mock.timers.tick(1000000);
  assert.equal(sockets.length, 2);
});

test("terminal session closure on either socket stops renewals", (t) => {
  const { sockets, messages } = setup(t);
  t.mock.timers.tick(1000);
  sockets[1].open();
  sockets[1].receive({ type: "closed", reason: "host-closed" });
  assert.ok(sockets.every((s) => s.readyState === 3));
  t.mock.timers.tick(1000000);
  assert.equal(sockets.length, 2);
  assert.equal(messages.at(-1)?.type, "closed");
});
