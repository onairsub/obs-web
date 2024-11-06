"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import { Root } from "./root";
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import ProviderTest from "./ProviderTest";

export default function Home() {
  return (
    <WebSocketProvider>
      <ProviderTest />
    </WebSocketProvider>
  );
}
