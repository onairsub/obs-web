"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const OBSHome = () => {
  const { connectStatus } = useWebSocket();
  const router = useRouter();

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      router.push("/obs/dashboard");
    } else {
      router.push("/obs/login");
    }
  }, []);

  return <div>redirecting...</div>;
};

export default OBSHome;
