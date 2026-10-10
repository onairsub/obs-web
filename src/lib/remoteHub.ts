import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import RedisClient from "ioredis";
import type { WebSocket } from "ws";
import {
  filterRemoteSnapshot,
  parseRemoteClientMessage,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemoteOBSState,
  type RemoteServerMessage,
} from "@/components/remote/remoteProtocol";

const EVENT_CHANNEL = "obs-remote:events";
const SESSION_TTL_SECONDS = 6 * 60 * 60;
const SESSION_TOUCH_MS = 30 * 60 * 1_000;
const PRESENCE_TTL_MS = 75_000;
const PRESENCE_SWEEP_MS = 30_000;

type ConnectionRole = "host" | "remote";
type Connection = {
  connectionId: string;
  clientId: string;
  sessionId: string;
  role: ConnectionRole | "";
  lastSessionTouch: number;
};
type LocalSession = {
  secretHash: string;
  state: Record<string, string | null>;
  obsState: RemoteOBSState | null;
};
type MessageRelayEvent = {
  kind: "message";
  sessionId: string;
  audience: ConnectionRole | "all";
  excludeConnectionId?: string;
  excludeClient?: { clientId: string; role: ConnectionRole };
  message: RemoteServerMessage;
};
type PresenceRelayEvent = {
  kind: "presence";
  sessionId: string;
  connectionId: string;
  clientId: string;
  online: boolean;
  seenAt: number;
};
type RelayEvent = MessageRelayEvent | PresenceRelayEvent;
type RelayEnvelope = { origin: string; event: RelayEvent };
type PresenceEntry = { clientId: string; seenAt: number };
type Hub = {
  instanceId: string;
  connections: Map<WebSocket, Connection>;
  localSessions: Map<string, LocalSession>;
  subscriber: Redis | null;
  subscriptionPromise: Promise<boolean> | null;
  presenceTimer: ReturnType<typeof setInterval> | null;
  remotePresence: Map<string, Map<string, PresenceEntry>>;
  lastCounts: Map<string, number>;
};

function createRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "production") console.warn("[remote] REDIS_URL이 없어 단일 로컬 인스턴스로 실행합니다.");
    return null;
  }
  return new RedisClient(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
}

const globalRemoteHub = globalThis as unknown as { __obsRemoteHub?: Hub; __obsRemoteRedis?: Redis | null };
const redis = Object.prototype.hasOwnProperty.call(globalRemoteHub, "__obsRemoteRedis")
  ? globalRemoteHub.__obsRemoteRedis ?? null
  : (globalRemoteHub.__obsRemoteRedis = createRedis());
const hub = globalRemoteHub.__obsRemoteHub ?? (globalRemoteHub.__obsRemoteHub = {
  instanceId: randomUUID(),
  connections: new Map(),
  localSessions: new Map(),
  subscriber: null,
  subscriptionPromise: null,
  presenceTimer: null,
  remotePresence: new Map(),
  lastCounts: new Map(),
});

const sessionKey = (sessionId: string) => `obs-remote:session:${sessionId}`;
const stateKey = (sessionId: string) => `obs-remote:state:${sessionId}`;
const obsStateKey = (sessionId: string) => `obs-remote:obs-state:${sessionId}`;
const secretHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

function send(socket: WebSocket, message: RemoteServerMessage) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message), (error) => {
      if (error) console.error("[remote] send failed", error);
    });
  } catch {
    // The close handler will clean up a failed connection.
  }
}

function deliver(event: MessageRelayEvent) {
  for (const [socket, connection] of hub.connections) {
    if (!connection.role || connection.sessionId !== event.sessionId) continue;
    if (event.excludeConnectionId === connection.connectionId) continue;
    if (event.excludeClient && event.excludeClient.clientId === connection.clientId && event.excludeClient.role === connection.role) continue;
    if (event.audience !== "all" && event.audience !== connection.role) continue;
    send(socket, event.message);
  }
}

function remoteClientCount(sessionId: string) {
  const presence = hub.remotePresence.get(sessionId);
  if (!presence) return 0;
  const clients = new Set<string>();
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const entry of presence.values()) {
    if (entry.seenAt >= cutoff) clients.add(entry.clientId);
  }
  return clients.size;
}

function emitClientCount(sessionId: string, force = false) {
  const count = remoteClientCount(sessionId);
  if (!force && hub.lastCounts.get(sessionId) === count) return;
  hub.lastCounts.set(sessionId, count);
  deliver({
    kind: "message",
    sessionId,
    audience: "host",
    message: { type: "client-count", count },
  });
}

function applyPresence(event: PresenceRelayEvent) {
  const presence = hub.remotePresence.get(event.sessionId) ?? new Map<string, PresenceEntry>();
  if (event.online) {
    presence.set(event.connectionId, { clientId: event.clientId, seenAt: event.seenAt });
    hub.remotePresence.set(event.sessionId, presence);
  } else {
    presence.delete(event.connectionId);
    if (presence.size === 0) hub.remotePresence.delete(event.sessionId);
  }
  emitClientCount(event.sessionId);
}

function applyRelayEvent(event: RelayEvent) {
  if (event.kind === "presence") applyPresence(event);
  else deliver(event);
}

async function publish(event: RelayEvent) {
  // The same event can arrive through the retiring and replacement sockets,
  // including sockets on different Vercel instances. Give it one stable ID.
  if (event.kind === "message") event = { ...event, message: { ...event.message, relayId: randomUUID() } };
  applyRelayEvent(event);
  if (!redis) return;
  try {
    await redis.publish(EVENT_CHANNEL, JSON.stringify({ origin: hub.instanceId, event } satisfies RelayEnvelope));
  } catch (error) {
    console.error("[remote] event publish failed", error);
  }
}

function handlePublishedEvent(raw: string) {
  try {
    const envelope = JSON.parse(raw) as RelayEnvelope;
    if (!envelope?.event || envelope.origin === hub.instanceId) return;
    applyRelayEvent(envelope.event);
  } catch {
    // Ignore malformed messages from the relay channel.
  }
}

async function ensureSubscriber() {
  if (!redis) return true;
  if (hub.subscriptionPromise) return hub.subscriptionPromise;

  const subscriber = redis.duplicate({ maxRetriesPerRequest: null });
  hub.subscriber = subscriber;
  subscriber.on("message", (channel, raw) => {
    if (channel === EVENT_CHANNEL) handlePublishedEvent(raw);
  });
  subscriber.on("error", (error) => console.error("[remote] subscriber failed", error));

  hub.subscriptionPromise = subscriber.subscribe(EVENT_CHANNEL)
    .then(() => hub.subscriber === subscriber)
    .catch((error) => {
      console.error("[remote] subscribe failed", error);
      if (hub.subscriber === subscriber) {
        hub.subscriber = null;
        hub.subscriptionPromise = null;
      }
      void subscriber.quit().catch(() => {});
      return false;
    });
  return hub.subscriptionPromise;
}

function prunePresence() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [sessionId, presence] of hub.remotePresence) {
    let changed = false;
    for (const [connectionId, entry] of presence) {
      if (entry.seenAt >= cutoff) continue;
      presence.delete(connectionId);
      changed = true;
    }
    if (presence.size === 0) hub.remotePresence.delete(sessionId);
    if (changed) emitClientCount(sessionId, true);
  }
}

function startBackgroundWork() {
  if (!hub.presenceTimer) hub.presenceTimer = setInterval(prunePresence, PRESENCE_SWEEP_MS);
  void ensureSubscriber();
}

function stopBackgroundWork() {
  if (hub.presenceTimer) clearInterval(hub.presenceTimer);
  hub.presenceTimer = null;
  hub.remotePresence.clear();
  hub.lastCounts.clear();

  const subscriber = hub.subscriber;
  hub.subscriber = null;
  hub.subscriptionPromise = null;
  if (subscriber) {
    void subscriber.unsubscribe(EVENT_CHANNEL)
      .catch(() => {})
      .finally(() => void subscriber.quit().catch(() => {}));
  }
}

async function claimHost(sessionId: string, hostSecret: string, resume = false) {
  const hash = secretHash(hostSecret);
  if (!redis) {
    const existing = hub.localSessions.get(sessionId);
    if (existing) return { ok: existing.secretHash === hash, created: false };
    if (resume) return { ok: false, created: false, missing: true };
    hub.localSessions.set(sessionId, { secretHash: hash, state: {}, obsState: null });
    return { ok: true, created: true };
  }

  const key = sessionKey(sessionId);
  const existing = await redis.get(key);
  if (existing) {
    if (existing === hash) await redis.expire(key, SESSION_TTL_SECONDS);
    return { ok: existing === hash, created: false };
  }
  // A delayed warm join must not recreate a session after the user closes it.
  if (resume) return { ok: false, created: false, missing: true };
  const result = await redis.set(key, hash, "EX", SESSION_TTL_SECONDS, "NX");
  if (result === "OK") return { ok: true, created: true };
  return { ok: (await redis.get(key)) === hash, created: false };
}

async function sessionExists(sessionId: string) {
  if (!redis) return hub.localSessions.has(sessionId);
  return (await redis.exists(sessionKey(sessionId))) === 1;
}

async function touchHostSession(connection: Connection) {
  if (!redis || connection.role !== "host" || Date.now() - connection.lastSessionTouch < SESSION_TOUCH_MS) return;
  connection.lastSessionTouch = Date.now();
  try {
    await redis.expire(sessionKey(connection.sessionId), SESSION_TTL_SECONDS);
  } catch (error) {
    console.error("[remote] session touch failed", error);
  }
}

async function publishPresence(connection: Connection, online: boolean) {
  if (connection.role !== "remote") return;
  await publish({
    kind: "presence",
    sessionId: connection.sessionId,
    connectionId: connection.connectionId,
    clientId: connection.clientId,
    online,
    seenAt: Date.now(),
  });
}

async function storeStorage(sessionId: string, key: string, value: string | null) {
  if (!redis) {
    const session = hub.localSessions.get(sessionId);
    if (session) {
      if (value === null) delete session.state[key];
      else session.state[key] = value;
    }
    return;
  }
  if (value === null) await redis.hdel(stateKey(sessionId), key);
  else await redis.hset(stateKey(sessionId), key, value);
  await redis.expire(stateKey(sessionId), SESSION_TTL_SECONDS);
}

async function storeSnapshot(sessionId: string, state: Record<string, string | null>) {
  if (!redis) {
    const session = hub.localSessions.get(sessionId);
    if (session) session.state = { ...state };
    return;
  }
  const entries = Object.entries(state);
  if (!entries.length) return;
  const values = entries.filter(([, value]) => value !== null) as [string, string][];
  const removed = entries.filter(([, value]) => value === null).map(([key]) => key);
  if (values.length) await redis.hset(stateKey(sessionId), Object.fromEntries(values));
  if (removed.length) await redis.hdel(stateKey(sessionId), ...removed);
  await redis.expire(stateKey(sessionId), SESSION_TTL_SECONDS);
}

async function loadSnapshot(sessionId: string) {
  if (!redis) return { ...(hub.localSessions.get(sessionId)?.state ?? {}) };
  return await redis.hgetall(stateKey(sessionId));
}

async function storeOBSState(sessionId: string, state: RemoteOBSState) {
  if (!redis) {
    const session = hub.localSessions.get(sessionId);
    if (session) session.obsState = state;
    return;
  }
  await redis.set(obsStateKey(sessionId), JSON.stringify(state), "EX", SESSION_TTL_SECONDS);
}

async function loadOBSState(sessionId: string): Promise<RemoteOBSState | null> {
  if (!redis) return hub.localSessions.get(sessionId)?.obsState ?? null;
  const raw = await redis.get(obsStateKey(sessionId));
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function closeSession(sessionId: string, excludeConnectionId?: string) {
  if (redis) await redis.del(sessionKey(sessionId), stateKey(sessionId), obsStateKey(sessionId));
  else hub.localSessions.delete(sessionId);
  hub.remotePresence.delete(sessionId);
  hub.lastCounts.delete(sessionId);
  await publish({
    kind: "message",
    sessionId,
    audience: "all",
    excludeConnectionId,
    message: { type: "closed", reason: "host-closed" },
  });
}

async function handleJoin(socket: WebSocket, connection: Connection, message: Extract<RemoteClientMessage, { type: "join" }>) {
  if (connection.role) return;
  if (message.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
    send(socket, { type: "error", code: "UPDATE_REQUIRED", message: "원격 연결 방식이 업데이트되었습니다. 호스트와 모바일 페이지를 모두 새로고침하세요." });
    socket.close();
    return;
  }
  if (!(await ensureSubscriber())) {
    send(socket, { type: "error", code: "RELAY_UNAVAILABLE", message: "원격 중계 서버에 연결할 수 없습니다." });
    socket.close();
    return;
  }

  if (message.role === "host") {
    const claim = await claimHost(message.sessionId, message.hostSecret ?? "", message.resume);
    if (!claim.ok) {
      send(socket, { type: "error", code: claim.missing ? "SESSION_NOT_FOUND" : "HOST_CONFLICT", message: claim.missing ? "종료되었거나 존재하지 않는 원격 세션입니다." : "이미 다른 호스트가 사용 중인 원격 세션입니다." });
      return;
    }
    Object.assign(connection, {
      clientId: message.clientId,
      sessionId: message.sessionId,
      role: "host" as const,
      lastSessionTouch: Date.now(),
    });
    send(socket, { type: "ready", role: "host", uploadState: claim.created });
    if (!claim.created && !message.resume) send(socket, { type: "snapshot", state: await loadSnapshot(message.sessionId) });
    emitClientCount(message.sessionId, true);
    return;
  }

  if (!(await sessionExists(message.sessionId))) {
    send(socket, { type: "error", code: "SESSION_NOT_FOUND", message: "종료되었거나 존재하지 않는 원격 세션입니다." });
    return;
  }
  Object.assign(connection, {
    clientId: message.clientId,
    sessionId: message.sessionId,
    role: "remote" as const,
    lastSessionTouch: 0,
  });
  await publishPresence(connection, true);
  send(socket, { type: "ready", role: "remote" });
  if (message.resume) return;
  send(socket, { type: "snapshot", state: await loadSnapshot(message.sessionId) });
  const obsState = await loadOBSState(message.sessionId);
  if (obsState) send(socket, { type: "obs-state", state: obsState });
}

async function handleMessage(socket: WebSocket, raw: unknown) {
  const connection = hub.connections.get(socket);
  if (!connection) return;
  const message = parseRemoteClientMessage(typeof raw === "string" ? raw : String(raw));
  if (!message) return;
  if (message.type === "join") {
    await handleJoin(socket, connection, message);
    return;
  }
  if (!connection.role) return;

  if ((message.type === "clock-sync" || message.type === "clock-command") && connection.role === "remote") {
    await publish({ kind: "message", sessionId: connection.sessionId, audience: "host", message });
    return;
  }
  if (message.type === "clock-state" && connection.role === "host") {
    // Live host state is never restored from Redis. It would roll back clocks
    // changed locally while the relay was reconnecting.
    await publish({ kind: "message", sessionId: connection.sessionId, audience: "remote", message });
    return;
  }

  if (message.type === "ping") {
    if (connection.role === "remote") await publishPresence(connection, true);
    else await touchHostSession(connection);
    send(socket, { type: "pong", ...(message.requestId ? { requestId: message.requestId } : {}) });
    return;
  }
  if (message.type === "storage") {
    await storeStorage(connection.sessionId, message.key, message.value);
    await publish({
      kind: "message",
      sessionId: connection.sessionId,
      audience: "all",
      excludeConnectionId: connection.connectionId,
      excludeClient: { clientId: connection.clientId, role: connection.role },
      message: { type: "storage", key: message.key, value: message.value },
    });
    return;
  }
  if (message.type === "snapshot" && connection.role === "host") {
    const state = filterRemoteSnapshot(message.state);
    await storeSnapshot(connection.sessionId, state);
    await publish({
      kind: "message",
      sessionId: connection.sessionId,
      audience: "remote",
      message: { type: "snapshot", state },
    });
    return;
  }
  if (message.type === "command" && connection.role === "remote") {
    await publish({
      kind: "message",
      sessionId: connection.sessionId,
      audience: "host",
      message: { type: "command", command: message.command },
    });
    return;
  }
  if (message.type === "obs-state" && connection.role === "host") {
    await storeOBSState(connection.sessionId, message.state);
    await publish({
      kind: "message",
      sessionId: connection.sessionId,
      audience: "remote",
      message: { type: "obs-state", state: message.state },
    });
    return;
  }
  if (message.type === "close-session" && connection.role === "host") {
    await closeSession(connection.sessionId, connection.connectionId);
  }
}

async function unregister(socket: WebSocket) {
  const connection = hub.connections.get(socket);
  if (!connection) return;
  hub.connections.delete(socket);
  if (connection.role === "remote") await publishPresence(connection, false);
  if (hub.connections.size === 0) stopBackgroundWork();
}

export function attachRemoteSocket(socket: WebSocket) {
  hub.connections.set(socket, {
    connectionId: randomUUID(),
    clientId: "",
    sessionId: "",
    role: "",
    lastSessionTouch: 0,
  });
  startBackgroundWork();
  let queue = Promise.resolve();
  socket.on("message", (data) => {
    const raw = data.toString();
    queue = queue.then(() => handleMessage(socket, raw)).catch((error) => {
      console.error("[remote] message failed", error);
      send(socket, { type: "error", code: "RELAY_UNAVAILABLE", message: "원격 동기화에 실패했습니다. 연결을 확인해 주세요." });
    });
  });
  const close = () => void unregister(socket);
  socket.on("close", close);
  socket.on("error", close);
}
