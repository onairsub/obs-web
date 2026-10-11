// Sport display rules shared by manual and camera-synchronized clocks.
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
