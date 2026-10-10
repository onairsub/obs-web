import assert from "node:assert/strict";
import { test } from "node:test";
import { HostClocks, RemoteClocks, clockValue, changeClock, type ClockCommand, type ClockKey } from "../src/components/obs/clockSync";
import { filterRemoteSnapshot, parseRemoteClientMessage, REMOTE_SYNC_KEYS } from "../src/components/remote/remoteProtocol";

const shot: ClockKey = "OBS_BASKETBALL_SHOT_CLOCK";
const game: ClockKey = "OBS_BASKETBALL_GAME_CLOCK";
function fixture() {
  let now = 1000000;
  const stored = new Map();
  const host = new HostClocks("host-epoch", () => now, (key) => key === game ? 600 : 24, (key) => stored.get(key), (key, value) => stored.set(key, value));
  return { host, stored, advance: (ms: number) => { now += ms; } };
}

test("three controllers and local controls accumulate against the latest state; duplicate packets apply once", () => {
  const { host, advance } = fixture();
  host.apply(shot, { action: "start" });
  advance(2500);
  for (let phone = 0; phone < 3; phone++) {
    for (let i = 0; i < 10; i++) {
      const command: ClockCommand = { id: `phone-${phone}-${i}`, epoch: host.epoch, issuedAt: host.now(), key: shot, operation: { action: "adjust", seconds: 1, keepRunning: true } };
      assert.ok(host.receive(command));
      assert.equal(host.receive(command), null);
    }
  }
  host.apply(shot, { action: "adjust", seconds: -1, keepRunning: true });
  assert.equal(clockValue(host.snapshot().clocks[shot], "down", host.now()), 50500);
  assert.equal(host.snapshot().clocks[shot].running, true);
});

test("game and shot clocks keep running through changes, while paused clocks remain paused", () => {
  for (const key of [shot, game]) {
    const { host, advance } = fixture();
    host.apply(key, { action: "start" });
    advance(1234);
    host.apply(key, { action: "reset", seconds: 14, keepRunning: true });
    advance(500);
    host.apply(key, { action: "adjust", seconds: -1, keepRunning: true });
    assert.equal(clockValue(host.snapshot().clocks[key], "down", host.now()), 12500);
    assert.equal(host.snapshot().clocks[key].running, true);
    host.apply(key, { action: "pause" });
    host.apply(key, { action: "reset", seconds: 24, keepRunning: true });
    advance(2000);
    assert.equal(clockValue(host.snapshot().clocks[key], "down", host.now()), 24000);
    assert.equal(host.snapshot().clocks[key].running, false);
  }
});

test("phones with different clocks agree after round-trip synchronization and cannot expire the host", () => {
  const { host, stored, advance } = fixture();
  host.apply(shot, { action: "start" });
  for (const skew of [-7200000, 120000, 86400000]) {
    const replica = new RemoteClocks(() => host.now() + skew);
    replica.probe("sync-test");
    advance(50);
    const state = host.snapshot();
    advance(50);
    assert.equal(replica.accept(state, "sync-test"), true);
    assert.equal(replica.now(), host.now());
    assert.equal(clockValue(replica.snapshot!.clocks[shot], "down", replica.now()), clockValue(host.snapshot().clocks[shot], "down", host.now()));
  }
  advance(30000);
  assert.equal(clockValue(host.snapshot().clocks[shot], "down", host.now()), 0);
  assert.equal(stored.get(shot).baseMs, 24000);
  host.apply(shot, { action: "start" });
  assert.equal(clockValue(host.snapshot().clocks[shot], "down", host.now()), 24000);
});

test("out-of-order snapshots never undo a reset; clock samples from other phones are ignored", () => {
  const { host, advance } = fixture();
  const remote = new RemoteClocks(host.now);
  remote.probe("sync-own");
  remote.accept(host.snapshot(), "sync-own");
  const old = host.apply(shot, { action: "start" });
  advance(3000);
  const latest = host.apply(shot, { action: "reset", seconds: 14, keepRunning: true });
  assert.equal(remote.accept(latest), true);
  assert.equal(remote.accept(old), false);
  assert.equal(remote.accept(old, "other-phone-probe"), false);
  assert.equal(remote.snapshot!.clocks[shot].baseMs, 14000);
});

test("expired, duplicate-host and pre-reconnect commands are rejected", () => {
  const { host, advance } = fixture();
  const c: ClockCommand = { id: "command-id", epoch: host.epoch, issuedAt: host.now(), key: shot, operation: { action: "start" } };
  assert.equal(host.receive({ ...c, epoch: "old-host" }), null);
  advance(6000);
  assert.equal(host.receive(c), null);
  assert.equal(host.snapshot().revision, 0);
});

test("fresh host synchronization after reconnect supersedes the cached timer and rejects prior host packets", () => {
  const { host, advance } = fixture();
  host.apply(game, { action: "start" });
  const cached = host.snapshot();
  advance(5000);
  host.apply(game, { action: "reset", seconds: 120, keepRunning: true });
  const remote = new RemoteClocks(() => host.now() + 3600000);
  assert.equal(remote.accept(cached), false);
  remote.probe("reconnect-probe");
  assert.equal(remote.accept(host.snapshot(), "reconnect-probe"), true);
  assert.equal(remote.accept(cached), false);
  assert.equal(remote.accept({ ...cached, epoch: "other-host", revision: 1000 }), false);
  assert.equal(remote.snapshot!.clocks[game].baseMs, 120000);
  advance(31000);
  assert.equal(remote.ready(), false);
});

test("legacy storage and snapshots cannot overwrite clock state", () => {
  for (const key of [shot, game, "OBS_SOCCER_CLOCK"]) {
    assert.equal((REMOTE_SYNC_KEYS as readonly string[]).includes(key), false);
    assert.equal(parseRemoteClientMessage({ type: "storage", key, value: '{"running":false,"baseMs":0,"startedAt":0}' }), null);
    assert.deepEqual(filterRemoteSnapshot({ [key]: "stale-clock" }), {});
  }
});

test("malformed operations and non-finite times are rejected at the relay boundary", () => {
  const base = { id: "command-id", epoch: "host-epoch", issuedAt: 100, key: shot, operation: { action: "adjust", seconds: Infinity, keepRunning: true } };
  assert.equal(parseRemoteClientMessage({ type: "clock-command", command: base }), null);
  assert.equal(parseRemoteClientMessage({ type: "clock-command", command: { ...base, operation: { action: "delete" } } }), null);
});

test("normal countdown expiry and soccer count-up semantics remain intact", () => {
  const running = { running: true, baseMs: 500, startedAt: 1000 };
  const expired = changeClock(running, "down", { action: "adjust", seconds: -1, keepRunning: true }, 1200, 24);
  assert.deepEqual(expired, { running: false, baseMs: 0, startedAt: 0 });
  assert.deepEqual(changeClock(running, "up", { action: "reset", seconds: 0, keepRunning: false }, 1200, 0), { running: false, baseMs: 0, startedAt: 0 });
});
