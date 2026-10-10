import type { Dispatch, SetStateAction } from "react";
import type { SportKey } from "./sportSettings";

export type ShortcutAction =
  | "score-a-minus" | "score-a-1" | "score-a-2" | "score-a-3"
  | "score-b-minus" | "score-b-1" | "score-b-2" | "score-b-3"
  | "clock-toggle" | "clock-minus" | "clock-plus" | "clock-reset" | "clocks-toggle"
  | "shot-toggle" | "shot-minus" | "shot-plus" | "shot-reset" | "shot-short"
  | "foul-a-minus" | "foul-a-plus" | "foul-b-minus" | "foul-b-plus"
  | "added-minus" | "added-plus" | "ball" | "strike" | "out" | "plate-clear"
  | "base-1" | "base-2" | "base-3" | "serve-a" | "serve-off" | "serve-b"
  | "timeout-a" | "timeout-off" | "timeout-b";
export type ShortcutBinding = { action: ShortcutAction; code: string; key: string; label: string };
export type ShortcutGroup = { title: string; bindings: ShortcutBinding[] };
export type ShortcutHandlers = Partial<Record<ShortcutAction, { run: () => void; enabled?: boolean }>>;

const binding = (action: ShortcutAction, key: string, label: string): ShortcutBinding => ({
  action, key, label, code: key === "Space" ? "Space" : key === ";" ? "Semicolon" : `Key${key}`,
});

const scores = (basketball = false): ShortcutGroup[] => [
  { title: "A팀 점수", bindings: [binding("score-a-minus", "U", "−1점"), binding("score-a-1", "I", "+1점"), ...(basketball ? [binding("score-a-2", "O", "+2점"), binding("score-a-3", "P", "+3점")] : [])] },
  { title: "B팀 점수", bindings: [binding("score-b-minus", "J", "−1점"), binding("score-b-1", "K", "+1점"), ...(basketball ? [binding("score-b-2", "L", "+2점"), binding("score-b-3", ";", "+3점")] : [])] },
];

export const SPORT_SHORTCUTS: Record<SportKey, ShortcutGroup[]> = {
  basketball: [
    { title: "동시 타이머", bindings: [binding("clocks-toggle", "Space", "둘 다 시작·정지")] },
    { title: "게임클락", bindings: [binding("clock-toggle", "Q", "시작·정지"), binding("clock-minus", "W", "−1초"), binding("clock-plus", "E", "+1초"), binding("clock-reset", "R", "쿼터 리셋")] },
    { title: "샷클락", bindings: [binding("shot-toggle", "A", "시작·정지"), binding("shot-minus", "S", "−1초"), binding("shot-plus", "D", "+1초"), binding("shot-reset", "F", "기본 리셋"), binding("shot-short", "G", "리바운드 리셋")] },
    ...scores(true),
    { title: "팀 파울", bindings: [binding("foul-a-minus", "Z", "A팀 −1"), binding("foul-a-plus", "X", "A팀 +1"), binding("foul-b-minus", "C", "B팀 −1"), binding("foul-b-plus", "V", "B팀 +1")] },
  ],
  soccer: [
    { title: "경기 시계", bindings: [binding("clock-toggle", "Q", "시작·정지"), binding("clock-minus", "W", "−1분"), binding("clock-plus", "E", "+1분"), binding("clock-reset", "R", "00:00 리셋")] },
    { title: "추가시간", bindings: [binding("added-minus", "A", "−1분"), binding("added-plus", "S", "+1분")] },
    ...scores(),
  ],
  baseball: [
    { title: "타석 카운트", bindings: [binding("ball", "Q", "볼"), binding("strike", "W", "스트라이크"), binding("out", "E", "아웃"), binding("plate-clear", "R", "볼·스트라이크 초기화")] },
    { title: "주자 표시 전환", bindings: [binding("base-1", "A", "1루"), binding("base-2", "S", "2루"), binding("base-3", "D", "3루")] },
    ...scores(),
  ],
  volleyball: [
    { title: "서브권", bindings: [binding("serve-a", "Q", "A팀"), binding("serve-off", "W", "표시 끔"), binding("serve-b", "E", "B팀")] },
    { title: "타임아웃 표시", bindings: [binding("timeout-a", "A", "A팀 전환"), binding("timeout-off", "S", "표시 끔"), binding("timeout-b", "D", "B팀 전환")] },
    ...scores(),
  ],
};

export function shortcutKey(sport: SportKey, action: ShortcutAction) {
  return SPORT_SHORTCUTS[sport].flatMap((group) => group.bindings).find((item) => item.action === action)?.key;
}

// Match the physical keyboard position, including when Korean input is selected.
// Shift/Ctrl/Alt/Command combinations remain reserved for the browser and OS.
export function matchShortcut(groups: ShortcutGroup[], event: Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "keyCode" | "defaultPrevented">) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return undefined;
  return groups.flatMap((group) => group.bindings).find((item) => item.code === event.code);
}

export function dispatchShortcut(groups: ShortcutGroup[], handlers: ShortcutHandlers, event: Parameters<typeof matchShortcut>[1] & Pick<KeyboardEvent, "repeat" | "preventDefault">) {
  const shortcut = matchShortcut(groups, event);
  if (!shortcut) return false;
  // Also suppress repeats and native Space activation while time is syncing.
  event.preventDefault();
  const handler = handlers[shortcut.action];
  if (!event.repeat && handler && handler.enabled !== false) handler.run();
  return true;
}

// These controls retain their native typing, selection and activation behavior.
export const SHORTCUT_IGNORE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="dialog"], dialog, [data-shortcuts-ignore]';
export const SPACE_IGNORE_SELECTOR = 'a, summary, [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"]';

export function scoreShortcutHandlers(setScores: Dispatch<SetStateAction<[number, number]>>): ShortcutHandlers {
  const change = (index: 0 | 1, amount: number) => ({ run: () => setScores((current) => {
    const next: [number, number] = [...current];
    next[index] = Math.max(0, next[index] + amount);
    return next;
  }) });
  return {
    "score-a-minus": change(0, -1), "score-a-1": change(0, 1), "score-a-2": change(0, 2), "score-a-3": change(0, 3),
    "score-b-minus": change(1, -1), "score-b-1": change(1, 1), "score-b-2": change(1, 2), "score-b-3": change(1, 3),
  };
}
