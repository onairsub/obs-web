"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import ProviderTest from "./ProviderTest";

export default function Home() {
  return (
    <WebSocketProvider>
      <ProviderTest />
    </WebSocketProvider>
  );
}
