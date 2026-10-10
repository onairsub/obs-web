"use client";

import { useId, useRef, useState } from "react";
import { parseClockText } from "./clockInput";
import styles from "./SportController.module.css";

export function ClockTimeEditor({ title, value, ready, secondsOnly = false, onApply, onCancel }: {
  title: string;
  value: string;
  ready: boolean;
  secondsOnly?: boolean;
  onApply: (seconds: number) => void;
  onCancel: () => void;
}) {
  // Keep the number in place and freeze only the draft, not the running clock.
  const [draft, setDraft] = useState(value);
  const original = useRef(value);
  const [error, setError] = useState("");
  const finished = useRef(false);
  const descriptionId = useId();
  const apply = () => {
    if (finished.current || !ready) return;
    if (draft.trim() === original.current) {
      finished.current = true;
      onCancel();
      return;
    }
    const seconds = parseClockText(draft, secondsOnly);
    if (seconds === null) {
      setError(secondsOnly ? "초를 입력하세요. 예: 24, 4.9" : "분:초 또는 초를 입력하세요. 예: 02:34, 59.9");
      return;
    }
    finished.current = true;
    onApply(seconds);
    onCancel();
  };
  return <div className={styles.editableClock} data-shortcuts-ignore>
    <input className={`${styles.clockValue} ${styles.clockInlineInput}`} type="text"
      inputMode={secondsOnly ? "decimal" : "text"} enterKeyHint="done" autoComplete="off" spellCheck={false}
      autoFocus maxLength={9} disabled={!ready} aria-label={`${title} 시간 입력`} aria-describedby={descriptionId}
      aria-invalid={Boolean(error)} value={draft}
      onFocus={(event) => event.target.select()}
      onChange={(event) => { setDraft(event.target.value); setError(""); }}
      onBlur={apply}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); apply(); }
        if (event.key === "Escape") { event.preventDefault(); finished.current = true; onCancel(); }
      }} />
    <span id={descriptionId} className={styles.clockEditHint}>{secondsOnly ? "초" : "분:초 / 초"} 입력 · Enter 적용 · Esc 취소</span>
    {error && <p className={styles.inputError} role="alert">{error}</p>}
  </div>;
}
