"use client";

import { RemoteControlProvider } from "@/components/remote/RemoteControlContext";
import RemoteOBSBridge from "@/components/remote/RemoteOBSBridge";
import { WebSocketProvider } from "@/components/websocket/WebSocketContext";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const isRemoteRoute = pathname.startsWith("/obs/remote/");

  return <WebSocketProvider {...authStatus} disabled={isRemoteRoute}>
    <RemoteControlProvider>
      <RemoteOBSBridge />
      {children}
    </RemoteControlProvider>
  </WebSocketProvider>;
}
