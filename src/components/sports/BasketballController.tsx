"use client";

import { formatClock, formatShotClock, usePersistentClock } from "@/components/obs/usePersistentClock";
import { useBasketballFoulSync } from "@/components/obs/useBasketballFoulSync";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { ClockPanel, KeyHint, MiniCounter, Panel, Scoreboard, Segments } from "./ControlPrimitives";
import { ControllerRenderProps, ControllerShell } from "./ControllerShell";
import { BasketballSettings, DEFAULT_BASKETBALL_SETTINGS } from "./sportSettings";
import { ControllerShortcuts } from "./ControllerShortcuts";
import { scoreShortcutHandlers, shortcutKey, type ShortcutAction } from "./sportShortcuts";
import styles from "./SportController.module.css";

const PERIODS = ["Q1", "Q2", "Q3", "Q4", "OT", "FT"] as const;
const MAX_TEAM_FOULS = 9;
const keyFor = (action: ShortcutAction) => shortcutKey("basketball", action);

function BasketballControls(props: ControllerRenderProps) {
  const { connected, setText, setVisible, teamA, teamB, swapTeams } = props;
  const [scores, setScores] = useLocalStorage<[number, number]>("OBS_BASKETBALL_SCORE", [0, 0]);
  const [period, setPeriod] = useLocalStorage("OBS_BASKETBALL_PERIOD", "Q1");
  const [fouls, setFouls] = useLocalStorage<[number, number]>("OBS_BASKETBALL_FOULS", [0, 0]);
  const foulSyncError = useBasketballFoulSync(fouls);
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
  useEffect(() => { if (connected) { setText("timeouts_A", timeouts[0]); setText("timeouts_B", timeouts[1]); } }, [connected, setText, timeouts]);
  useEffect(() => {
    if (!connected) return;
    setVisible("possession_A", possession === "A");
    setVisible("possession_B", possession === "B");
  }, [connected, possession, setVisible]);

  const startAll = () => { gameClock.start(); shotClock.start(); };
  const pauseAll = () => { gameClock.pause(); shotClock.pause(); };
  const changePeriod = (next: string) => {
    if (next === period) return;
    setPeriod(next);
    setFouls([0, 0]);
    setTimeouts([0, 0]);
  };
  const anyClockRunning = gameClock.running || shotClock.running;
  const changeFoul = (index: 0 | 1, delta: number) => setFouls((current) => {
    const next: [number, number] = [...current];
    next[index] = Math.max(0, Math.min(MAX_TEAM_FOULS, next[index] + delta));
    return next;
  });
  const swap = () => {
    setScores(([a, b]) => [b, a]);
    setFouls(([a, b]) => [b, a]);
    setTimeouts(([a, b]) => [b, a]);
    setPossession((current) => current === "A" ? "B" : current === "B" ? "A" : "none");
    swapTeams();
  };

  return <>
    <ControllerShortcuts sport="basketball" handlers={{
      ...scoreShortcutHandlers(setScores),
      "clocks-toggle": { enabled: gameClock.ready && shotClock.ready, run: () => gameClock.running || shotClock.running ? pauseAll() : startAll() },
      "clock-toggle": { enabled: gameClock.ready, run: () => gameClock.running ? gameClock.pause() : gameClock.start() },
      "clock-minus": { enabled: gameClock.ready, run: () => gameClock.adjust(-1, true) },
      "clock-plus": { enabled: gameClock.ready, run: () => gameClock.adjust(1, true) },
      "clock-reset": { enabled: gameClock.ready, run: () => gameClock.reset(settings.quarterMinutes * 60, true) },
      "shot-toggle": { enabled: shotClock.ready, run: () => shotClock.running ? shotClock.pause() : shotClock.start() },
      "shot-minus": { enabled: shotClock.ready, run: () => shotClock.adjust(-1, true) },
      "shot-plus": { enabled: shotClock.ready, run: () => shotClock.adjust(1, true) },
      "shot-reset": { enabled: shotClock.ready, run: () => shotClock.reset(settings.shotClockSeconds, true) },
      "shot-short": { enabled: shotClock.ready, run: () => shotClock.reset(settings.shortShotClockSeconds, true) },
      "foul-a-minus": { run: () => changeFoul(0, -1) }, "foul-a-plus": { run: () => changeFoul(0, 1) },
      "foul-b-minus": { run: () => changeFoul(1, -1) }, "foul-b-plus": { run: () => changeFoul(1, 1) },
    }} />
    <Scoreboard teams={[teamA, teamB]} scores={scores} setScores={setScores} increments={[1, 2, 3]} onSwap={swap} shortcutSport="basketball" />
    <Panel title="동시 타이머">
      <div className={styles.actionGrid}>
        <button disabled={!gameClock.ready || !shotClock.ready} className={styles.primaryAction} onClick={startAll} aria-keyshortcuts={!anyClockRunning ? keyFor("clocks-toggle") : undefined}>둘 다 시작<KeyHint>{!anyClockRunning ? keyFor("clocks-toggle") : undefined}</KeyHint></button>
        <button disabled={!gameClock.ready || !shotClock.ready} onClick={pauseAll} aria-keyshortcuts={anyClockRunning ? keyFor("clocks-toggle") : undefined}>둘 다 정지<KeyHint>{anyClockRunning ? keyFor("clocks-toggle") : undefined}</KeyHint></button>
      </div>
      <p className={styles.helper}>게임클락과 샷클락은 독립 조작도 가능합니다.</p>
    </Panel>
    <ClockPanel
      title="게임클락"
      value={gameClockText}
      running={gameClock.running}
      ready={gameClock.ready}
      manualEdit={{ apply: (seconds) => gameClock.reset(seconds, true) }}
      shortcuts={{ toggle: keyFor("clock-toggle"), reset: keyFor("clock-reset"), minus: keyFor("clock-minus"), plus: keyFor("clock-plus") }}
      onStart={gameClock.start}
      onPause={gameClock.pause}
      onReset={() => gameClock.reset(settings.quarterMinutes * 60, true)}
      presets={[
        { label: `쿼터 ${settings.quarterMinutes}:00`, action: () => gameClock.reset(settings.quarterMinutes * 60, true), shortcut: keyFor("clock-reset") },
        { label: `연장 ${settings.overtimeMinutes}:00`, action: () => gameClock.reset(settings.overtimeMinutes * 60, true) },
      ]}
      adjust={{ label: "1초", minus: () => gameClock.adjust(-1, true), plus: () => gameClock.adjust(1, true) }}
    />
    <ClockPanel
      title="샷클락"
      value={shotClockText}
      running={shotClock.running}
      ready={shotClock.ready}
      manualEdit={{ secondsOnly: true, apply: (seconds) => shotClock.reset(seconds, true) }}
      shortcuts={{ toggle: keyFor("shot-toggle"), reset: keyFor("shot-reset"), minus: keyFor("shot-minus"), plus: keyFor("shot-plus") }}
      onStart={shotClock.start}
      onPause={shotClock.pause}
      onReset={() => shotClock.reset(settings.shotClockSeconds, true)}
      presets={[
        { label: `${settings.shotClockSeconds}초`, action: () => shotClock.reset(settings.shotClockSeconds, true), shortcut: keyFor("shot-reset") },
        { label: `${settings.shortShotClockSeconds}초`, action: () => shotClock.reset(settings.shortShotClockSeconds, true), shortcut: keyFor("shot-short") },
      ]}
      adjust={{ label: "1초", minus: () => shotClock.adjust(-1, true), plus: () => shotClock.adjust(1, true) }}
    />
    <Panel title="쿼터 · 팀 상태">
      <Segments value={period} items={PERIODS} onChange={changePeriod} label="농구 쿼터" />
      <div className={styles.counterGrid} style={{ marginTop: 8 }}>
        <MiniCounter label={`${teamA} 파울`} value={fouls[0]} onChange={(value) => setFouls((current) => [value, current[1]])} max={MAX_TEAM_FOULS} shortcuts={{ minus: keyFor("foul-a-minus"), plus: keyFor("foul-a-plus") }} />
        <MiniCounter label={`${teamB} 파울`} value={fouls[1]} onChange={(value) => setFouls((current) => [current[0], value])} max={MAX_TEAM_FOULS} shortcuts={{ minus: keyFor("foul-b-minus"), plus: keyFor("foul-b-plus") }} />
        <MiniCounter label={`${teamA} 타임아웃`} value={timeouts[0]} onChange={(value) => setTimeouts((current) => [value, current[1]])} max={7} />
        <MiniCounter label={`${teamB} 타임아웃`} value={timeouts[1]} onChange={(value) => setTimeouts((current) => [current[0], value])} max={7} />
      </div>
      <div className={`${styles.actionGrid} ${styles.three}`} style={{ marginTop: 8 }}>
        <button className={possession === "A" ? styles.toggleActive : ""} onClick={() => setPossession("A")}>A 공격권</button>
        <button className={possession === "none" ? styles.toggleActive : ""} onClick={() => setPossession("none")}>공격권 끔</button>
        <button className={possession === "B" ? styles.toggleActive : ""} onClick={() => setPossession("B")}>B 공격권</button>
      </div>
      {foulSyncError && <p className={styles.helper} role="alert">{foulSyncError}</p>}
    </Panel>
  </>;
}

export default function BasketballController() {
  return <ControllerShell name="농구 컨트롤" sport="basketball" accent="orange">{(props) => <BasketballControls {...props} />}</ControllerShell>;
}
