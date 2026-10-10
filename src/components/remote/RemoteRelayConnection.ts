import type { RemoteClientMessage, RemoteServerMessage } from "./remoteProtocol";

type Join = Extract<RemoteClientMessage, { type: "join" }>;
type Timer = ReturnType<typeof setTimeout>;
type Link = {
  socket: WebSocket;
  resume: boolean;
  ready: boolean;
  openedAt: number;
  timers: Set<Timer>;
  heartbeat?: Timer;
  watchdog?: Timer;
};

type Options = {
  createSocket: () => WebSocket;
  join: Join;
  onConnected: (connected: boolean) => void;
  onMessage: (message: RemoteServerMessage) => void;
  onUnavailable?: () => void;
  // Shorter timings let tests exercise several real socket handovers quickly.
  renewAfterMs?: number;
  joinTimeoutMs?: number;
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  drainMs?: number;
  retryMs?: number;
  now?: () => number;
};

/** One logical relay connection, with overlapping sockets at function expiry. */
export class RemoteRelayConnection {
  private links = new Set<Link>();
  private active: Link | null = null;
  private pending: Link | null = null;
  private retry?: Timer;
  private retryDelay: number;
  private stopped = true;
  private connected = false;
  private seen = new Set<string>();
  private handover: { previous: Link; next: Link; requestId: string; queued: RemoteClientMessage[]; ready: Extract<RemoteServerMessage, { type: "ready" }>; timer: Timer } | null = null;
  private readonly now: () => number;
  private readonly renewAfterMs: number;

  constructor(private options: Options) {
    this.now = options.now ?? (() => performance.now());
    // Leave at least 30 seconds before the 300-second Vercel deadline. Jitter
    // keeps a host and its phones from all rotating at the same instant.
    this.renewAfterMs = options.renewAfterMs ?? 260_000 + Math.random() * 10_000;
    this.retryDelay = options.retryMs ?? 1_000;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  send(message: RemoteClientMessage) {
    const link = this.active;
    if (!link?.ready || link.socket.readyState !== 1 || this.stopped) return false;
    if (this.handover && message.type !== "close-session") {
      // Briefly fence outgoing messages behind a ping on the old socket. Its
      // pong proves that server has processed earlier writes, so the new
      // instance cannot apply a newer score before an older score arrives.
      this.handover.queued.push(message);
      return true;
    }
    return this.write(link, message);
  }

  /** Browsers can suspend renewal timers while a tab/phone is asleep. */
  wake() {
    if (this.stopped) return;
    if (!this.active || this.now() - this.active.openedAt >= this.renewAfterMs) this.open();
    if (this.active) this.ping(this.active);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.handover = null;
    for (const link of this.links) this.dispose(link);
    this.active = this.pending = null;
    this.setConnected(false);
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.options.onConnected(value);
  }

  private later(link: Link, callback: () => void, ms: number) {
    const timer = setTimeout(() => {
      link.timers.delete(timer);
      if (!this.stopped && this.links.has(link)) callback();
    }, ms);
    link.timers.add(timer);
    return timer;
  }

  private clear(link: Link, timer?: Timer) {
    if (timer === undefined) return;
    clearTimeout(timer);
    link.timers.delete(timer);
  }

  private write(link: Link, message: RemoteClientMessage) {
    try {
      if (link.socket.readyState !== 1) return false;
      link.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.failed(link);
      return false;
    }
  }

  private ping(link: Link) {
    // A second visibility/heartbeat ping must not extend an existing deadline.
    if (link.watchdog !== undefined || !link.ready) return;
    link.watchdog = this.later(link, () => this.failed(link), this.options.heartbeatTimeoutMs ?? 10_000);
    this.write(link, { type: "ping" });
  }

  private heartbeat(link: Link) {
    link.heartbeat = this.later(link, () => {
      this.ping(link);
      if (this.links.has(link)) this.heartbeat(link);
    }, this.options.heartbeatMs ?? 25_000);
  }

  private open() {
    if (this.stopped || this.pending) return;
    clearTimeout(this.retry);
    this.retry = undefined;
    let socket: WebSocket;
    try { socket = this.options.createSocket(); }
    catch { this.scheduleRetry(); return; }
    const link: Link = { socket, resume: Boolean(this.active), ready: false, openedAt: this.now(), timers: new Set() };
    this.links.add(link);
    this.pending = link;
    const joinTimer = this.later(link, () => this.failed(link), this.options.joinTimeoutMs ?? 10_000);
    socket.addEventListener("open", () => {
      if (!this.links.has(link) || this.stopped) return;
      this.write(link, { ...this.options.join, resume: link.resume });
    });
    socket.addEventListener("message", (event) => {
      if (!this.links.has(link) || this.stopped) return;
      let message: RemoteServerMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message || typeof message.type !== "string") return;
      if (message.type === "closed" || (message.type === "error" && ["SESSION_NOT_FOUND", "HOST_CONFLICT", "UPDATE_REQUIRED"].includes(message.code))) {
        this.stop();
        this.options.onMessage(message);
        return;
      }
      if (message.type === "error") {
        // A failed replacement must never interrupt the healthy active socket.
        this.failed(link);
        return;
      }
      if (message.type === "ready") {
        if (link.ready || this.pending !== link) return;
        this.clear(link, joinTimer);
        link.ready = true;
        const previous = this.active;
        if (previous) {
          const requestId = crypto.randomUUID();
          const timer = this.later(link, () => this.failed(link), 2_000);
          this.handover = { previous, next: link, requestId, queued: [], ready: message, timer };
          this.write(previous, { type: "ping", requestId });
        } else {
          this.promote(link, message);
        }
        return;
      }
      if (message.type === "pong") {
        this.clear(link, link.watchdog);
        link.watchdog = undefined;
        if (this.handover?.previous === link && this.handover.requestId === message.requestId) {
          this.promote(this.handover.next, this.handover.ready);
        }
        return;
      }
      // Warm joins must not replay a Redis bootstrap over the live UI. Relay
      // snapshots (with an ID) are real updates and are still delivered.
      if (link.resume && !message.relayId && (message.type === "snapshot" || message.type === "obs-state")) return;
      if (message.relayId) {
        if (this.seen.has(message.relayId)) return;
        this.seen.add(message.relayId);
        if (this.seen.size > 8_192) this.seen.delete(this.seen.values().next().value!);
      }
      this.options.onMessage(message);
    });
    socket.addEventListener("close", () => this.failed(link));
    socket.addEventListener("error", () => this.failed(link));
  }

  private promote(link: Link, message: Extract<RemoteServerMessage, { type: "ready" }>) {
    const previous = this.active;
    const queued = this.handover?.queued ?? [];
    if (this.handover) this.clear(this.handover.next, this.handover.timer);
    this.handover = null;
    this.active = link;
    this.pending = null;
    this.retryDelay = this.options.retryMs ?? 1_000;
    this.setConnected(true);
    this.heartbeat(link);
    this.later(link, () => this.open(), Math.max(0, this.renewAfterMs - (this.now() - link.openedAt)));
    // Receive on both sockets while draining; relay IDs deduplicate delivery.
    if (previous && this.links.has(previous)) {
      for (const timer of previous.timers) clearTimeout(timer);
      previous.timers.clear();
      this.later(previous, () => this.dispose(previous), this.options.drainMs ?? 5_000);
    }
    for (const pending of queued) this.write(link, pending);
    this.options.onMessage(message);
  }

  private dispose(link: Link) {
    if (!this.links.delete(link)) return;
    for (const timer of link.timers) clearTimeout(timer);
    link.timers.clear();
    // Removing first prevents the close event from scheduling a reconnect.
    link.socket.close();
  }

  private failed(link: Link) {
    if (!this.links.has(link) || this.stopped) return;
    const wasActive = this.active === link;
    const wasPending = this.pending === link;
    const handover = this.handover;
    this.dispose(link);
    if (handover?.previous === link) {
      // The prepared replacement can also recover an unexpected old-socket
      // failure without dropping messages accepted during the handover.
      this.promote(handover.next, handover.ready);
      return;
    }
    if (handover?.next === link) {
      this.handover = null;
      for (const message of handover.queued) this.write(handover.previous, message);
    }
    if (wasActive) {
      this.active = null;
      this.setConnected(false);
      // A not-yet-ready warm join could have missed updates during this gap.
      // Restart it as a cold join to fetch a complete snapshot.
      if (this.pending) this.dispose(this.pending);
      this.pending = null;
    }
    if (wasPending) this.pending = null;
    if (wasActive || wasPending) this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.stopped || this.pending || this.retry !== undefined) return;
    if (!this.active) this.options.onUnavailable?.();
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.open();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }
}
