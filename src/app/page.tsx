"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import ProviderTest from "./(test)/ProviderTest";

export default function Home() {
  return (
    <WebSocketProvider password="u0hhsfhV4FUXHsBp">
      <ProviderTest />
    </WebSocketProvider>
  );
}
