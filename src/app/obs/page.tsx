"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";

const OBSHome = () => {
  const { connectStatus } = useWebSocket();
  const router = useRouter();
  const [previewMode] = useLocalStorage("OBS-PREVIEW_MODE", false);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED || previewMode) {
      router.replace("/obs/sports");
    } else if (connectStatus === StatusCode.UNAUTHORIZED) {
      router.replace("/obs/login");
    }
  }, [connectStatus, previewMode, router]);

  return <div style={{ padding: 24, color: "#8d94a3" }}>OBS 연결 확인 중…</div>;
};

export default OBSHome;
