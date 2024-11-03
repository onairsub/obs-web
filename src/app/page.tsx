"use client";

import {
  useWebSocket,
  WebSocketProvider,
} from "@/components/websocket/WebSocketContext";
import ProviderTest from "./test/page";

export default function Home() {
  return (
    <WebSocketProvider>
      <ProviderTest />
    </WebSocketProvider>
  );
}
