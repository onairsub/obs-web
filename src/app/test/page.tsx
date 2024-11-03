"use client";

import {
  useWebSocket,
  WebSocketProvider,
} from "@/components/websocket/WebSocketContext";

export default function ProviderTest() {
  const { webSocketManager, connectStatus } = useWebSocket();

  return <div>{connectStatus}</div>;
}
