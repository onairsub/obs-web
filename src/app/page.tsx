"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import ProviderTest from "./(test)/ProviderTest";
import { Root } from "./root";

export default function Home() {
  return (
    <WebSocketProvider>
      <Root />
    </WebSocketProvider>
  );
}
