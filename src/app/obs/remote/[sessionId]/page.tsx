"use client";

import { useRemoteControl } from "@/components/remote/RemoteControlContext";
import { SPORT_OPTIONS, SportKey } from "@/components/sports/sportSettings";
import Link from "next/link";
import { useLocalStorage } from "usehooks-ts";
import styles from "./page.module.css";

const details: Record<SportKey, string> = {
  soccer: "득점 · 경기 시계 · 추가시간",
  basketball: "게임클락 · 샷클락 · 파울",
  baseball: "이닝 · BSO · 주자",
  volleyball: "세트 · 세트포인트 · 타임아웃",
};

export default function RemoteSportsPage() {
  const remote = useRemoteControl();
  const [, setActiveSport] = useLocalStorage<SportKey>("OBS_ACTIVE_SPORT", "soccer");
  const connected = remote.status === "active";

  return <main className={styles.page}>
    <header>
      <div><span>OBS REMOTE</span><h1>스포츠 선택</h1></div>
      <b className={connected ? styles.online : ""}>{connected ? "호스트 연결됨" : remote.status === "connecting" ? "연결 중" : "연결 끊김"}</b>
    </header>

    {connected ? <>
      <p className={styles.intro}>이 휴대폰의 조작은 OBS가 연결된 컴퓨터로 전달됩니다.</p>
      <section className={styles.list} aria-label="원격 제어 종목 선택">
        {SPORT_OPTIONS.map((sport) => <Link
          href={`/obs/remote/${remote.sessionId}/${sport.key}`}
          key={sport.key}
          className={styles.sport}
          onClick={() => setActiveSport(sport.key)}
        >
          <span><strong>{sport.label}</strong><small>{details[sport.key]}</small></span>
          <i>→</i>
        </Link>)}
      </section>
    </> : <section className={styles.closed}>
      <h2>원격 연결을 사용할 수 없습니다.</h2>
      <p>{remote.error || "호스트 컴퓨터에서 원격 컨트롤이 열려 있는지 확인하세요."}</p>
    </section>}

    <footer>인터넷 연결 · 호스트 앱 실행 상태 필요</footer>
  </main>;
}
