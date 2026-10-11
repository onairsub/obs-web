"""Strict clock parsing and temporal validation, independent of camera/model I/O."""
from dataclasses import dataclass
import math
import re
import unicodedata


@dataclass(frozen=True)
class Reading:
    text: str
    seconds: float
    resolution_ms: int
    confidence: float


def parse_clock(text: str, confidence: float = 1.0, maximum: float = 86400) -> Reading | None:
    text = unicodedata.normalize("NFKC", text).strip()
    # Only spaces beside separators are harmless. Never concatenate separate numbers
    # or invent a missing colon/dot ("50 1" must not silently become 501).
    text = re.sub(r"\s*([:.])\s*", r"\1", text)
    match = re.fullmatch(r"(?:(\d{1,3}):([0-5]\d)(\.\d)?|(\d{1,5})(\.\d)?)", text)
    if not match or not math.isfinite(confidence) or not 0 <= confidence <= 1:
        return None
    minutes, seconds, fraction, plain, plain_fraction = match.groups()
    value = int(minutes) * 60 + int(seconds) + float(fraction or 0) if minutes else float(plain + (plain_fraction or ""))
    if value > maximum:
        return None
    return Reading(text, value, 100 if fraction or plain_fraction else 1000, confidence)


class ReadingGate:
    """Require two compatible fresh reads, including a plausible countdown.

    A new/reset value needs confirmation too. Missing/low-quality frames break
    confirmation, so occlusion never replays the last visible value.
    """
    def __init__(self):
        self.previous: tuple[Reading, float] | None = None

    def reset(self):
        self.previous = None

    def accept(self, reading: Reading | None, captured_ms: float, now_ms: float,
               confidence: float = 0.85) -> tuple[bool, str]:
        if not reading or reading.confidence < confidence:
            self.reset()
            return False, "숫자가 없거나 신뢰도가 낮아 건너뜀"
        if not -200 <= now_ms - captured_ms <= 900:
            self.reset()
            return False, "오래된 프레임은 건너뜀"
        previous = self.previous
        self.previous = (reading, captured_ms)
        if not previous:
            return False, "다음 프레임에서 한 번 더 확인 중"
        old, old_ms = previous
        elapsed = (captured_ms - old_ms) / 1000
        if not 0.04 <= elapsed <= 1.2:
            return False, "프레임 간격을 다시 확인 중"
        quantum = max(old.resolution_ms, reading.resolution_ms) / 1000
        delta = old.seconds - reading.seconds
        # Tenth-second clocks change on nearly every frame; equality alone would
        # reject them forever. Integer clocks can cross one boundary at any time.
        compatible = -0.001 <= delta <= elapsed + quantum + 0.12
        if not compatible:
            return False, "값이 크게 바뀌어 다음 프레임에서 확인 중"
        return True, "연속 프레임 확인됨"
