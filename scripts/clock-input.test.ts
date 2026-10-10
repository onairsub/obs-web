import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClockText, parseClockInput, parseShotClockInput } from "../src/components/sports/clockInput";
import { clockValue, HostClocks, RemoteClocks, type ClockCommand } from "../src/components/obs/clockSync";

test("manual minutes/seconds support zero, leading zeroes and tenths without accepting invalid input", () => {
  assert.equal(parseClockInput("0", "0"), 0);
  assert.equal(parseClockInput(" 02 ", "03.4"), 123.4);
  assert.equal(parseClockInput("9", "59.9"), 599.9);
  assert.equal(parseClockInput("1440", "0"), 86400);
  for (const [m, s] of [["", "0"], ["0", ""], ["-1", "0"], ["1.5", "0"], ["0", "60"], ["0", "-1"], ["0", "1.23"], ["1e2", "0"], ["0", "Infinity"], ["1440", "0.1"], ["999999999999999999999", "0"]]) {
    assert.equal(parseClockInput(m, s), null, `${m}:${s}`);
  }
});

test("inline clock text accepts MM:SS, MM:SS.d and seconds-only without ambiguous extra fields", () => {
  assert.equal(parseClockText("02:34.5"), 154.5);
  assert.equal(parseClockText("10:00"), 600);
  assert.equal(parseClockText("59.9"), 59.9);
  assert.equal(parseClockText("0"), 0);
  for (const invalid of ["2:60", "1:2:3", ":30", "2:", "2:3.44", "24h", ""]) assert.equal(parseClockText(invalid), null);
  assert.equal(parseClockText("1:24", true), null);
});

test("shot clock accepts a single seconds value including tenths but rejects invalid drafts", () => {
  for (const value of ["0", "24", "14.5", "4.9", "120", "86400"]) assert.equal(parseShotClockInput(value), Number(value));
  for (const value of ["", " ", "-1", "1e2", "2.55", "Infinity", "1:24", "86400.1"]) assert.equal(parseShotClockInput(value), null);
});

test("manual remote edit preserves host running state, reaches all replicas and never changes shot clock", () => {
  const game = "OBS_BASKETBALL_GAME_CLOCK"; const shot = "OBS_BASKETBALL_SHOT_CLOCK";
  let now = 100000;
  const host = new HostClocks("host", () => now, () => 600, () => undefined, () => {});
  host.apply(game, { action: "start" });
  const phones = [0, 3600000, -3600000].map((offset, i) => {
    const remote = new RemoteClocks(() => now + offset);
    remote.probe(`probe-${i}`); remote.accept(host.snapshot(), `probe-${i}`);
    return remote;
  });
  const shotBefore = host.snapshot().clocks[shot];
  const command: ClockCommand = { id: "manual-edit-1", key: game, epoch: host.epoch, issuedAt: now,
    operation: { action: "reset", seconds: parseClockInput("2", "34.5")!, keepRunning: true } };
  now += 50;
  const snapshot = host.receive(command)!;
  assert.equal(snapshot.clocks[game].baseMs, 154500);
  assert.equal(snapshot.clocks[game].running, true);
  assert.equal(host.receive(command), null);
  for (const phone of phones) assert.equal(phone.accept(snapshot), true);
  now += 1200;
  for (const phone of phones) assert.equal(clockValue(phone.snapshot!.clocks[game], "down", phone.now()), 153300);
  host.apply(game, { action: "pause" });
  const paused = host.apply(game, { action: "reset", seconds: 12.3, keepRunning: true });
  assert.equal(paused.clocks[game].running, false);
  assert.equal(paused.clocks[game].baseMs, 12300);
  host.apply(game, { action: "start" });
  const zero = host.apply(game, { action: "reset", seconds: 0, keepRunning: true });
  assert.equal(zero.clocks[game].running, false);
  assert.deepEqual(zero.clocks[shot], shotBefore);
});
