"use client";

import { formatClock, formatShotClock, usePersistentClock } from "@/components/obs/usePersistentClock";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { ClockPanel, MiniCounter, Panel, Scoreboard, Segments } from "./ControlPrimitives";
import { ControllerRenderProps, ControllerShell } from "./ControllerShell";
import { BasketballSettings, DEFAULT_BASKETBALL_SETTINGS } from "./sportSettings";
import styles from "./SportController.module.css";

const PERIODS = ["Q1", "Q2", "Q3", "Q4", "OT", "FT"] as const;
const MAX_TEAM_FOULS = 9;
const FOUL_MARKERS = Array.from({ length: MAX_TEAM_FOULS }, (_, index) => index + 1);

function BasketballControls(props: ControllerRenderProps) {
  const { connected, setText, setVisible, teamA, teamB, swapTeams } = props;
  const [scores, setScores] = useLocalStorage<[number, number]>("OBS_BASKETBALL_SCORE", [0, 0]);
  const [period, setPeriod] = useLocalStorage("OBS_BASKETBALL_PERIOD", "Q1");
  const [fouls, setFouls] = useLocalStorage<[number, number]>("OBS_BASKETBALL_FOULS", [0, 0]);
  const [timeouts, setTimeouts] = useLocalStorage<[number, number]>("OBS_BASKETBALL_TIMEOUTS", [0, 0]);
  const [possession, setPossession] = useLocalStorage<"A" | "B" | "none">("OBS_BASKETBALL_POSSESSION", "none");
  const [settings] = useLocalStorage<BasketballSettings>("OBS_BASKETBALL_CONFIG", DEFAULT_BASKETBALL_SETTINGS);
  const gameClock = usePersistentClock("OBS_BASKETBALL_GAME_CLOCK", settings.quarterMinutes * 60, "down", 100);
  const shotClock = usePersistentClock("OBS_BASKETBALL_SHOT_CLOCK", settings.shotClockSeconds, "down", 100);
  const gameClockText = formatClock(gameClock.valueMs, true);
  const shotClockText = formatShotClock(shotClock.valueMs);

  useEffect(() => { if (connected) { setText("score_A", scores[0]); setText("score_B", scores[1]); } }, [connected, scores, setText]);
  useEffect(() => { if (connected) setText("period", period); }, [connected, period, setText]);
  useEffect(() => { if (connected) setText("game_clock", gameClockText); }, [connected, gameClockText, setText]);
  useEffect(() => { if (connected) setText("shot_clock", shotClockText); }, [connected, setText, shotClockText]);
  useEffect(() => {
    if (!connected) return;
    setText("fouls_A", fouls[0]);
    setText("fouls_B", fouls[1]);
    FOUL_MARKERS.forEach((marker) => {
      setVisible(`fouls_A_${marker}`, fouls[0] >= marker);
      setVisible(`fouls_B_${marker}`, fouls[1] >= marker);
    });
  }, [connected, fouls, setText, setVisible]);
  useEffect(() => { if (connected) { setText("timeouts_A", timeouts[0]); setText("timeouts_B", timeouts[1]); } }, [connected, setText, timeouts]);
  useEffect(() => {
    if (!connected) return;
    setVisible("possession_A", possession === "A");
    setVisible("possession_B", possession === "B");
  }, [connected, possession, setVisible]);

  const startAll = () => { gameClock.start(); shotClock.start(); };
  const pauseAll = () => { gameClock.pause(); shotClock.pause(); };
  const swap = () => {
    setScores(([a, b]) => [b, a]);
    setFouls(([a, b]) => [b, a]);
    setTimeouts(([a, b]) => [b, a]);
    setPossession((current) => current === "A" ? "B" : current === "B" ? "A" : "none");
    swapTeams();
  };

  return <>
    <Scoreboard teams={[teamA, teamB]} scores={scores} setScores={setScores} increments={[1, 2, 3]} onSwap={swap} />
    <Panel title="동시 타이머">
      <div className={styles.actionGrid}>
        <button disabled={!gameClock.ready || !shotClock.ready} className={styles.primaryAction} onClick={startAll}>둘 다 시작</button>
        <button disabled={!gameClock.ready || !shotClock.ready} onClick={pauseAll}>둘 다 정지</button>
      </div>
      <p className={styles.helper}>게임클락과 샷클락은 독립 조작도 가능합니다.</p>
    </Panel>
    <ClockPanel
      title="게임클락"
      value={gameClockText}
      running={gameClock.running}
      ready={gameClock.ready}
      onStart={gameClock.start}
      onPause={gameClock.pause}
      onReset={() => gameClock.reset(settings.quarterMinutes * 60, true)}
      presets={[
        { label: `쿼터 ${settings.quarterMinutes}:00`, action: () => gameClock.reset(settings.quarterMinutes * 60, true) },
        { label: `연장 ${settings.overtimeMinutes}:00`, action: () => gameClock.reset(settings.overtimeMinutes * 60, true) },
      ]}
      adjust={{ label: "1초", minus: () => gameClock.adjust(-1, true), plus: () => gameClock.adjust(1, true) }}
    />
    <ClockPanel
      title="샷클락"
      value={shotClockText}
      running={shotClock.running}
      ready={shotClock.ready}
      onStart={shotClock.start}
      onPause={shotClock.pause}
      onReset={() => shotClock.reset(settings.shotClockSeconds, true)}
      presets={[
        { label: `${settings.shotClockSeconds}초`, action: () => shotClock.reset(settings.shotClockSeconds, true) },
        { label: `${settings.shortShotClockSeconds}초`, action: () => shotClock.reset(settings.shortShotClockSeconds, true) },
      ]}
      adjust={{ label: "1초", minus: () => shotClock.adjust(-1, true), plus: () => shotClock.adjust(1, true) }}
    />
    <Panel title="쿼터 · 팀 상태">
      <Segments value={period} items={PERIODS} onChange={setPeriod} label="농구 쿼터" />
      <div className={styles.counterGrid} style={{ marginTop: 8 }}>
        <MiniCounter label={`${teamA} 파울`} value={fouls[0]} onChange={(value) => setFouls((current) => [value, current[1]])} max={MAX_TEAM_FOULS} />
        <MiniCounter label={`${teamB} 파울`} value={fouls[1]} onChange={(value) => setFouls((current) => [current[0], value])} max={MAX_TEAM_FOULS} />
        <MiniCounter label={`${teamA} 타임아웃`} value={timeouts[0]} onChange={(value) => setTimeouts((current) => [value, current[1]])} max={7} />
        <MiniCounter label={`${teamB} 타임아웃`} value={timeouts[1]} onChange={(value) => setTimeouts((current) => [current[0], value])} max={7} />
      </div>
      <div className={`${styles.actionGrid} ${styles.three}`} style={{ marginTop: 8 }}>
        <button className={possession === "A" ? styles.toggleActive : ""} onClick={() => setPossession("A")}>A 공격권</button>
        <button className={possession === "none" ? styles.toggleActive : ""} onClick={() => setPossession("none")}>공격권 끔</button>
        <button className={possession === "B" ? styles.toggleActive : ""} onClick={() => setPossession("B")}>B 공격권</button>
      </div>
    </Panel>
  </>;
}

export default function BasketballController() {
  return <ControllerShell name="농구 컨트롤" sport="basketball" accent="orange">{(props) => <BasketballControls {...props} />}</ControllerShell>;
}
