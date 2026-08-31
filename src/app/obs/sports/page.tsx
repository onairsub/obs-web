"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import RemoteControlPanel from "@/components/remote/RemoteControlPanel";
import { StatusCode } from "@/constants/statusCode";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import styles from "./page.module.css";

const sports = [
  { href: "/obs/soccer", name: "축구", detail: "득점 · 경기 시계 · 추가시간" },
  { href: "/obs/basketball", name: "농구", detail: "게임클락 · 샷클락 · 파울" },
  { href: "/obs/baseball", name: "야구", detail: "이닝 · BSO · 주자" },
  { href: "/obs/volleyball", name: "배구", detail: "세트 · 세트포인트 · 타임아웃" },
] as const;

export default function SportsPage() {
  const router = useRouter();
  const { connectStatus } = useWebSocket();
  const [previewMode] = useLocalStorage("OBS-PREVIEW_MODE", false);

  useEffect(() => {
    if (connectStatus === StatusCode.UNAUTHORIZED && !previewMode) router.replace("/obs/login");
  }, [connectStatus, previewMode, router]);

  const statusText = connectStatus === StatusCode.AUTHENTICATED
    ? "OBS 연결됨"
    : previewMode
      ? "프리뷰 모드"
      : "연결 확인 중";

  return (
    <main className={styles.page}>
      <header>
        <div>
          <h1>스포츠 선택</h1>
        </div>
        <span className={`${styles.status} ${connectStatus === StatusCode.AUTHENTICATED ? styles.online : previewMode ? styles.preview : ""}`}>
          {statusText}
        </span>
      </header>

      <section className={styles.list} aria-label="스포츠 선택">
        {sports.map((sport) => (
          <Link href={sport.href} key={sport.href} className={styles.sport}>
            <span className={styles.copy}><strong>{sport.name}</strong><small>{sport.detail}</small></span>
            <span className={styles.arrow}>→</span>
          </Link>
        ))}
      </section>

      <div className={styles.tools}>
        <Link href="/obs/setting">경기·팀 설정</Link>
        <Link href="/obs/help">OBS 소스 도움말</Link>
      </div>
      <RemoteControlPanel enabled={connectStatus === StatusCode.AUTHENTICATED} />
      {previewMode && connectStatus !== StatusCode.AUTHENTICATED && <Link className={styles.connectLink} href="/obs/login">OBS 연결하기</Link>}
    </main>
  );
}
