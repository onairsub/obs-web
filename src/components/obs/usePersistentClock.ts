"use client";

import { useCallback, useEffect, useState } from "react";
import { useRemoteControl } from "../remote/RemoteControlContext";
import { clockValue, clockRunning, clockKeepsRunningAtZero, type ClockDirection, type ClockKey, type StoredClock } from "./clockSync";

export function usePersistentClock(
  storageKey: ClockKey,
  initialSeconds: number,
  direction: ClockDirection,
  tickMs = 100
) {
  const { clockState, clockNow, clockReady, controlClock, role } = useRemoteControl();
  const [, redraw] = useState(0);
  const clock: StoredClock = clockState?.clocks[storageKey] ?? { running: false, baseMs: initialSeconds * 1000, startedAt: 0 };
  const ready = clockReady();
  // Rendering may interpolate, but it must never publish an expiry or a value
  // calculated with a phone's clock back to the host.
  const now = clockNow();
  const valueMs = clockValue(clock, direction, now);
  const running = clockRunning(clock, direction, now, clockKeepsRunningAtZero(storageKey));

  useEffect(() => {
    if (!clock.running && role !== "remote") return;
    const tick = () => redraw((value) => value + 1);
    const timer = window.setInterval(tick, tickMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [clock.running, role, tickMs]);

  const start = useCallback(() => {
    controlClock(storageKey, { action: "start" });
  }, [controlClock, storageKey]);

  const pause = useCallback(() => {
    controlClock(storageKey, { action: "pause" });
  }, [controlClock, storageKey]);

  const reset = useCallback((seconds = initialSeconds, keepRunning = false) => {
    controlClock(storageKey, { action: "reset", seconds, keepRunning });
  }, [controlClock, initialSeconds, storageKey]);

  const adjust = useCallback((seconds: number, keepRunning = false) => {
    controlClock(storageKey, { action: "adjust", seconds, keepRunning });
  }, [controlClock, storageKey]);

  return { valueMs, running, ready, start, pause, reset, adjust };
}

export { formatClock, formatShotClock, formatElapsedClock } from "./clockFormat";
