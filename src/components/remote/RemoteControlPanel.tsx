"use client";

import { useRef, useState } from "react";
import { useRemoteControl } from "./RemoteControlContext";
import styles from "./RemoteControlPanel.module.css";

export default function RemoteControlPanel({ enabled }: { enabled: boolean }) {
  const remote = useRemoteControl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const active = remote.status === "active" && Boolean(remote.remoteUrl);
  const localLink = active && ["localhost", "127.0.0.1"].includes(new URL(remote.remoteUrl).hostname);

  if (remote.role !== "host") return null;

  const copyLink = async () => {
    let success = false;
    try {
      await navigator.clipboard.writeText(remote.remoteUrl);
      success = true;
    } catch {
      inputRef.current?.select();
      success = document.execCommand("copy");
    }
    if (!success) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return <section className={styles.panel}>
    <div className={styles.heading}>
      <div><h2>모바일 원격 컨트롤</h2><p>Vercel 중계로 어디서든 접속합니다.</p></div>
      {active && <span className={styles.count}>{remote.clientCount}명 접속</span>}
    </div>

    {!active ? <>
      <button className={styles.openButton} disabled={!enabled || remote.status === "opening"} onClick={remote.openSession}>
        {remote.status === "opening" ? "원격 링크 만드는 중…" : "원격 컨트롤 열기"}
      </button>
      <p className={styles.note}>{enabled ? "배포된 웹 주소로 링크가 만들어지며 OBS 비밀번호는 공유되지 않습니다." : "OBS 연결이 완료되면 원격 컨트롤을 열 수 있습니다."}</p>
      {remote.error && <p className={styles.error}>{remote.error}</p>}
    </> : <>
      <label className={styles.linkField}>
        <span>모바일 접속 링크</span>
        <div><input ref={inputRef} value={remote.remoteUrl} readOnly /><button onClick={copyLink}>{copied ? "복사됨" : "복사"}</button></div>
      </label>
      <div className={styles.activeRow}><span>{localLink ? "NEXT_PUBLIC_REMOTE_ORIGIN을 설정하면 Vercel 공개 링크가 생성됩니다." : "모바일 네트워크나 다른 Wi-Fi에서도 이 링크로 접속할 수 있습니다."}</span><button onClick={remote.closeSession}>원격 컨트롤 닫기</button></div>
      <p className={styles.note}>전광판 카메라 연동: 로컬 Clock Reader에 이 링크를 붙여넣고 샷클락 또는 경기 시계를 선택하세요. 호스트 화면은 열어두세요.</p>
    </>}
  </section>;
}
