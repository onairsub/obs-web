"use client";

import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useRemoteControl } from "../remote/RemoteControlContext";
import { dispatchShortcut, SHORTCUT_IGNORE_SELECTOR, SPACE_IGNORE_SELECTOR, SPORT_SHORTCUTS, type ShortcutHandlers } from "./sportShortcuts";
import type { SportKey } from "./sportSettings";
import styles from "./SportController.module.css";

export function ShortcutGuide({ sport }: { sport: SportKey }) {
  return <div className={styles.shortcutGuide}>
    {SPORT_SHORTCUTS[sport].map((group) => <section key={group.title}>
      <h3>{group.title}</h3>
      <dl>{group.bindings.map((item) => <div key={item.action}><dt><kbd>{item.key}</kbd></dt><dd>{item.label}</dd></div>)}</dl>
    </section>)}
    <p>이 웹페이지에 포커스가 있을 때만 동작합니다. 입력창·선택 메뉴·한글 조합 중에는 작동하지 않으며, 길게 눌러도 한 번만 반영됩니다. 한/영 전환과 무관하게 영문 키 위치를 사용합니다.</p>
    {sport === "basketball" && <p>리셋 시간은 경기 설정을 따릅니다. Space는 컨트롤 버튼에 포커스가 있어도 타이머를 제어합니다. 선택한 버튼 실행은 Enter를 사용하세요.</p>}
  </div>;
}

export function ControllerShortcuts({ sport, handlers }: { sport: SportKey; handlers: ShortcutHandlers }) {
  // A device preference, deliberately excluded from remote match synchronization.
  const [enabled, setEnabled] = useLocalStorage("OBS_KEYBOARD_SHORTCUTS", true, { initializeWithValue: false });
  const { role, status } = useRemoteControl();
  const available = role !== "remote" || status === "active";

  useEffect(() => {
    if (!enabled || !available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.visibilityState === "hidden") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(SHORTCUT_IGNORE_SELECTOR)) return;
      if (event.code === "Space" && target?.closest(SPACE_IGNORE_SELECTOR)) return;
      dispatchShortcut(SPORT_SHORTCUTS[sport], handlers, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available, enabled, handlers, sport]);

  return <details className={styles.shortcuts} data-shortcuts-ignore>
    <summary>키보드 단축키 <span>{!enabled ? "OFF" : available ? "ON" : "연결 대기"}</span></summary>
    <div className={styles.shortcutBody}>
      <label className={styles.shortcutSwitch}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />이 브라우저에서 단축키 사용</label>
      <ShortcutGuide sport={sport} />
    </div>
  </details>;
}
