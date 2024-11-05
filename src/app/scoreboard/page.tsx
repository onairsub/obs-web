"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import { Scores } from "./_components/scores";

const Scoreboard = () => {
  return (
    <WebSocketProvider>
      <Scores />
    </WebSocketProvider>
  );
};

export default Scoreboard;
