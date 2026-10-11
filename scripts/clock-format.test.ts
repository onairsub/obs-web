import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClock, formatShotClock, formatElapsedClock } from "../src/components/obs/clockFormat";
import { HostClocks, clockValue } from "../src/components/obs/clockSync";
import { previewClock } from "../local-clock/clock-preview.mjs";

test("basketball display preserves the original five-second and one-minute boundaries", () => {
  for (const [ms, expected] of [[24000, "24"], [5100, "6"], [5000, "5"], [4999, "5.0"], [4900, "4.9"], [0, "0.0"], [-100, "0.0"]] as const) {
    assert.equal(formatShotClock(ms), expected);
  }
  for (const [ms, expected] of [[420000, "07:00"], [223000, "03:43"], [60000, "01:00"], [59999, "60.0"], [59900, "59.9"], [50100, "50.1"], [0, "0.0"]] as const) {
    assert.equal(formatClock(ms, true), expected);
  }
  assert.equal(formatClock(50100), "00:51");
  assert.equal(formatElapsedClock(59999), "00:59");
});

test("all tenths remain exact after seconds-to-milliseconds conversion", () => {
  for (let tenths = 0; tenths < 600; tenths++) {
    const seconds = tenths / 10;
    const expected = `${Math.floor(tenths / 10)}.${tenths % 10}`;
    assert.equal(formatClock(seconds * 1000, true), expected, `game ${seconds}`);
    if (tenths < 50) assert.equal(formatShotClock(seconds * 1000), expected, `shot ${seconds}`);
  }
  assert.equal(formatClock(16100.01, true), "16.2", "real sub-millisecond elapsed values are not rounded away");
});

test("local display follows OBS boundaries between polls and holds observed decimals", () => {
  for (const [key, seconds, expected] of [
    ["OBS_BASKETBALL_SHOT_CLOCK", 5, ["5", "4.9", "4.8", "4.7", "4.6"]],
    ["OBS_BASKETBALL_GAME_CLOCK", 60, ["01:00", "59.9", "59.8", "59.7", "59.6"]],
  ] as const) {
    for (let tick = 0; tick < 5; tick++) {
      assert.equal(previewClock(key, { seconds, running: true }, 1000, 1000 + tick * 100)?.text, expected[tick]);
    }
  }
  for (const seconds of [59.8, 32.7, 32.2, 16.1, 4.9, 0]) {
    const clock = { seconds, running: false };
    for (const now of [1000, 1500, 5000]) {
      assert.equal(previewClock("OBS_BASKETBALL_GAME_CLOCK", clock, 1000, now)?.text, formatClock(seconds * 1000, true));
    }
  }
  assert.equal(previewClock("OBS_BASKETBALL_SHOT_CLOCK", { seconds: 1, running: true }, 1000, 4000)?.running, true);
  assert.equal(previewClock("OBS_BASKETBALL_GAME_CLOCK", { seconds: 1, running: true }, 1000, 4000)?.running, false);
  assert.equal(previewClock("OBS_BASKETBALL_GAME_CLOCK", null, 1000, 4000), null);
});

test("an integer camera observation cannot suppress automatic OBS tenths during occlusion", () => {
  let now = 100000;
  const host = new HostClocks("format-host", () => now, () => 24, () => null, () => {});
  const shot = "OBS_BASKETBALL_SHOT_CLOCK", game = "OBS_BASKETBALL_GAME_CLOCK";
  host.apply(shot, { action: "observe", seconds: 5, resolutionMs: 1000, capturedAt: now, mode: "run", format: "seconds" });
  host.apply(game, { action: "observe", seconds: 60, resolutionMs: 1000, capturedAt: now, mode: "run", format: "minutes" });
  now += 100;
  const clocks = host.snapshot().clocks;
  assert.equal(clocks[shot].observedDisplay?.resolutionMs, 1000);
  assert.equal(formatShotClock(clockValue(clocks[shot], "down", now)), "4.9");
  assert.equal(formatClock(clockValue(clocks[game], "down", now), true), "59.9");
  now += 2000;
  assert.equal(formatShotClock(clockValue(clocks[shot], "down", now)), "2.9");
  assert.equal(formatClock(clockValue(clocks[game], "down", now), true), "57.9");
});

test("OCR punctuation is metadata while OBS retains sport formatting and decimal hold behavior", () => {
  let now = 100000;
  const host = new HostClocks("format-host", () => now, () => 24, () => null, () => {});
  const game = "OBS_BASKETBALL_GAME_CLOCK", shot = "OBS_BASKETBALL_SHOT_CLOCK";
  host.apply(game, { action: "observe", seconds: 420, resolutionMs: 1000, capturedAt: now, mode: "hold", format: "seconds" });
  assert.equal(formatClock(host.snapshot().clocks[game].baseMs, true), "07:00");
  host.apply(game, { action: "observe", seconds: 50.1, resolutionMs: 100, capturedAt: now, mode: "hold", format: "minutes" });
  host.apply(shot, { action: "observe", seconds: 4.9, resolutionMs: 100, capturedAt: now, mode: "hold", format: "minutes" });
  now += 2000;
  const clocks = host.snapshot().clocks;
  assert.equal(clocks[game].running, false);
  assert.equal(clocks[shot].running, false);
  assert.equal(formatClock(clockValue(clocks[game], "down", now), true), "50.1");
  assert.equal(formatShotClock(clockValue(clocks[shot], "down", now)), "4.9");
});
