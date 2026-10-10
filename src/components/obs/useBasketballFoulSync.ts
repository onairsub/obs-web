"use client";

import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "../websocket/WebSocketContext";
import { useRemoteControl } from "../remote/RemoteControlContext";
import { StatusCode } from "@/constants/statusCode";
import { BasketballFoulWriter, foulsChanged, type TeamFouls } from "./basketballFouls";
import { createOBSRpc } from "./obsRpc";

export function useBasketballFoulSync(fouls: TeamFouls) {
  const { webSocketManager, connectStatus } = useWebSocket();
  const { role } = useRemoteControl();
  const connected = role === "host" && connectStatus === StatusCode.AUTHENTICATED;
  const previous = useRef<TeamFouls>(fouls);
  const writer = useRef<BasketballFoulWriter | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    const socket = webSocketManager?.socket;
    if (!connected || !socket) return;
    const controller = new AbortController();
    writer.current = new BasketballFoulWriter(createOBSRpc(socket, controller.signal), controller.signal);
    return () => {
      writer.current = null;
      controller.abort();
    };
  }, [connected, webSocketManager]);

  useEffect(() => {
    const changed = foulsChanged(previous.current, fouls);
    previous.current = [...fouls];
    const current = writer.current;
    if (!connected || !current) return;
    void current.update(fouls, changed).then(() => {
      if (writer.current === current) setError("");
    }).catch((reason) => {
      if (writer.current === current) setError(`파울 OBS 반영 실패: ${reason instanceof Error ? reason.message : "연결을 확인하세요."}`);
    });
  }, [connected, fouls]);

  return error;
}
