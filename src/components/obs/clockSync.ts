// Timer state is written only by the OBS host. Remote devices send operations,
// never their own remaining time or wall-clock timestamps.
export const CLOCK_KEYS = ["OBS_SOCCER_CLOCK", "OBS_BASKETBALL_GAME_CLOCK", "OBS_BASKETBALL_SHOT_CLOCK"] as const;
// Increment when host-side clock semantics change. A new phone must not send
// commands to an old host that still treats shot-clock zero as a stopped clock.
export const CLOCK_PROTOCOL_VERSION = 2;
export type ClockKey = typeof CLOCK_KEYS[number];
export type ClockDirection = "up" | "down";
export type ClockDisplay = { format: "seconds" | "minutes"; resolutionMs: 100 | 1000 };
export type StoredClock = { running: boolean; baseMs: number; startedAt: number; observedDisplay?: ClockDisplay };
export type ClockOperation =
  | { action: "start" }
  | { action: "pause" }
  | { action: "observe"; seconds: number; resolutionMs: 100 | 1000; capturedAt: number; mode: "preserve" | "hold" | "run"; format?: "seconds" | "minutes"; offsetMs?: number }
  | { action: "reset" | "adjust"; seconds: number; keepRunning: boolean };
export type ClockSnapshot = {
  clockVersion?: number; // Absent on legacy hosts; parsed so the UI can explain.
  observationVersion?: number; // Additive capability: older manual remotes still work.
  trackingVersion?: number; // Explicit support for starting a camera-followed timer.
  epoch: string;
  revision: number;
  hostNow: number;
  clocks: Record<ClockKey, StoredClock>;
};
export type ClockCommand = {
  id: string;
  epoch: string;
  issuedAt: number;
  key: ClockKey;
  operation: ClockOperation;
};

export function isClockKey(value: unknown): value is ClockKey {
  return typeof value === "string" && (CLOCK_KEYS as readonly string[]).includes(value);
}

export function clockDirection(key: ClockKey): ClockDirection {
  return key === "OBS_SOCCER_CLOCK" ? "up" : "down";
}

// The shot clock stays armed at zero until explicitly paused. Other clocks
// retain their existing expiry behavior; the value itself is always clamped.
export function clockKeepsRunningAtZero(key: ClockKey) {
  return key === "OBS_BASKETBALL_SHOT_CLOCK";
}

export function clockValue(clock: StoredClock, direction: ClockDirection, now: number) {
  const elapsed = clock.running ? Math.max(0, now - clock.startedAt) : 0;
  return Math.max(0, clock.baseMs + (direction === "down" ? -elapsed : elapsed));
}

export function clockRunning(clock: StoredClock, direction: ClockDirection, now: number, keepRunningAtZero = false) {
  return clock.running && (keepRunningAtZero || direction === "up" || clockValue(clock, direction, now) > 0);
}

// Camera observations retain the physical display's punctuation and precision,
// including decimal shot-clock values above the usual five-second threshold.
export function formatObservedClock(ms: number, display: ClockDisplay) {
  const units = Math.ceil(Math.max(0, ms) / display.resolutionMs);
  const tenths = display.resolutionMs === 100;
  const totalSeconds = tenths ? Math.floor(units / 10) : units;
  const suffix = tenths ? `.${units % 10}` : "";
  if (display.format === "seconds") return `${totalSeconds}${suffix}`;
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}${suffix}`;
}

export function changeClock(clock: StoredClock, direction: ClockDirection, operation: ClockOperation, now: number, initialSeconds: number, keepRunningAtZero = false): StoredClock {
  const value = clockValue(clock, direction, now);
  const wasRunning = clockRunning(clock, direction, now, keepRunningAtZero);
  if (operation.action === "start") {
    if (wasRunning) return clock;
    const baseMs = direction === "down" && value <= 0 ? initialSeconds * 1000 : value;
    return { running: keepRunningAtZero || direction === "up" || baseMs > 0, baseMs, startedAt: now };
  }
  if (operation.action === "pause") return { running: false, baseMs: value, startedAt: 0 };
  if (operation.action === "observe") {
    const running = operation.mode === "run" || (operation.mode === "preserve" && wasRunning);
    const age = Math.max(0, now - operation.capturedAt);
    // The observed number is the upper edge of the display's ceil bucket.
    const baseMs = Math.max(0, operation.seconds * 1000 - (running ? age + (operation.offsetMs ?? 0) : 0));
    const displayedNow = Math.ceil(value / operation.resolutionMs);
    const observedNow = Math.ceil(baseMs / operation.resolutionMs);
    const observedDisplay: ClockDisplay = { format: operation.format ?? "seconds", resolutionMs: operation.resolutionMs };
    const sameDisplay = clock.observedDisplay?.format === observedDisplay.format && clock.observedDisplay.resolutionMs === observedDisplay.resolutionMs;
    const samePhase = operation.mode !== "run" || Math.abs(value - baseMs) < 100;
    if (displayedNow === observedNow && running === wasRunning && samePhase) return sameDisplay ? clock : { ...clock, observedDisplay };
    return { running, baseMs, startedAt: running ? now : 0, observedDisplay };
  }
  const baseMs = Math.max(0, (operation.action === "adjust" ? value : 0) + operation.seconds * 1000);
  const running = operation.keepRunning && wasRunning && (keepRunningAtZero || direction === "up" || baseMs > 0);
  return { running, baseMs, startedAt: running ? now : 0 };
}

export function isStoredClock(value: unknown): value is StoredClock {
  if (!value || typeof value !== "object") return false;
  const c = value as StoredClock;
  const display = c.observedDisplay;
  return typeof c.running === "boolean" && Number.isFinite(c.baseMs) && c.baseMs >= 0 && Number.isFinite(c.startedAt) && c.startedAt >= 0
    && (display === undefined || Boolean(display && (display.format === "seconds" || display.format === "minutes") && (display.resolutionMs === 100 || display.resolutionMs === 1000)));
}

export function isClockSnapshot(value: unknown): value is ClockSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as ClockSnapshot;
  return typeof s.epoch === "string" && s.epoch.length <= 64 && Number.isSafeInteger(s.revision) && s.revision >= 0 && Number.isFinite(s.hostNow)
    && (s.clockVersion === undefined || (Number.isSafeInteger(s.clockVersion) && s.clockVersion > 0))
    && Boolean(s.clocks) && CLOCK_KEYS.every((key) => isStoredClock(s.clocks[key]));
}

export function isClockCommand(value: unknown): value is ClockCommand {
  if (!value || typeof value !== "object") return false;
  const c = value as ClockCommand;
  if (typeof c.id !== "string" || c.id.length < 8 || c.id.length > 64 || typeof c.epoch !== "string" || c.epoch.length > 64 || !Number.isFinite(c.issuedAt) || !isClockKey(c.key)) return false;
  const op = c.operation;
  if (op?.action === "observe") {
    return c.key !== "OBS_SOCCER_CLOCK" && Number.isFinite(op.seconds) && op.seconds >= 0 && op.seconds <= 86400
      && (op.resolutionMs === 100 || op.resolutionMs === 1000) && Number.isFinite(op.capturedAt)
      && (op.mode === "preserve" || op.mode === "hold" || (op.mode === "run" && op.resolutionMs === 1000))
      && (op.format === undefined || op.format === "seconds" || op.format === "minutes")
      && (op.offsetMs === undefined || (op.mode === "run" && Number.isFinite(op.offsetMs) && op.offsetMs >= 0 && op.offsetMs <= 5000))
      && Math.abs(op.seconds * 1000 / op.resolutionMs - Math.round(op.seconds * 1000 / op.resolutionMs)) < 0.000001;
  }
  return Boolean(op) && (op.action === "start" || op.action === "pause" || ((op.action === "adjust" || op.action === "reset") && Number.isFinite(op.seconds) && Math.abs(op.seconds) <= 86400 && typeof op.keepRunning === "boolean"));
}

export class HostClocks {
  private revision = 0;
  private clocks: Record<ClockKey, StoredClock>;
  private seen = new Set<string>();
  private lastObservation = new Map<ClockKey, number>();
  private lastManualChange = new Map<ClockKey, number>();

  constructor(
    readonly epoch: string,
    readonly now: () => number,
    private initialSeconds: (key: ClockKey) => number,
    read: (key: ClockKey) => unknown,
    private write: (key: ClockKey, clock: StoredClock) => void,
  ) {
    this.clocks = Object.fromEntries(CLOCK_KEYS.map((key) => {
      const saved = read(key);
      return [key, isStoredClock(saved) ? saved : { running: false, baseMs: initialSeconds(key) * 1000, startedAt: 0 }];
    })) as Record<ClockKey, StoredClock>;
  }

  snapshot(): ClockSnapshot {
    return { clockVersion: CLOCK_PROTOCOL_VERSION, observationVersion: 1, trackingVersion: 2, epoch: this.epoch, revision: this.revision, hostNow: this.now(), clocks: { ...this.clocks } };
  }

  apply(key: ClockKey, operation: ClockOperation): ClockSnapshot {
    // Synchronous read/modify/write: consecutive commands use the latest state,
    // even when React has not rendered yet or several phones send at once.
    const clock = changeClock(this.clocks[key], clockDirection(key), operation, this.now(), this.initialSeconds(key), clockKeepsRunningAtZero(key));
    if (operation.action !== "observe") this.lastManualChange.set(key, this.now());
    if (clock === this.clocks[key]) return this.snapshot();
    this.clocks[key] = clock;
    this.revision++;
    this.write(key, clock);
    return this.snapshot();
  }

  receive(command: ClockCommand): ClockSnapshot | null {
    if (!isClockCommand(command)) return null;
    if (command.epoch !== this.epoch || this.seen.has(command.id)) return null;
    const age = this.now() - command.issuedAt;
    if (age < -2000 || age > 5000) return null;
    if (command.operation.action === "observe") {
      const capturedAt = command.operation.capturedAt;
      const captureAge = this.now() - capturedAt;
      if (captureAge < -200 || captureAge > 1000 || capturedAt > command.issuedAt + 200
        || capturedAt <= (this.lastObservation.get(command.key) ?? -Infinity)
        || capturedAt < (this.lastManualChange.get(command.key) ?? -Infinity)) return null;
      this.lastObservation.set(command.key, capturedAt);
    }
    this.seen.add(command.id);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    return this.apply(command.key, command.operation);
  }
}

export class RemoteClocks {
  snapshot: ClockSnapshot | null = null;
  requiresHostUpdate = false;
  private offset: number | null = null;
  private bestRtt = Infinity;
  private sampledAt = 0;
  private lastSeen = -Infinity;
  private probes = new Map<string, number>();

  constructor(private localNow: () => number) {}

  probe(id: string) {
    const now = this.localNow();
    for (const [key, sent] of this.probes) if (now - sent > 5000) this.probes.delete(key);
    this.probes.set(id, now);
  }

  accept(snapshot: ClockSnapshot, replyTo?: string) {
    const received = this.localNow();
    const sent = replyTo ? this.probes.get(replyTo) : undefined;
    if (replyTo) this.probes.delete(replyTo);
    const rtt = sent === undefined ? Infinity : received - sent;
    const measured = rtt >= 0 && rtt < 2000;
    // Only a response to this device's live probe can establish a new host.
    const newHost = this.snapshot?.epoch !== snapshot.epoch;
    if (newHost && !measured) return false;
    if (!newHost && snapshot.revision < this.snapshot!.revision) return false;
    if (replyTo && !measured) return false;
    if (snapshot.clockVersion !== CLOCK_PROTOCOL_VERSION) {
      this.requiresHostUpdate = true;
      this.snapshot = null;
      this.offset = null;
      this.lastSeen = -Infinity;
      return false;
    }
    if (newHost) {
      this.probes.clear();
      this.bestRtt = Infinity;
      this.offset = null;
    }
    if (measured && (rtt <= this.bestRtt || received - this.sampledAt > 60000)) {
      this.offset = snapshot.hostNow - (sent! + received) / 2;
      this.bestRtt = rtt;
      this.sampledAt = received;
    }
    if (this.offset === null) return false;
    this.requiresHostUpdate = false;
    this.snapshot = snapshot;
    this.lastSeen = received;
    return true;
  }

  now = () => this.localNow() + (this.offset ?? 0);
  ready = () => this.offset !== null && this.localNow() - this.lastSeen < 30000;
}
