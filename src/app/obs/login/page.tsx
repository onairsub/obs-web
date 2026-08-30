"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { connectStatus, reconnect } = useWebSocket();
  const [authStatus, setAuthStatus] = useLocalStorage("OBS-AUTH", {
    port: 4455,
    password: "",
  });
  const [, setPreviewMode] = useLocalStorage("OBS-PREVIEW_MODE", false);
  const [port, setPort] = useState(authStatus.port);
  const [password, setPassword] = useState(authStatus.password);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      router.replace("/obs/sports");
    }
  }, [connectStatus, router]);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    setPreviewMode(false);
    setAuthStatus({ port, password });
    reconnect();
  };

  const openPreview = () => {
    setPreviewMode(true);
    router.replace("/obs/sports");
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>OBS Controller</h1>
        <p className={styles.description}>OBS WebSocket에 연결하세요.</p>
        <form onSubmit={connect} className={styles.form}>
          <label>
            <span>WebSocket 포트</span>
            <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
          </label>
          <label>
            <span>비밀번호</span>
            <input type="password" value={password} placeholder="인증을 사용하지 않으면 비워두세요" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit">{connectStatus === StatusCode.CONNECTED ? "CONNECTING…" : "CONNECT OBS"}</button>
        </form>
        <button type="button" className={styles.previewButton} onClick={openPreview}>OBS 없이 프리뷰</button>
        <p className={styles.previewHint}>점수, 타이머와 화면 구성을 연결 없이 시험할 수 있습니다.</p>
        <a className={styles.install} href="https://github.com/obsproject/obs-studio/releases/tag/28.1.2">INSTALL OBS</a>
        <p className={styles.hint}>OBS 28.1.2+ · WebSocket v5</p>
      </section>
    </main>
  );
}
