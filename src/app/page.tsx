"use client";

import { useEffect } from "react";
import SocketIOClient from "socket.io-client";

export default function Home() {
  useEffect(() => {
    const socket = SocketIOClient("http://localhost:1984", {
      transports: ["websocket"], // WebSocket을 명시적으로 사용
    });

    socket.on("connect", () => {
      console.log("Connected!");
      socket.on("useSuccess", () => {
        console.log("success!");
      });
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  return <div></div>;
}
