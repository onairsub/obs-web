"use client";

import { useCallback, useEffect, useState } from "react";
import { useRemoteControl } from "../remote/RemoteControlContext";
import { clockValue, type ClockDirection, type ClockKey } from "./clockSync";

export function usePersistentClock(
  storageKey: ClockKey,
  initialSeconds: number,
  direction: ClockDirection,
  tickMs = 100
) {
  const { clockState, clockNow, clockReady, controlClock, role } = useRemoteControl();
  const [, redraw] = useState(0);
  const clock = clockState?.clocks[storageKey] ?? { running: false, baseMs: initialSeconds * 1000, startedAt: 0 };
  const ready = clockReady();
  // Rendering may interpolate, but it must never publish an expiry or a value
  // calculated with a phone's clock back to the host.
  const valueMs = clockValue(clock, direction, clockNow());
  const running = clock.running && (direction === "up" || valueMs > 0);

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

export function formatClock(ms: number, tenthsUnderMinute = false) {
  const safeMs = Math.max(0, ms);
  if (tenthsUnderMinute && safeMs < 60_000) {
    const totalTenths = Math.ceil(safeMs / 100);
    const seconds = Math.floor(totalTenths / 10);
    return `${seconds}.${totalTenths % 10}`;
  }
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatShotClock(ms: number) {
  const safeMs = Math.max(0, ms);
  if (safeMs < 5_000) return (Math.ceil(safeMs / 100) / 10).toFixed(1);
  return Math.ceil(safeMs / 1000).toString();
}

export function formatElapsedClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
