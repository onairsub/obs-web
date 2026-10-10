import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchShortcut, matchShortcut, scoreShortcutHandlers, SPORT_SHORTCUTS, type ShortcutHandlers } from "../src/components/sports/sportShortcuts";
import { HostClocks } from "../src/components/obs/clockSync";

const key = (code: string, overrides: Record<string, unknown> = {}) => ({
  code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false,
  keyCode: 0, defaultPrevented: false, repeat: false,
  preventDefault() { this.defaultPrevented = true; },
  ...overrides,
});

test("every sport has unique single-key actions; related controls use adjacent keys", () => {
  for (const groups of Object.values(SPORT_SHORTCUTS)) {
    const bindings = groups.flatMap((group) => group.bindings);
    assert.equal(new Set(bindings.map((item) => item.code)).size, bindings.length);
    assert.equal(new Set(bindings.map((item) => item.action)).size, bindings.length);
    for (const item of bindings) {
      assert.match(item.code, /^(Key[A-Z]|Space|Semicolon)$/);
      assert.equal(matchShortcut(groups, key(item.code))?.action, item.action);
    }
  }
  const groups = SPORT_SHORTCUTS.basketball;
  assert.deepEqual(groups.find((g) => g.title === "게임클락")?.bindings.map((b) => b.key), ["Q", "W", "E", "R"]);
  assert.deepEqual(groups.find((g) => g.title === "샷클락")?.bindings.map((b) => b.key), ["A", "S", "D", "F", "G"]);
  assert.deepEqual(groups.find((g) => g.title === "A팀 점수")?.bindings.map((b) => b.key), ["U", "I", "O", "P"]);
  assert.deepEqual(groups.find((g) => g.title === "B팀 점수")?.bindings.map((b) => b.key), ["J", "K", "L", ";"]);
});

test("browser modifiers, IME composition and consumed events are never intercepted", () => {
  for (const flag of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing", "defaultPrevented"]) {
    assert.equal(matchShortcut(SPORT_SHORTCUTS.basketball, key("KeyQ", { [flag]: true })), undefined);
  }
  assert.equal(matchShortcut(SPORT_SHORTCUTS.basketball, key("KeyQ", { keyCode: 229 })), undefined);
  assert.equal(matchShortcut(SPORT_SHORTCUTS.basketball, key("KeyQ", { key: "ㅂ" }))?.action, "clock-toggle");
  assert.equal(matchShortcut(SPORT_SHORTCUTS.basketball, key("Escape")), undefined);
});

test("held keys execute only once and syncing timers cannot execute or activate a focused button", () => {
  let calls = 0;
  const handlers: ShortcutHandlers = { "clocks-toggle": { run: () => { calls++; } } };
  const first = key("Space");
  assert.equal(dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, first), true);
  for (let i = 0; i < 10; i++) {
    const repeated = key("Space", { repeat: true });
    dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, repeated);
    assert.equal(repeated.defaultPrevented, true);
  }
  assert.equal(calls, 1);
  handlers["clocks-toggle"]!.enabled = false;
  const syncing = key("Space");
  dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, syncing);
  assert.equal(syncing.defaultPrevented, true);
  assert.equal(calls, 1);
});

test("score operations accumulate without negative scores and only affect their team", () => {
  let scores: [number, number] = [0, 0];
  const handlers = scoreShortcutHandlers((value) => { scores = typeof value === "function" ? value(scores) : value; });
  for (const code of ["KeyU", "KeyI", "KeyO", "KeyP", "KeyK", "KeyL", "Semicolon", "KeyJ"]) {
    dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, key(code));
  }
  assert.deepEqual(scores, [6, 5]);
  for (let i = 0; i < 10; i++) dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, key("KeyU"));
  assert.deepEqual(scores, [0, 5]);
});

test("shortcut clock operations retain host authority and configured running resets", () => {
  let now = 1000;
  const clocks = new HostClocks("keyboard-host", () => now, () => 30, () => null, () => {});
  const shot = "OBS_BASKETBALL_SHOT_CLOCK";
  const handlers: ShortcutHandlers = {
    "shot-toggle": { run: () => clocks.apply(shot, { action: "start" }) },
    "shot-plus": { run: () => clocks.apply(shot, { action: "adjust", seconds: 1, keepRunning: true }) },
    "shot-reset": { run: () => clocks.apply(shot, { action: "reset", seconds: 30, keepRunning: true }) },
    "shot-short": { run: () => clocks.apply(shot, { action: "reset", seconds: 15, keepRunning: true }) },
  };
  for (const code of ["KeyA", "KeyD", "KeyF", "KeyG"]) {
    dispatchShortcut(SPORT_SHORTCUTS.basketball, handlers, key(code));
    now += 100;
  }
  assert.equal(clocks.snapshot().revision, 4);
  assert.equal(clocks.snapshot().clocks[shot].baseMs, 15000);
  assert.equal(clocks.snapshot().clocks[shot].running, true);
});
