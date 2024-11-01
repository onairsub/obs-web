"use client";

import { useEffect, useState } from "react";
import SocketIOClient from "socket.io-client";

export default function Home() {
  const [connectStatus, setConnectStatus] = useState(0);

  useEffect(() => {
    const socket = SocketIOClient("http://localhost:1984", {
      transports: ["websocket"], // WebSocket을 명시적으로 사용
    });

    socket.on("connect", () => {
      setConnectStatus(200);
      console.log("Connected!");
      socket.on("useSuccess", () => {
        setConnectStatus(201);
        console.log("success!");
      });
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  return <div>{connectStatus}</div>;
}
