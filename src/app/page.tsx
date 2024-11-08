"use client";

import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

export default function Home() {
  return (
    <div>
      <a href="/obs">go to obs controller</a>
    </div>
  );
}
