// The OBS controller and local reader use the same display rules.
/** @param {number} ms @param {number} unitMs */
export function ceilClockUnits(ms, unitMs) {
  const units = Math.max(0, ms) / unitMs;
  // Multiplying decimal seconds by 1000 can produce 16100.000000000002.
  // Ignore only floating-point noise, not real fractional milliseconds.
  return Math.ceil(units - Number.EPSILON * Math.max(1, units) * 4);
}

/** @param {number} ms @param {boolean} [tenthsUnderMinute] */
export function formatClock(ms, tenthsUnderMinute = false) {
  if (tenthsUnderMinute && Math.max(0, ms) < 60_000) {
    const tenths = ceilClockUnits(ms, 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const seconds = ceilClockUnits(ms, 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** @param {number} ms */
export function formatShotClock(ms) {
  return Math.max(0, ms) < 5_000
    ? (ceilClockUnits(ms, 100) / 10).toFixed(1)
    : String(ceilClockUnits(ms, 1000));
}

/** @param {number} ms */
export function formatElapsedClock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
