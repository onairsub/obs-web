"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import RemoteControlPanel from "@/components/remote/RemoteControlPanel";
import { StatusCode } from "@/constants/statusCode";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
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

  const connected = connectStatus === StatusCode.AUTHENTICATED;

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
          <button type="submit" disabled={connected}>{connected ? "OBS CONNECTED" : connectStatus === StatusCode.CONNECTED ? "CONNECTING…" : "CONNECT OBS"}</button>
        </form>
        {connected && <button type="button" className={styles.controllerButton} onClick={() => router.replace("/obs/sports")}>컨트롤러 열기</button>}
        <RemoteControlPanel enabled={connected} />
        {!connected && <><button type="button" className={styles.previewButton} onClick={openPreview}>OBS 없이 프리뷰</button><p className={styles.previewHint}>점수, 타이머와 화면 구성을 연결 없이 시험할 수 있습니다.</p></>}

        <details className={styles.connectionHelp}>
          <summary>OBS 연결 설정 도움말</summary>
          <div>
            <ol>
              <li><b>이 웹을 OBS가 실행 중인 컴퓨터에서 실행</b><span>OBS 연결은 이 컴퓨터의 localhost로 직접 전송됩니다.</span></li>
              <li><b>OBS에서 WebSocket 서버 열기</b><span>도구 → WebSocket 서버 설정으로 이동합니다.</span></li>
              <li><b>WebSocket 서버 활성화</b><span>서버 활성화를 체크하고 포트를 확인합니다. 기본값은 4455입니다.</span></li>
              <li><b>비밀번호 설정</b><span>인증 사용 시 OBS에서 비밀번호를 정한 뒤 위 입력란에 똑같이 입력합니다.</span></li>
            </ol>
            <p>설정을 저장한 다음 OBS를 켜 둔 상태에서 CONNECT OBS를 누르세요.</p>
          </div>
        </details>

        <a className={styles.install} href="https://github.com/obsproject/obs-studio/releases/tag/28.1.2">INSTALL OBS</a>
        <p className={styles.hint}>OBS 28.1.2+ · WebSocket v5</p>
      </section>
    </main>
  );
}
