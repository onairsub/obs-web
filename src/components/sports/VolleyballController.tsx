"use client";

import { useEffect, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { MiniCounter, Panel, Scoreboard } from "./ControlPrimitives";
import { ControllerRenderProps, ControllerShell } from "./ControllerShell";
import styles from "./SportController.module.css";

function VolleyballControls(props: ControllerRenderProps) {
  const { connected, setText, setVisible, teamA, teamB, swapTeams } = props;
  const [scores, setScores] = useLocalStorage<[number, number]>("OBS_VOLLEYBALL_SCORE", [0, 0]);
  const [setWins, setSetWins] = useLocalStorage<[number, number]>("OBS_VOLLEYBALL_SETS", [0, 0]);
  const [currentSet, setCurrentSet] = useLocalStorage("OBS_VOLLEYBALL_CURRENT_SET", 1);
  const [setList] = useLocalStorage("OBS_SET_LIST", [25, 25, 15]);
  const [timeouts, setTimeouts] = useLocalStorage<[number, number]>("OBS_VOLLEYBALL_TIMEOUTS", [0, 0]);
  const [timeoutSide, setTimeoutSide] = useLocalStorage<"A" | "B" | "none">("OBS_VOLLEYBALL_TIMEOUT_SIDE", "none");
  const [serve, setServe] = useLocalStorage<"A" | "B" | "none">("OBS_VOLLEYBALL_SERVE", "none");
  const target = setList[currentSet - 1] ?? setList.at(-1) ?? 25;
  const neededSetWins = Math.floor(setList.length / 2) + 1;

  const round = useMemo(() => {
    const leading: 0 | 1 | null = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
    if (leading === null) return { type: "normal", team: null } as const;
    const trailing = leading === 0 ? 1 : 0;
    const nextWinsSet = scores[leading] + 1 >= target && scores[leading] + 1 - scores[trailing] >= 2;
    if (!nextWinsSet) return { type: "normal", team: null } as const;
    return { type: setWins[leading] + 1 >= neededSetWins ? "match" : "set", team: leading } as const;
  }, [neededSetWins, scores, setWins, target]);

  const canFinishSet = Math.max(...scores) >= target && Math.abs(scores[0] - scores[1]) >= 2;

  useEffect(() => { if (connected) { setText("score_A", scores[0]); setText("score_B", scores[1]); } }, [connected, scores, setText]);
  useEffect(() => { if (connected) { setText("set", `${currentSet} SET`); setText("sets_A", setWins[0]); setText("sets_B", setWins[1]); } }, [connected, currentSet, setText, setWins]);
  useEffect(() => { if (connected) { setText("timeouts_A", timeouts[0]); setText("timeouts_B", timeouts[1]); } }, [connected, setText, timeouts]);
  useEffect(() => {
    if (!connected) return;
    setVisible("set_point", round.type === "set");
    setVisible("match_point", round.type === "match");
    setText("point_team", round.team === 0 ? teamA : round.team === 1 ? teamB : "");
  }, [connected, round, setText, setVisible, teamA, teamB]);
  useEffect(() => {
    if (!connected) return;
    setVisible("time_out", timeoutSide !== "none");
    setText("timeout_team", timeoutSide === "A" ? teamA : timeoutSide === "B" ? teamB : "");
  }, [connected, setText, setVisible, teamA, teamB, timeoutSide]);
  useEffect(() => {
    if (!connected) return;
    setVisible("serve_A", serve === "A");
    setVisible("serve_B", serve === "B");
    for (let index = 0; index < 3; index += 1) {
      setVisible(`set_A_${index + 1}`, setWins[0] > index);
      setVisible(`set_B_${index + 1}`, setWins[1] > index);
    }
  }, [connected, serve, setVisible, setWins]);

  const finishSet = () => {
    if (!canFinishSet) return;
    setSetWins((current) => scores[0] > scores[1] ? [current[0] + 1, current[1]] : [current[0], current[1] + 1]);
    setScores([0, 0]);
    setCurrentSet((current) => current + 1);
    setTimeouts([0, 0]);
    setTimeoutSide("none");
  };

  const swap = () => {
    setScores(([a, b]) => [b, a]);
    setSetWins(([a, b]) => [b, a]);
    setTimeouts(([a, b]) => [b, a]);
    setServe((current) => current === "A" ? "B" : current === "B" ? "A" : "none");
    setTimeoutSide((current) => current === "A" ? "B" : current === "B" ? "A" : "none");
    swapTeams();
  };

  return <>
    <Scoreboard teams={[teamA, teamB]} scores={scores} setScores={setScores} onSwap={swap} />
    <Panel title="세트">
      <div className={styles.labelValue}><span>현재 목표 {target}점 · 2점 차 승리</span><strong>{setWins[0]} : {setWins[1]}</strong></div>
      <div className={styles.actionGrid}>
        <button onClick={() => setSetWins((current) => [Math.max(0, current[0] - 1), current[1]])}>A 세트 −</button>
        <button onClick={() => setSetWins((current) => [current[0], Math.max(0, current[1] - 1)])}>B 세트 −</button>
      </div>
      <button className={`${styles.wideButton} ${canFinishSet ? styles.primaryAction : ""}`} disabled={!canFinishSet} onClick={finishSet}>{currentSet}세트 종료</button>
      <p className={styles.helper}>{round.type === "match" ? "매치포인트" : round.type === "set" ? "세트포인트" : `다음 세트포인트까지 ${Math.max(0, target - Math.max(...scores) - 1)}점`}</p>
    </Panel>
    <Panel title="서브 · 타임아웃">
      <div className={`${styles.actionGrid} ${styles.three}`}>
        <button className={serve === "A" ? styles.toggleActive : ""} onClick={() => setServe("A")}>A 서브</button>
        <button className={serve === "none" ? styles.toggleActive : ""} onClick={() => setServe("none")}>서브 끔</button>
        <button className={serve === "B" ? styles.toggleActive : ""} onClick={() => setServe("B")}>B 서브</button>
        <button className={timeoutSide === "A" ? styles.toggleActive : ""} onClick={() => setTimeoutSide((current) => current === "A" ? "none" : "A")}>A 타임아웃</button>
        <button className={timeoutSide === "none" ? styles.toggleActive : ""} onClick={() => setTimeoutSide("none")}>타임아웃 끔</button>
        <button className={timeoutSide === "B" ? styles.toggleActive : ""} onClick={() => setTimeoutSide((current) => current === "B" ? "none" : "B")}>B 타임아웃</button>
      </div>
      <div className={styles.counterGrid} style={{ marginTop: 8 }}>
        <MiniCounter label={`${teamA} 사용`} value={timeouts[0]} onChange={(value) => setTimeouts((current) => [value, current[1]])} max={2} />
        <MiniCounter label={`${teamB} 사용`} value={timeouts[1]} onChange={(value) => setTimeouts((current) => [current[0], value])} max={2} />
      </div>
    </Panel>
    <Panel title="경기 초기화">
      <button className={`${styles.wideButton} ${styles.dangerAction}`} onClick={() => { setScores([0, 0]); setSetWins([0, 0]); setCurrentSet(1); setTimeouts([0, 0]); setTimeoutSide("none"); setServe("none"); }}>전체 점수 초기화</button>
    </Panel>
  </>;
}

export default function VolleyballController() {
  return <ControllerShell name="배구 컨트롤" sport="volleyball" accent="violet">{(props) => <VolleyballControls {...props} />}</ControllerShell>;
}
