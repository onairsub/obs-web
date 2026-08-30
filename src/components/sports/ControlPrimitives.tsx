"use client";

import { Dispatch, ReactNode, SetStateAction } from "react";
import styles from "./SportController.module.css";

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className={styles.panel}><header><h2>{title}</h2>{aside}</header>{children}</section>;
}

export function Scoreboard({
  teams,
  scores,
  setScores,
  increments = [1],
  onSwap,
}: {
  teams: [string, string];
  scores: [number, number];
  setScores: Dispatch<SetStateAction<[number, number]>>;
  increments?: number[];
  onSwap?: () => void;
}) {
  const change = (index: number, delta: number) => setScores((current) => {
    const next: [number, number] = [...current];
    next[index] = Math.max(0, next[index] + delta);
    return next;
  });

  return (
    <Panel title="스코어" aside={onSwap ? <button className={styles.textButton} onClick={onSwap}>팀 교대</button> : undefined}>
      <div className={styles.scoreboard}>
        {[0, 1].map((index) => (
          <div className={styles.scoreTeam} key={index}>
            <span className={styles.teamName}>{teams[index]}</span>
            <strong>{scores[index]}</strong>
            <div className={styles.scoreActions}>
              <button onClick={() => change(index, -1)} aria-label={`${teams[index]} 1점 감소`}>−</button>
              {increments.map((amount) => <button key={amount} className={styles.primaryAction} onClick={() => change(index, amount)}>+{amount}</button>)}
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

export function MiniCounter({ label, value, onChange, max = 99 }: { label: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <div className={styles.miniCounter}><span>{label}</span><div><button onClick={() => onChange(Math.max(0, value - 1))}>−</button><strong>{value}</strong><button onClick={() => onChange(Math.min(max, value + 1))}>+</button></div></div>;
}

export function ClockPanel({ title, value, running, onStart, onPause, onReset, presets, adjust }: {
  title: string;
  value: string;
  running: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  presets?: { label: string; action: () => void }[];
  adjust?: { minus: () => void; plus: () => void; label: string };
}) {
  return <Panel title={title} aside={<span className={`${styles.clockState} ${running ? styles.running : ""}`}>{running ? "RUN" : "HOLD"}</span>}>
    <div className={styles.clockValue}>{value}</div>
    <div className={styles.buttonRow}>
      <button className={styles.primaryAction} onClick={running ? onPause : onStart}>{running ? "일시정지" : "시작"}</button>
      <button onClick={onReset}>리셋</button>
    </div>
    {(presets || adjust) && <div className={styles.subActions}>
      {presets?.map((preset) => <button key={preset.label} onClick={preset.action}>{preset.label}</button>)}
      {adjust && <><button onClick={adjust.minus}>− {adjust.label}</button><button onClick={adjust.plus}>+ {adjust.label}</button></>}
    </div>}
  </Panel>;
}
