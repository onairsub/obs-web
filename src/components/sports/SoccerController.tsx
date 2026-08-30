"use client";

import { formatElapsedClock, usePersistentClock } from "@/components/obs/usePersistentClock";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { ClockPanel, MiniCounter, Panel, Scoreboard, Segments } from "./ControlPrimitives";
import { ControllerRenderProps, ControllerShell } from "./ControllerShell";
import { DEFAULT_SOCCER_SETTINGS, SoccerSettings } from "./sportSettings";
import styles from "./SportController.module.css";

const PERIODS = ["전반", "HT", "후반", "연장1", "연장2", "PK", "FT"] as const;

function SoccerControls(props: ControllerRenderProps) {
  const { connected, setText, setVisible, teamA, teamB, swapTeams } = props;
  const [scores, setScores] = useLocalStorage<[number, number]>("OBS_SOCCER_SCORE", [0, 0]);
  const [period, setPeriod] = useLocalStorage("OBS_SOCCER_PERIOD", "전반");
  const [addedTime, setAddedTime] = useLocalStorage("OBS_SOCCER_ADDED_TIME", 0);
  const [redCards, setRedCards] = useLocalStorage<[number, number]>("OBS_SOCCER_RED_CARDS", [0, 0]);
  const [penalties, setPenalties] = useLocalStorage<[number, number]>("OBS_SOCCER_PENALTIES", [0, 0]);
  const [settings] = useLocalStorage<SoccerSettings>("OBS_SOCCER_CONFIG", DEFAULT_SOCCER_SETTINGS);
  const clock = usePersistentClock("OBS_SOCCER_CLOCK", 0, "up", 250);
  const clockText = formatElapsedClock(clock.valueMs);

  useEffect(() => { if (connected) { setText("score_A", scores[0]); setText("score_B", scores[1]); } }, [connected, scores, setText]);
  useEffect(() => { if (connected) setText("period", period); }, [connected, period, setText]);
  useEffect(() => { if (connected) setText("game_clock", clockText); }, [clockText, connected, setText]);
  useEffect(() => {
    if (!connected) return;
    setText("added_time", addedTime > 0 ? `+${addedTime}` : "");
    setVisible("added_time", addedTime > 0);
  }, [addedTime, connected, setText, setVisible]);
  useEffect(() => { if (connected) { setText("red_cards_A", redCards[0]); setText("red_cards_B", redCards[1]); } }, [connected, redCards, setText]);
  useEffect(() => { if (connected) { setText("penalties_A", penalties[0]); setText("penalties_B", penalties[1]); } }, [connected, penalties, setText]);

  const swap = () => {
    setScores(([a, b]) => [b, a]);
    setRedCards(([a, b]) => [b, a]);
    setPenalties(([a, b]) => [b, a]);
    swapTeams();
  };

  return <>
    <Scoreboard teams={[teamA, teamB]} scores={scores} setScores={setScores} onSwap={swap} />
    <ClockPanel
      title="경기 시계"
      value={clockText}
      running={clock.running}
      onStart={clock.start}
      onPause={clock.pause}
      onReset={() => clock.reset(0)}
      presets={[
        { label: "전반 00:00", action: () => clock.reset(0) },
        { label: `후반 ${settings.firstHalfMinutes}:00`, action: () => clock.reset(settings.firstHalfMinutes * 60) },
        { label: `연장 ${settings.firstHalfMinutes + settings.secondHalfMinutes}:00`, action: () => clock.reset((settings.firstHalfMinutes + settings.secondHalfMinutes) * 60) },
        { label: `연장 후반 ${settings.firstHalfMinutes + settings.secondHalfMinutes + settings.extraHalfMinutes}:00`, action: () => clock.reset((settings.firstHalfMinutes + settings.secondHalfMinutes + settings.extraHalfMinutes) * 60) },
      ]}
      adjust={{ label: "1분", minus: () => clock.adjust(-60), plus: () => clock.adjust(60) }}
    />
    <Panel title="경기 구간">
      <Segments value={period} items={PERIODS} onChange={setPeriod} label="축구 경기 구간" />
      <div className={`${styles.counterGrid} ${styles.three}`} style={{ marginTop: 8 }}>
        <MiniCounter label="추가시간" value={addedTime} onChange={setAddedTime} max={30} />
        <MiniCounter label={`${teamA} 퇴장`} value={redCards[0]} onChange={(value) => setRedCards((current) => [value, current[1]])} max={5} />
        <MiniCounter label={`${teamB} 퇴장`} value={redCards[1]} onChange={(value) => setRedCards((current) => [current[0], value])} max={5} />
      </div>
    </Panel>
    {period === "PK" && <Scoreboard teams={[`${teamA} PK`, `${teamB} PK`]} scores={penalties} setScores={setPenalties} />}
  </>;
}

export default function SoccerController() {
  return <ControllerShell name="축구 컨트롤" sport="soccer" accent="green">{(props) => <SoccerControls {...props} />}</ControllerShell>;
}
