import assert from "node:assert/strict";
import { test } from "node:test";
import { HostClocks, clockValue, formatObservedClock, type ClockCommand, type ClockOperation } from "../src/components/obs/clockSync";
import { parseRemoteClientMessage } from "../src/components/remote/remoteProtocol";

const key = "OBS_BASKETBALL_SHOT_CLOCK";
function fixture() {
  let now = 100000;
  const host = new HostClocks("camera-host", () => now, () => 24, () => null, () => {});
  let id = 0;
  const observe = (seconds: number, overrides: Partial<Extract<ClockOperation, { action: "observe" }>> = {}) => {
    const command: ClockCommand = { id: `camera-${++id}`, epoch: host.epoch, issuedAt: now, key,
      operation: { action: "observe", seconds, resolutionMs: 1000, capturedAt: now, mode: "preserve", ...overrides } };
    return host.receive(command);
  };
  return { host, observe, advance: (ms: number) => now += ms };
}

test("observations compare display buckets, preserving equal values without rewrites", () => {
  const { host, observe, advance } = fixture();
  host.apply(key, { action: "start" });
  advance(200);
  const first = observe(24)!;
  assert.equal(first.clocks[key].baseMs, 24000, "equal value only adds display metadata");
  advance(50);
  assert.equal(observe(24)!.revision, first.revision);
  advance(100);
  assert.equal(observe(14)!.revision, first.revision + 1);
  assert.equal(host.snapshot().clocks[key].running, true);
  advance(200);
  assert.equal(clockValue(host.snapshot().clocks[key], "down", host.now()), 13800);
});

test("capture-to-host delay is compensated only on a running clock", () => {
  const { host, observe, advance } = fixture();
  host.apply(key, { action: "start" });
  const capturedAt = host.now();
  advance(400);
  const next = observe(4.9, { resolutionMs: 100, capturedAt })!;
  assert.equal(next.clocks[key].baseMs, 4500);
  advance(100);
  assert.equal(observe(3.2, { resolutionMs: 100, mode: "hold" })!.clocks[key].running, false);
  advance(700);
  assert.equal(clockValue(host.snapshot().clocks[key], "down", host.now()), 3200);
});

test("old, future, reordered observations and observations predating manual edits are ignored", () => {
  const { host, observe, advance } = fixture();
  assert.equal(observe(14, { capturedAt: host.now() - 1001 }), null);
  assert.equal(observe(14, { capturedAt: host.now() + 201 }), null);
  const capturedAt = host.now();
  advance(200);
  host.apply(key, { action: "reset", seconds: 24, keepRunning: false });
  assert.equal(observe(14, { capturedAt }), null);
  advance(100);
  assert.ok(observe(14));
  assert.equal(observe(12, { capturedAt: host.now() - 10 }), null);
  assert.equal(host.snapshot().clocks[key].baseMs, 14000);
});

test("camera mode can hold at zero and never expires or modifies the other clock", () => {
  const { host, observe, advance } = fixture();
  host.apply(key, { action: "start" });
  advance(300);
  assert.equal(observe(0, { mode: "hold" })!.clocks[key].running, false);
  assert.equal(host.snapshot().clocks.OBS_BASKETBALL_GAME_CLOCK.baseMs, 24000);
  advance(2000);
  assert.equal(host.snapshot().clocks[key].baseMs, 0);
});

test("observation protocol rejects invalid values and unsupported targets", () => {
  const base = { id: "camera-frame", epoch: "camera-host", issuedAt: 100, key,
    operation: { action: "observe", seconds: 50.1, resolutionMs: 100, capturedAt: 90, mode: "hold" } };
  const parse = (command: unknown) => parseRemoteClientMessage({ type: "clock-command", command });
  assert.ok(parse(base));
  for (const changes of [{ seconds: NaN }, { seconds: -1 }, { seconds: 86401 }, { resolutionMs: 10 }, { capturedAt: Infinity }, { mode: "auto" }, { format: "text" }, { seconds: 50.12 }]) {
    assert.equal(parse({ ...base, operation: { ...base.operation, ...changes } }), null);
  }
  assert.equal(parse({ ...base, key: "OBS_SOCCER_CLOCK" }), null);
});

test("camera punctuation and precision survive OBS rendering; manual edits restore normal formatting", () => {
  const { host, observe, advance } = fixture();
  for (const [seconds, resolutionMs, format, expected] of [
    [50.1, 100, "seconds", "50.1"], [420, 1000, "minutes", "7:00"],
    [223, 1000, "minutes", "3:43"], [0, 100, "seconds", "0.0"],
  ] as const) {
    advance(100);
    const clock = observe(seconds, { resolutionMs, format, mode: "hold" })!.clocks[key];
    assert.equal(formatObservedClock(clock.baseMs, clock.observedDisplay!), expected);
  }
  assert.equal(host.apply(key, { action: "reset", seconds: 24, keepRunning: false }).clocks[key].observedDisplay, undefined);
});
