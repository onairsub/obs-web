"use client";

import {
  useWebSocket,
  WebSocketProvider,
} from "@/components/websocket/WebSocketContext";
import { useLocalStorage } from "usehooks-ts";

export default function OBSLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [authStatus] = useLocalStorage("OBS-AUTH", {
    port: 4455,
    password: "",
  });

  return <WebSocketProvider {...authStatus}>{children}</WebSocketProvider>;
}
