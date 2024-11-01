"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [connectStatus, setConnectStatus] = useState(0);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:4455"); // OBS WebSocket에 연결

    socket.onopen = () => {
      setConnectStatus(200);
      console.log("Connected!");
      // 여기에 인증 코드가 필요할 수 있음
    };

    socket.onmessage = (event) => {
      console.log("메시지 수신:", event.data);
      // 예: 특정 메시지를 수신했을 때 처리
      setConnectStatus(201);
    };

    socket.onerror = (error) => {
      console.error("WebSocket 에러:", error);
    };

    socket.onclose = () => {
      console.log("WebSocket 연결이 닫혔습니다.");
    };

    return () => {
      socket.close();
    };
  }, []);

  return <div>{connectStatus}</div>;
}
