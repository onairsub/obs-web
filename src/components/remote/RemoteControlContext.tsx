"use client";

import { DEFAULT_BASKETBALL_SETTINGS, isSportKey } from "@/components/sports/sportSettings";
import { HostClocks, RemoteClocks, isClockSnapshot, type ClockKey, type ClockOperation, type ClockSnapshot } from "../obs/clockSync";
import { usePathname, useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { RemoteRelayConnection } from "./RemoteRelayConnection";
import {
  REMOTE_SYNC_KEYS,
  REMOTE_SYNC_KEY_SET,
  REMOTE_PROTOCOL_VERSION,
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
  clockState: ClockSnapshot | null;
  clockUpdateRequired: boolean;
  clockNow: () => number;
  clockReady: () => boolean;
  controlClock: (key: ClockKey, operation: ClockOperation) => void;
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
  clockState: null,
  clockUpdateRequired: false,
  clockNow: () => 0,
  clockReady: () => false,
  controlClock: () => {},
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
  const relayRef = useRef<RemoteRelayConnection | null>(null);
  const sessionIdRef = useRef("");
  const hostSecretRef = useRef("");
  const applyingRemoteState = useRef(false);
  const commandListeners = useRef(new Set<(command: RemoteCommand) => void>());
  const hostClocks = useRef<HostClocks | null>(null);
  const remoteClocks = useRef<RemoteClocks | null>(null);
  const relayReady = useRef(false);
  const clocksSynchronized = useRef(false);
  const [clockState, setClockState] = useState<ClockSnapshot | null>(null);
  const [clockUpdateRequired, setClockUpdateRequired] = useState(false);
  const [status, setStatus] = useState<RemoteStatus>(routeSessionId ? "connecting" : "idle");
  const [sessionId, setSessionId] = useState("");
  const [hostSecret, setHostSecret] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [clientCount, setClientCount] = useState(0);
  const [error, setError] = useState("");
  const [obsState, setOBSState] = useState<RemoteOBSState>({ scenes: [], currentScene: "" });

  useEffect(() => {
    if (role !== "host") return;
    const wall = Date.now();
    const monotonic = performance.now();
    const read = (key: string) => {
      try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { return null; }
    };
    const initialSeconds = (key: ClockKey) => {
      const config = { ...DEFAULT_BASKETBALL_SETTINGS, ...read("OBS_BASKETBALL_CONFIG") };
      return key === "OBS_SOCCER_CLOCK" ? 0 : key === "OBS_BASKETBALL_GAME_CLOCK" ? config.quarterMinutes * 60 : config.shotClockSeconds;
    };
    const authority = new HostClocks(crypto.randomUUID(), () => wall + performance.now() - monotonic, initialSeconds, read, (key, clock) => {
      window.localStorage.setItem(key, JSON.stringify(clock));
    });
    hostClocks.current = authority;
    setClockUpdateRequired(false);
    setClockState(authority.snapshot());
    return () => { hostClocks.current = null; };
  }, [role]);

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
    relayRef.current?.send(message);
  }, []);

  const clockNow = useCallback(() => role === "host" ? hostClocks.current?.now() ?? 0 : remoteClocks.current?.now() ?? 0, [role]);
  const clockReady = useCallback(() => role === "host" ? Boolean(hostClocks.current) : relayReady.current && clocksSynchronized.current && Boolean(remoteClocks.current?.ready()), [role]);
  const controlClock = useCallback((key: ClockKey, operation: ClockOperation) => {
    if (role === "host") {
      if (!hostClocks.current) return;
      const next = hostClocks.current.apply(key, operation);
      setClockState(next);
      if (relayReady.current) send({ type: "clock-state", snapshot: next });
    } else if (clockReady() && remoteClocks.current?.snapshot) {
      send({ type: "clock-command", command: {
        id: crypto.randomUUID(), epoch: remoteClocks.current.snapshot.epoch,
        issuedAt: remoteClocks.current.now(), key, operation,
      } });
    }
  }, [clockReady, role, send]);

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
    let clockTimer: number | null = null;
    let unansweredProbes = 0;
    const probes = new Set<string>();
    if (role === "remote") {
      remoteClocks.current = new RemoteClocks(() => performance.now());
      setClockUpdateRequired(false);
      clocksSynchronized.current = false;
      setClockState(null);
    }

    const syncClocks = () => {
      if (clockTimer !== null) clearTimeout(clockTimer);
      if (cancelled || role !== "remote" || !relayReady.current) return;
      const requestId = crypto.randomUUID();
      probes.add(requestId);
      if (probes.size > 32) probes.delete(probes.values().next().value!);
      remoteClocks.current?.probe(requestId);
      send({ type: "clock-sync", requestId });
      // If the host is also reconnecting, retry promptly instead of waiting
      // ten seconds for the next normal clock probe.
      const delay = Math.min(500 * 2 ** Math.min(4, Math.floor(unansweredProbes++ / 4)), 5_000);
      clockTimer = window.setTimeout(syncClocks, delay);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      relayRef.current?.wake();
      unansweredProbes = 0;
      syncClocks();
    };
    document.addEventListener("visibilitychange", onVisible);

    setStatus((current) => current === "opening" ? "opening" : "connecting");
    const relay = new RemoteRelayConnection({
      createSocket: () => new WebSocket(websocketUrl()),
      join: {
        type: "join", sessionId: connectionSessionId, clientId: getClientId(), role,
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        ...(role === "host" ? { hostSecret: connectionSecret } : {}),
      },
      onConnected: (connected) => {
        if (cancelled) return;
        relayReady.current = connected;
        if (!connected) {
          clocksSynchronized.current = false;
          probes.clear();
          unansweredProbes = 0;
          if (clockTimer !== null) clearTimeout(clockTimer);
          setStatus("connecting");
        }
      },
      onUnavailable: () => {
        if (cancelled) return;
        setStatus("connecting");
        setError("원격 중계 연결을 복구하고 있습니다. 잠시 후 자동으로 다시 연결합니다.");
      },
      onMessage: (message: RemoteServerMessage) => {
        if (cancelled) return;
        if (message.type === "ready") {
          setStatus("active");
          setError("");
          if (role === "host") {
            const url = new URL(`/obs/remote/${connectionSessionId}`, relayOrigin()).toString();
            setRemoteUrl(url);
            window.sessionStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ sessionId: connectionSessionId, hostSecret: connectionSecret }));
            if (message.uploadState) send({ type: "snapshot", state: snapshot() });
            if (hostClocks.current) send({ type: "clock-state", snapshot: hostClocks.current.snapshot() });
          } else {
            unansweredProbes = 0;
            syncClocks();
          }
          return;
        }
        if (message.type === "clock-sync" && role === "host" && hostClocks.current) {
          send({ type: "clock-state", snapshot: hostClocks.current.snapshot(), replyTo: message.requestId });
        }
        if (message.type === "clock-command" && role === "host" && hostClocks.current) {
          const next = hostClocks.current.receive(message.command);
          if (next) {
            setClockState(next);
            send({ type: "clock-state", snapshot: next });
          }
        }
        if (message.type === "clock-state" && role === "remote" && isClockSnapshot(message.snapshot)) {
          const ownReply = message.replyTo && probes.delete(message.replyTo);
          const accepted = remoteClocks.current?.accept(message.snapshot, message.replyTo);
          const updateRequired = Boolean(remoteClocks.current?.requiresHostUpdate);
          setClockUpdateRequired(updateRequired);
          if (updateRequired) {
            clocksSynchronized.current = false;
            setClockState(null);
          }
          if (accepted) {
            setClockState(message.snapshot);
            if (ownReply) {
              clocksSynchronized.current = true;
              unansweredProbes = 0;
              if (clockTimer !== null) clearTimeout(clockTimer);
              clockTimer = window.setTimeout(syncClocks, 10_000);
            }
          }
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
          setStatus("closed");
          setError("호스트가 원격 컨트롤을 닫았습니다.");
          setClientCount(0);
        }
        if (message.type === "error") {
          setError(message.message);
          if (message.code === "SESSION_NOT_FOUND" || message.code === "HOST_CONFLICT" || message.code === "UPDATE_REQUIRED") {
            setStatus(message.code === "SESSION_NOT_FOUND" ? "closed" : "error");
            if (role === "host") window.sessionStorage.removeItem(HOST_SESSION_KEY);
          } else {
            setStatus("error");
          }
        }
      },
    });

    relayRef.current = relay;
    relay.start();
    return () => {
      cancelled = true;
      relayReady.current = false;
      clocksSynchronized.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (clockTimer !== null) clearTimeout(clockTimer);
      relay.stop();
      if (relayRef.current === relay) relayRef.current = null;
    };
  }, [connectionSecret, connectionSessionId, role, send]);

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
    send({ type: "close-session" });
    relayRef.current?.stop();
    relayRef.current = null;
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
    clockState,
    clockUpdateRequired,
    clockNow,
    clockReady,
    controlClock,
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
