"use client";

import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { Panel, Scoreboard } from "./ControlPrimitives";
import { ControllerRenderProps, ControllerShell } from "./ControllerShell";
import { BaseballSettings, DEFAULT_BASEBALL_SETTINGS } from "./sportSettings";
import { ControllerShortcuts } from "./ControllerShortcuts";
import { scoreShortcutHandlers } from "./sportShortcuts";
import styles from "./SportController.module.css";

function BaseballControls(props: ControllerRenderProps) {
  const { connected, setText, setVisible, teamA, teamB, swapTeams } = props;
  const [scores, setScores] = useLocalStorage<[number, number]>("OBS_BASEBALL_SCORE", [0, 0]);
  const [hits, setHits] = useLocalStorage<[number, number]>("OBS_BASEBALL_HITS", [0, 0]);
  const [errors, setErrors] = useLocalStorage<[number, number]>("OBS_BASEBALL_ERRORS", [0, 0]);
  const [inning, setInning] = useLocalStorage("OBS_BASEBALL_INNING", 1);
  const [half, setHalf] = useLocalStorage<"TOP" | "BOTTOM">("OBS_BASEBALL_HALF", "TOP");
  const [count, setCount] = useLocalStorage<[number, number, number]>("OBS_BASEBALL_COUNT", [0, 0, 0]);
  const [bases, setBases] = useLocalStorage<[boolean, boolean, boolean]>("OBS_BASEBALL_BASES", [false, false, false]);
  const [settings] = useLocalStorage<BaseballSettings>("OBS_BASEBALL_CONFIG", DEFAULT_BASEBALL_SETTINGS);

  useEffect(() => { if (connected) { setText("score_A", scores[0]); setText("score_B", scores[1]); } }, [connected, scores, setText]);
  useEffect(() => { if (connected) { setText("hits_A", hits[0]); setText("hits_B", hits[1]); setText("errors_A", errors[0]); setText("errors_B", errors[1]); } }, [connected, errors, hits, setText]);
  useEffect(() => { if (connected) { setText("inning", inning); setText("inning_half", half); } }, [connected, half, inning, setText]);
  useEffect(() => { if (connected) { setText("balls", count[0]); setText("strikes", count[1]); setText("outs", count[2]); } }, [connected, count, setText]);
  useEffect(() => {
    if (!connected) return;
    bases.forEach((occupied, index) => setVisible(`base_${index + 1}`, occupied));
  }, [bases, connected, setVisible]);

  const clearPlate = () => setCount((current) => [0, 0, current[2]]);
  const nextHalf = () => {
    if (half === "BOTTOM") setInning((current) => current + 1);
    setHalf((current) => current === "TOP" ? "BOTTOM" : "TOP");
    setCount([0, 0, 0]);
    setBases([false, false, false]);
  };
  const recordOut = () => {
    if (count[2] >= 2) nextHalf();
    else setCount((current) => [0, 0, current[2] + 1]);
  };
  const addBall = () => count[0] >= 3 ? clearPlate() : setCount((current) => [current[0] + 1, current[1], current[2]]);
  const addStrike = () => count[1] >= 2 ? recordOut() : setCount((current) => [current[0], current[1] + 1, current[2]]);
  const toggleBase = (index: number) => setBases((current) => current.map((value, baseIndex) => baseIndex === index ? !value : value) as [boolean, boolean, boolean]);

  const swap = () => {
    setScores(([a, b]) => [b, a]);
    setHits(([a, b]) => [b, a]);
    setErrors(([a, b]) => [b, a]);
    swapTeams();
  };

  const statRow = (team: string, index: 0 | 1) => <div className={styles.statRow}>
    <span>{team}</span>
    <button onClick={() => setHits((current) => index === 0 ? [Math.max(0, current[0] - 1), current[1]] : [current[0], Math.max(0, current[1] - 1)])}>−</button>
    <strong>{hits[index]}H · {errors[index]}E</strong>
    <button onClick={() => setHits((current) => index === 0 ? [current[0] + 1, current[1]] : [current[0], current[1] + 1])}>+H</button>
  </div>;

  return <>
    <ControllerShortcuts sport="baseball" handlers={{
      ...scoreShortcutHandlers(setScores),
      "ball": { run: addBall }, "strike": { run: addStrike }, "out": { run: recordOut }, "plate-clear": { run: clearPlate },
      "base-1": { run: () => toggleBase(0) }, "base-2": { run: () => toggleBase(1) }, "base-3": { run: () => toggleBase(2) },
    }} />
    <Scoreboard teams={[teamA, teamB]} scores={scores} setScores={setScores} onSwap={swap} />
    <Panel title="이닝">
      <div className={styles.labelValue}><span>정규 {settings.regulationInnings}회 · {half === "TOP" ? "초 · AWAY 공격" : "말 · HOME 공격"}</span><strong>{inning}회 {half === "TOP" ? "초" : "말"}</strong></div>
      <div className={`${styles.actionGrid} ${styles.three}`}>
        <button onClick={() => setInning((current) => Math.max(1, current - 1))}>이닝 −</button>
        <button className={styles.primaryAction} onClick={nextHalf}>공수 교대</button>
        <button onClick={() => setInning((current) => current + 1)}>이닝 +</button>
      </div>
    </Panel>
    <Panel title="볼 · 스트라이크 · 아웃">
      <div className={`${styles.counterGrid} ${styles.three}`}>
        <button className={styles.miniCounter} onClick={addBall}><span>BALL</span><strong>{count[0]}</strong></button>
        <button className={styles.miniCounter} onClick={addStrike}><span>STRIKE</span><strong>{count[1]}</strong></button>
        <button className={styles.miniCounter} onClick={recordOut}><span>OUT</span><strong>{count[2]}</strong></button>
      </div>
      <button className={styles.wideButton} onClick={() => setCount([0, 0, 0])}>카운트 초기화</button>
    </Panel>
    <Panel title="주자">
      <div className={`${styles.actionGrid} ${styles.three}`}>
        {bases.map((occupied, index) => <button key={index} className={occupied ? styles.toggleActive : ""} onClick={() => toggleBase(index)}>{index + 1}루</button>)}
      </div>
    </Panel>
    <Panel title="안타 · 실책">
      <div className={styles.statRows}>{statRow(teamA, 0)}{statRow(teamB, 1)}</div>
      <div className={styles.actionGrid} style={{ marginTop: 7 }}>
        <button onClick={() => setErrors((current) => [current[0] + 1, current[1]])}>A 실책 +</button>
        <button onClick={() => setErrors((current) => [current[0], current[1] + 1])}>B 실책 +</button>
        <button onClick={() => setErrors((current) => [Math.max(0, current[0] - 1), current[1]])}>A 실책 −</button>
        <button onClick={() => setErrors((current) => [current[0], Math.max(0, current[1] - 1)])}>B 실책 −</button>
      </div>
    </Panel>
  </>;
}

export default function BaseballController() {
  return <ControllerShell name="야구 컨트롤" sport="baseball" accent="blue">{(props) => <BaseballControls {...props} />}</ControllerShell>;
}
