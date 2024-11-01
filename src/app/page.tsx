"use client";

import { useEffect } from "react";
import SocketIOClient from "socket.io-client";

export default function Home() {
  useEffect(() => {
    const socket = SocketIOClient("http://localhost:1984");

    socket.on("connect", () => {
      socket.on("useSuccess", () => {
        console.log("success!");
      });
    });
  }, []);

  return <div></div>;
}
