/** Match the relay's 24-hour limit; accept seconds to one decimal place. */
export function parseClockInput(minutes: string, seconds: string): number | null {
  const m = minutes.trim();
  const s = seconds.trim();
  if (!/^\d+$/.test(m) || !/^\d+(?:\.\d)?$/.test(s)) return null;
  const minuteValue = Number(m);
  const secondValue = Number(s);
  const totalTenths = minuteValue * 600 + Math.round(secondValue * 10);
  if (!Number.isSafeInteger(totalTenths) || minuteValue > 1440 || secondValue >= 60 || totalTenths > 864000) return null;
  return totalTenths / 10;
}

export function parseShotClockInput(seconds: string): number | null {
  const s = seconds.trim();
  if (!/^\d+(?:\.\d)?$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) && value <= 86400 ? Math.round(value * 10) / 10 : null;
}

/** Inline editing accepts the displayed MM:SS or seconds-only form. */
export function parseClockText(value: string, secondsOnly = false): number | null {
  const parts = value.trim().split(":");
  if (parts.length === 1) return parseShotClockInput(parts[0]);
  if (secondsOnly || parts.length !== 2) return null;
  return parseClockInput(parts[0], parts[1]);
}
