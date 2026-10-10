"use client";

import { useOBSControl } from "@/components/obs/useOBSControl";
import { useRemoteControl } from "@/components/remote/RemoteControlContext";
import { SportKey } from "./sportSettings";
import Link from "next/link";
import { ReactNode, useCallback, useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import styles from "./SportController.module.css";

export type ControllerRenderProps = ReturnType<typeof useOBSControl> & {
  teamA: string;
  teamB: string;
  swapTeams: () => void;
};

type ControllerShellProps = {
  name: string;
  sport: SportKey;
  accent: "green" | "orange" | "blue" | "violet";
  children: (props: ControllerRenderProps) => ReactNode;
};

export function ControllerShell({ name, sport, accent, children }: ControllerShellProps) {
  const obs = useOBSControl();
  const remote = useRemoteControl();
  const { connected, setText } = obs;
  const [titleList] = useLocalStorage("OBS_TITLE_LIST", ["친선 경기"]);
  const [teamList] = useLocalStorage("OBS_TEAM_LIST", ["HOME", "AWAY"]);
  const [title, setTitle] = useLocalStorage("OBS_TITLE", titleList[0] ?? "친선 경기");
  const [teamA, setTeamA] = useLocalStorage("OBS_TEAM_A", teamList[0] ?? "HOME");
  const [teamB, setTeamB] = useLocalStorage("OBS_TEAM_B", teamList[1] ?? teamList[0] ?? "AWAY");
  const [previewMode] = useLocalStorage("OBS-PREVIEW_MODE", false);
  const [, setSettingsSport] = useLocalStorage<SportKey>("OBS_SETTINGS_SPORT", sport);
  const [, setActiveSport] = useLocalStorage<SportKey>("OBS_ACTIVE_SPORT", sport);

  useEffect(() => {
    if (!connected) return;
    setText("title", title);
  }, [connected, setText, title]);

  useEffect(() => {
    if (!connected) return;
    setText("team_A", teamA);
  }, [connected, setText, teamA]);

  useEffect(() => {
    if (!connected) return;
    setText("team_B", teamB);
  }, [connected, setText, teamB]);

  useEffect(() => {
    setSettingsSport(sport);
    setActiveSport(sport);
  }, [setActiveSport, setSettingsSport, sport]);

  const isRemote = remote.role === "remote";
  const backHref = isRemote ? `/obs/remote/${remote.sessionId}` : "/obs/sports";

  const swapTeams = useCallback(() => {
    const previousA = teamA;
    setTeamA(teamB);
    setTeamB(previousA);
  }, [setTeamA, setTeamB, teamA, teamB]);

  return (
    <main className={styles.controller} data-accent={accent}>
      <header className={styles.topbar}>
        <Link href={backHref} className={styles.back} aria-label="스포츠 선택으로 돌아가기">←</Link>
        <div className={styles.heading}>
          <h1>{name}</h1>
        </div>
        {obs.connected ? (
          <span className={`${styles.connection} ${styles.connected}`}>{isRemote ? "Remote" : "Connected"}</span>
        ) : isRemote ? (
          <span className={styles.connection}>Closed</span>
        ) : (
          <Link href="/obs/login" className={`${styles.connection} ${previewMode ? styles.preview : ""}`}>
            {previewMode ? "Preview" : "Disconnected"}
          </Link>
        )}
      </header>

      {isRemote && remote.clockUpdateRequired && <section className={styles.clockUpdateNotice} role="alert">
        <strong>호스트 PC 새로고침 필요</strong>
        <p>PC와 모바일의 타이머 버전이 다릅니다. OBS에 연결된 PC 페이지를 새로고침한 뒤 이 화면도 새로고침하세요. 이전 버전에서 24초 재설정 시 멈추는 것을 막기 위해 타이머 조작을 잠시 차단했습니다.</p>
        <button type="button" onClick={() => window.location.reload()}>이 화면 새로고침</button>
      </section>}

      <section className={styles.sceneBar}>
        <select value={obs.currentScene} onChange={(event) => obs.switchScene(event.target.value)} aria-label="OBS 장면">
          <option value="">장면 선택</option>
          {obs.scenes.map((scene) => <option key={scene.sceneName} value={scene.sceneName}>{scene.sceneName}</option>)}
        </select>
        <button type="button" onClick={obs.refresh} aria-label="OBS 장면 새로고침">↻</button>
      </section>

      <details className={styles.matchSetup}>
        <summary>경기 정보</summary>
        <div className={styles.setupFields}>
          <label><span>경기</span><select value={title} onChange={(event) => setTitle(event.target.value)}>{titleList.map((item, index) => <option key={`${item}-${index}`}>{item}</option>)}</select></label>
          <div className={styles.teamFields}>
            <label><span>A 팀</span><select value={teamA} onChange={(event) => setTeamA(event.target.value)}>{teamList.map((item, index) => <option key={`${item}-${index}`}>{item}</option>)}</select></label>
            <label><span>B 팀</span><select value={teamB} onChange={(event) => setTeamB(event.target.value)}>{teamList.map((item, index) => <option key={`${item}-${index}`}>{item}</option>)}</select></label>
          </div>
        </div>
      </details>

      <div className={styles.controls}>{children({ ...obs, teamA, teamB, swapTeams })}</div>

      <footer className={styles.footer}>
        {!isRemote ? <nav>
          <Link href="/obs/setting" onClick={() => setSettingsSport(sport)}>설정</Link>
          <Link href="/obs/help" onClick={() => setSettingsSport(sport)}>도움말</Link>
          <Link href="/obs/login">원격</Link>
        </nav> : <span>모바일 원격 제어</span>}
        <span>{isRemote ? (remote.status === "active" ? "연결됨" : "연결 끊김") : "OBS Controller"}</span>
      </footer>
    </main>
  );
}
