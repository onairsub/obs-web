"use client";

import { isSportKey } from "@/components/sports/sportSettings";
import { usePathname, useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  REMOTE_SYNC_KEYS,
  REMOTE_SYNC_KEY_SET,
  type RemoteClientMessage,
  type RemoteCommand,
  type RemoteOBSState,
  type RemoteServerMessage,
} from "./remoteProtocol";

export type { RemoteCommand, RemoteOBSState } from "./remoteProtocol";

type RemoteStatus = "idle" | "opening" | "connecting" | "active" | "closed" | "error";
type StoredHostSession = { sessionId: string; hostSecret: string };

type RemoteContextValue = {
  role: "host" | "remote";
  status: RemoteStatus;
  sessionId: string;
  remoteUrl: string;
  clientCount: number;
  error: string;
  obsState: RemoteOBSState;
  openSession: () => Promise<void>;
  closeSession: () => void;
  sendCommand: (command: RemoteCommand) => void;
  publishOBSState: (state: RemoteOBSState) => void;
  subscribeCommand: (listener: (command: RemoteCommand) => void) => () => void;
};

const HOST_SESSION_KEY = "OBS_REMOTE_HOST_SESSION";
const CLIENT_ID_KEY = "OBS_REMOTE_CLIENT_ID";

const defaultValue: RemoteContextValue = {
  role: "host",
  status: "idle",
  sessionId: "",
  remoteUrl: "",
  clientCount: 0,
  error: "",
  obsState: { scenes: [], currentScene: "" },
  openSession: async () => {},
  closeSession: () => {},
  sendCommand: () => {},
  publishOBSState: () => {},
  subscribeCommand: () => () => {},
};

const RemoteControlContext = createContext<RemoteContextValue>(defaultValue);

function getRemoteSessionId(pathname: string) {
  return pathname.match(/^\/obs\/remote\/([a-f0-9]{32})/)?.[1] ?? "";
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getClientId() {
  const stored = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (stored) return stored;
  const clientId = crypto.randomUUID();
  window.sessionStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

function websocketUrl() {
  const origin = relayOrigin();
  const url = new URL("/api/remote-ws", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function relayOrigin() {
  return process.env.NEXT_PUBLIC_REMOTE_ORIGIN?.replace(/\/$/, "") || window.location.origin;
}

function snapshot() {
  return Object.fromEntries(REMOTE_SYNC_KEYS.map((key) => [key, window.localStorage.getItem(key)]));
}

export function RemoteControlProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const routeSessionId = getRemoteSessionId(pathname);
  const role = routeSessionId ? "remote" : "host";
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef("");
  const hostSecretRef = useRef("");
  const applyingRemoteState = useRef(false);
  const manuallyClosed = useRef(false);
  const commandListeners = useRef(new Set<(command: RemoteCommand) => void>());
  const [status, setStatus] = useState<RemoteStatus>(routeSessionId ? "connecting" : "idle");
  const [sessionId, setSessionId] = useState("");
  const [hostSecret, setHostSecret] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [clientCount, setClientCount] = useState(0);
  const [error, setError] = useState("");
  const [obsState, setOBSState] = useState<RemoteOBSState>({ scenes: [], currentScene: "" });

  const navigateToSyncedSport = useCallback((rawValue: string | null) => {
    if (!rawValue) return;
    try {
      const sport = JSON.parse(rawValue);
      if (!isSportKey(sport)) return;
      if (role === "host") {
        if (!pathname.startsWith(`/obs/${sport}`)) router.replace(`/obs/${sport}`);
      } else if (!pathname.startsWith(`/obs/remote/${routeSessionId}/${sport}`)) {
        router.replace(`/obs/remote/${routeSessionId}/${sport}`);
      }
    } catch {
      // Ignore malformed synchronized values.
    }
  }, [pathname, role, routeSessionId, router]);

  const applyStorage = useCallback((key: string, value: string | null) => {
    if (!REMOTE_SYNC_KEY_SET.has(key)) return;
    applyingRemoteState.current = true;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("local-storage", { key }));
    applyingRemoteState.current = false;
    if (key === "OBS_ACTIVE_SPORT") navigateToSyncedSport(value);
  }, [navigateToSyncedSport]);

  const applyStorageRef = useRef(applyStorage);
  useEffect(() => {
    applyStorageRef.current = applyStorage;
  }, [applyStorage]);

  const send = useCallback((message: RemoteClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (role !== "host") return;
    try {
      const stored = window.sessionStorage.getItem(HOST_SESSION_KEY);
      if (!stored) return;
      const value = JSON.parse(stored) as StoredHostSession;
      if (!/^[a-f0-9]{32}$/.test(value.sessionId) || !/^[a-f0-9]{48}$/.test(value.hostSecret)) return;
      sessionIdRef.current = value.sessionId;
      hostSecretRef.current = value.hostSecret;
      setSessionId(value.sessionId);
      setHostSecret(value.hostSecret);
      setStatus("connecting");
    } catch {
      window.sessionStorage.removeItem(HOST_SESSION_KEY);
    }
  }, [role]);

  const connectionSessionId = role === "remote" ? routeSessionId : sessionId;
  const connectionSecret = role === "host" ? hostSecret : "";

  useEffect(() => {
    if (!connectionSessionId || (role === "host" && !connectionSecret)) return;
    let cancelled = false;
    let terminal = false;
    let reconnectDelay = 1_000;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      if (cancelled || terminal) return;
      setStatus((current) => current === "opening" ? "opening" : "connecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        reconnectDelay = 1_000;
        const joinMessage: RemoteClientMessage = {
          type: "join",
          sessionId: connectionSessionId,
          clientId: getClientId(),
          role,
          ...(role === "host" ? { hostSecret: connectionSecret } : {}),
        };
        socket.send(JSON.stringify(joinMessage));
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" } satisfies RemoteClientMessage));
        }, 25_000);
      });

      socket.addEventListener("message", (event) => {
        let message: RemoteServerMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "ready") {
          setStatus("active");
          setError("");
          if (role === "host") {
            const url = new URL(`/obs/remote/${connectionSessionId}`, relayOrigin()).toString();
            setRemoteUrl(url);
            window.sessionStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ sessionId: connectionSessionId, hostSecret: connectionSecret }));
            if (message.uploadState) socket.send(JSON.stringify({ type: "snapshot", state: snapshot() } satisfies RemoteClientMessage));
          }
          return;
        }
        if (message.type === "storage") applyStorageRef.current(message.key, message.value);
        if (message.type === "snapshot") {
          for (const key of REMOTE_SYNC_KEYS) {
            applyStorageRef.current(key, message.state[key] ?? null);
          }
        }
        if (message.type === "command") commandListeners.current.forEach((listener) => listener(message.command));
        if (message.type === "obs-state") setOBSState(message.state);
        if (message.type === "client-count") setClientCount(message.count);
        if (message.type === "closed") {
          terminal = true;
          setStatus("closed");
          setError("호스트가 원격 컨트롤을 닫았습니다.");
          setClientCount(0);
          socket.close();
        }
        if (message.type === "error") {
          setError(message.message);
          if (message.code === "SESSION_NOT_FOUND" || message.code === "HOST_CONFLICT") {
            terminal = true;
            setStatus(message.code === "SESSION_NOT_FOUND" ? "closed" : "error");
            if (role === "host") window.sessionStorage.removeItem(HOST_SESSION_KEY);
            socket.close();
          } else {
            setStatus("error");
          }
        }
      });

      socket.addEventListener("close", () => {
        if (pingTimer) clearInterval(pingTimer);
        if (cancelled || terminal || manuallyClosed.current) return;
        setStatus("connecting");
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      });

      socket.addEventListener("error", () => {
        setError("Vercel 원격 WebSocket에 연결할 수 없습니다. 잠시 후 자동으로 다시 연결합니다.");
      });
    };

    manuallyClosed.current = false;
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connectionSecret, connectionSessionId, role]);

  useEffect(() => {
    const relayStorage = (event: StorageEvent) => {
      const activeSessionId = role === "remote" ? routeSessionId : sessionIdRef.current;
      if (applyingRemoteState.current || !activeSessionId || !event.key || !REMOTE_SYNC_KEY_SET.has(event.key)) return;
      send({ type: "storage", key: event.key, value: window.localStorage.getItem(event.key) });
    };
    window.addEventListener("local-storage", relayStorage as EventListener);
    window.addEventListener("storage", relayStorage);
    return () => {
      window.removeEventListener("local-storage", relayStorage as EventListener);
      window.removeEventListener("storage", relayStorage);
    };
  }, [role, routeSessionId, send]);

  const openSession = useCallback(async () => {
    const nextSessionId = randomHex(16);
    const nextHostSecret = randomHex(24);
    manuallyClosed.current = false;
    sessionIdRef.current = nextSessionId;
    hostSecretRef.current = nextHostSecret;
    setSessionId(nextSessionId);
    setHostSecret(nextHostSecret);
    setRemoteUrl("");
    setClientCount(0);
    setError("");
    setStatus("opening");
  }, []);

  const closeSession = useCallback(() => {
    manuallyClosed.current = true;
    send({ type: "close-session" });
    socketRef.current?.close();
    socketRef.current = null;
    sessionIdRef.current = "";
    hostSecretRef.current = "";
    window.sessionStorage.removeItem(HOST_SESSION_KEY);
    setSessionId("");
    setHostSecret("");
    setRemoteUrl("");
    setClientCount(0);
    setStatus("idle");
    setError("");
  }, [send]);

  const sendCommand = useCallback((command: RemoteCommand) => {
    if (role === "remote" && status === "active") send({ type: "command", command });
  }, [role, send, status]);

  const publishOBSState = useCallback((state: RemoteOBSState) => {
    setOBSState(state);
    if (role === "host" && sessionIdRef.current) send({ type: "obs-state", state });
  }, [role, send]);

  const subscribeCommand = useCallback((listener: (command: RemoteCommand) => void) => {
    commandListeners.current.add(listener);
    return () => commandListeners.current.delete(listener);
  }, []);

  return <RemoteControlContext.Provider value={{
    role,
    status,
    sessionId: role === "remote" ? routeSessionId : sessionId,
    remoteUrl,
    clientCount,
    error,
    obsState,
    openSession,
    closeSession,
    sendCommand,
    publishOBSState,
    subscribeCommand,
  }}>{children}</RemoteControlContext.Provider>;
}

export function useRemoteControl() {
  return useContext(RemoteControlContext);
}
