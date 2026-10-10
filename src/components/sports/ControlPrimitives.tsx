"use client";

import { Dispatch, ReactNode, SetStateAction, useRef, useState } from "react";
import { shortcutKey, type ShortcutAction } from "./sportShortcuts";
import type { SportKey } from "./sportSettings";
import { ClockTimeEditor } from "./ClockTimeEditor";
import styles from "./SportController.module.css";

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className={styles.panel}><header><h2>{title}</h2>{aside}</header>{children}</section>;
}

export function KeyHint({ children }: { children?: string }) {
  return children ? <kbd className={styles.keyHint} aria-hidden="true">{children}</kbd> : null;
}

export function Scoreboard({
  teams,
  scores,
  setScores,
  increments = [1],
  onSwap,
  shortcutSport,
}: {
  teams: [string, string];
  scores: [number, number];
  setScores: Dispatch<SetStateAction<[number, number]>>;
  increments?: number[];
  onSwap?: () => void;
  shortcutSport?: SportKey;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const change = (index: number, delta: number) => setScores((current) => {
    const next: [number, number] = [...current];
    next[index] = Math.max(0, next[index] + delta);
    return next;
  });
  const keyFor = (index: number, amount: number | "minus") => shortcutSport ? shortcutKey(shortcutSport, `score-${index === 0 ? "a" : "b"}-${amount}` as ShortcutAction) : undefined;
  const resetScores = () => {
    setScores([0, 0]);
    setConfirmReset(false);
  };

  return (
    <Panel title="스코어" aside={<div className={styles.panelActions}>
      <button className={styles.textButton} onClick={() => setConfirmReset((value) => !value)} aria-expanded={confirmReset} data-shortcuts-ignore>점수 초기화</button>
      {onSwap && <button className={styles.textButton} onClick={onSwap}>팀 교대</button>}
    </div>}>
      {confirmReset && <div className={styles.resetPrompt} role="group" aria-label="점수 초기화 확인" data-shortcuts-ignore>
        <p>양 팀 점수만 0점으로 초기화할까요?<br />타이머와 다른 경기 기록은 유지됩니다.</p>
        <div className={styles.actionGrid}>
          <button onClick={() => setConfirmReset(false)} autoFocus>취소</button>
          <button className={styles.dangerAction} onClick={resetScores}>점수만 초기화</button>
        </div>
      </div>}
      <div className={styles.scoreboard}>
        {[0, 1].map((index) => (
          <div className={styles.scoreTeam} key={index}>
            <span className={styles.teamName}>{teams[index]}</span>
            <strong>{scores[index]}</strong>
            <div className={styles.scoreActions}>
              <button onClick={() => change(index, -1)} aria-label={`${teams[index]} 1점 감소`} aria-keyshortcuts={keyFor(index, "minus")}>−<KeyHint>{keyFor(index, "minus")}</KeyHint></button>
              {increments.map((amount) => <button key={amount} className={styles.primaryAction} onClick={() => change(index, amount)} aria-keyshortcuts={keyFor(index, amount)}>+{amount}<KeyHint>{keyFor(index, amount)}</KeyHint></button>)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function Segments({ value, items, onChange, label }: {
  value: string;
  items: readonly string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return <div className={styles.segments} role="group" aria-label={label}>{items.map((item) => <button key={item} className={value === item ? styles.active : ""} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

export function MiniCounter({ label, value, onChange, max = 99, shortcuts }: { label: string; value: number; onChange: (value: number) => void; max?: number; shortcuts?: { minus?: string; plus?: string } }) {
  return <div className={styles.miniCounter}><span>{label}</span><div><button onClick={() => onChange(Math.max(0, value - 1))} aria-keyshortcuts={shortcuts?.minus}>−<KeyHint>{shortcuts?.minus}</KeyHint></button><strong>{value}</strong><button onClick={() => onChange(Math.min(max, value + 1))} aria-keyshortcuts={shortcuts?.plus}>+<KeyHint>{shortcuts?.plus}</KeyHint></button></div></div>;
}

export function ClockPanel({ title, value, running, ready = true, onStart, onPause, onReset, presets, adjust, shortcuts, manualEdit }: {
  title: string;
  value: string;
  running: boolean;
  ready?: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  presets?: { label: string; action: () => void; shortcut?: string }[];
  adjust?: { minus: () => void; plus: () => void; label: string };
  shortcuts?: { toggle?: string; reset?: string; minus?: string; plus?: string };
  manualEdit?: { secondsOnly?: boolean; apply: (seconds: number) => void };
}) {
  const [editing, setEditing] = useState(false);
  const lastTap = useRef<number | null>(null);
  const openEditor = () => { if (ready && manualEdit) { lastTap.current = null; setEditing(true); } };
  return <Panel title={title} aside={<span className={`${styles.clockState} ${ready && running ? styles.running : ""}`}>{!ready ? "동기화 중" : running ? "RUN" : "HOLD"}</span>}>
    {editing && manualEdit ? <ClockTimeEditor title={title} value={value} secondsOnly={manualEdit.secondsOnly} ready={ready} onApply={manualEdit.apply} onCancel={() => setEditing(false)} />
      : manualEdit ? <div className={styles.editableClock}>
        <button type="button" className={`${styles.clockValue} ${styles.clockEditTrigger}`} disabled={!ready}
          aria-label={`${title} 시간 수정`} title="더블클릭 또는 두 번 탭하여 시간 수정" data-shortcuts-ignore
          onDoubleClick={openEditor}
          onClick={(event) => { if (event.detail === 0) openEditor(); }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch" || !event.isPrimary) return;
            const now = event.timeStamp;
            if (lastTap.current !== null && now - lastTap.current < 350) openEditor();
            else lastTap.current = now;
          }}>
          {ready ? value : "—"}
        </button>
        <span className={styles.clockEditHint}>숫자를 더블클릭 · 두 번 탭하여 수정</span>
      </div> : <div className={styles.clockValue}>{ready ? value : "—"}</div>}
    <div className={styles.buttonRow}>
      <button disabled={!ready} className={styles.primaryAction} onClick={running ? onPause : onStart} aria-keyshortcuts={shortcuts?.toggle}>{running ? "일시정지" : "시작"}<KeyHint>{shortcuts?.toggle}</KeyHint></button>
      <button disabled={!ready} onClick={onReset} aria-keyshortcuts={shortcuts?.reset}>리셋<KeyHint>{shortcuts?.reset}</KeyHint></button>
    </div>
    {(presets || adjust) && <div className={styles.subActions}>
      {presets?.map((preset) => <button disabled={!ready} key={preset.label} onClick={preset.action} aria-keyshortcuts={preset.shortcut}>{preset.label}<KeyHint>{preset.shortcut}</KeyHint></button>)}
      {adjust && <><button disabled={!ready} onClick={adjust.minus} aria-keyshortcuts={shortcuts?.minus}>− {adjust.label}<KeyHint>{shortcuts?.minus}</KeyHint></button><button disabled={!ready} onClick={adjust.plus} aria-keyshortcuts={shortcuts?.plus}>+ {adjust.label}<KeyHint>{shortcuts?.plus}</KeyHint></button></>}
    </div>}
  </Panel>;
}
