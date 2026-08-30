"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

type ClockDirection = "up" | "down";

type StoredClock = {
  running: boolean;
  baseMs: number;
  startedAt: number;
};

export function usePersistentClock(
  storageKey: string,
  initialSeconds: number,
  direction: ClockDirection,
  tickMs = 100
) {
  const [clock, setClock] = useLocalStorage<StoredClock>(storageKey, {
    running: false,
    baseMs: initialSeconds * 1000,
    startedAt: 0,
  });
  const [now, setNow] = useState(() => Date.now());

  const valueMs = useMemo(() => {
    if (!clock.running || clock.startedAt === 0) return Math.max(0, clock.baseMs);
    const delta = Math.max(0, now - clock.startedAt);
    return direction === "down"
      ? Math.max(0, clock.baseMs - delta)
      : Math.max(0, clock.baseMs + delta);
  }, [clock, direction, now]);

  useEffect(() => {
    if (!clock.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [clock.running, tickMs]);

  useEffect(() => {
    if (direction === "down" && clock.running && valueMs <= 0) {
      setClock({ running: false, baseMs: 0, startedAt: 0 });
    }
  }, [clock.running, direction, setClock, valueMs]);

  const currentValue = useCallback(() => {
    if (!clock.running || clock.startedAt === 0) return Math.max(0, clock.baseMs);
    const delta = Math.max(0, Date.now() - clock.startedAt);
    return direction === "down"
      ? Math.max(0, clock.baseMs - delta)
      : Math.max(0, clock.baseMs + delta);
  }, [clock, direction]);

  const start = useCallback(() => {
    if (clock.running) return;
    const nextBase = direction === "down" && clock.baseMs <= 0
      ? initialSeconds * 1000
      : clock.baseMs;
    setNow(Date.now());
    setClock({ running: true, baseMs: nextBase, startedAt: Date.now() });
  }, [clock, direction, initialSeconds, setClock]);

  const pause = useCallback(() => {
    if (!clock.running) return;
    setClock({ running: false, baseMs: currentValue(), startedAt: 0 });
  }, [clock.running, currentValue, setClock]);

  const reset = useCallback((seconds = initialSeconds) => {
    setNow(Date.now());
    setClock({ running: false, baseMs: Math.max(0, seconds * 1000), startedAt: 0 });
  }, [initialSeconds, setClock]);

  const adjust = useCallback((seconds: number) => {
    setClock({ running: false, baseMs: Math.max(0, currentValue() + seconds * 1000), startedAt: 0 });
  }, [currentValue, setClock]);

  return { valueMs, running: clock.running, start, pause, reset, adjust };
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
