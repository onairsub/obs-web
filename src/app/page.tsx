"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import ProviderTest from "./(test)/ProviderTest";
import { Root } from "./root";
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

export default function Home() {
  const [authStatus, setAuthStatus, removeAuthStatus] = useLocalStorage("OBS-AUTH", {port: 4455, password: ''})

  return (
    <WebSocketProvider {...authStatus}>
      <Root authStatus={authStatus} setAuthStatus={setAuthStatus}/>
    </WebSocketProvider>
  );
}
