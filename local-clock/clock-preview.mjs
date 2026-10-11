import { formatClock, formatShotClock } from '../shared/clock-format.mjs';

/**
 * Render from a server sample between status polls; held OCR values never tick.
 * @param {string} key
 * @param {{seconds: number, running: boolean} | null} clock
 * @param {number} sampledAt Browser monotonic time of the server sample.
 * @param {number} now Current browser monotonic time.
 */
export function previewClock(key, clock, sampledAt, now) {
  if (!clock) return null;
  const shot = key === 'OBS_BASKETBALL_SHOT_CLOCK';
  const seconds = Math.max(0, clock.seconds - (clock.running ? Math.max(0, now - sampledAt) / 1000 : 0));
  return {
    seconds,
    running: clock.running && (shot || seconds > 0),
    text: shot ? formatShotClock(seconds * 1000) : formatClock(seconds * 1000, true),
  };
}
