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


@dataclass(frozen=True)
class Observation:
    reading: Reading | None
    captured_ms: float


class ReadingGate:
    """Vote over fresh observations in a sliding one-second window.

    Only the newest *observed* value can be accepted; history supplies evidence,
    never an extrapolated/replayed value. Missing frames retain the last confirmed
    display. Reset/recovery paths require more evidence than ordinary countdowns.
    """
    window_ms = 1000

    def __init__(self):
        self.reset()

    def reset(self):
        self.history: list[Observation] = []
        self.confirmed: Reading | None = None
        self.confirmed_ms: float | None = None
        self.last_frame_ms: float | None = None
        self.evidence = 0

    @staticmethod
    def _same_display(a: Reading, b: Reading) -> bool:
        return (a.seconds == b.seconds and a.resolution_ms == b.resolution_ms
                and (":" in a.text) == (":" in b.text))

    @staticmethod
    def _countdown(a: Observation, b: Observation) -> bool:
        elapsed = (b.captured_ms - a.captured_ms) / 1000
        delta = a.reading.seconds - b.reading.seconds
        quantum = max(a.reading.resolution_ms, b.reading.resolution_ms) / 1000
        return elapsed >= .04 and -.001 <= delta <= elapsed + quantum + .12

    def _path(self, current: Observation, *, shot_recovery=False) -> list[Observation]:
        # A reset may already be counting down when it reappears. For that path,
        # as for decimals, corroborate a time-consistent sequence across digits.
        samples = [x for x in self.history if x.reading is not None
                   and x.reading.resolution_ms == current.reading.resolution_ms
                   and (":" in x.reading.text) == (":" in current.reading.text)
                   and (not shot_recovery or 0 <= x.reading.seconds <= 24)
                   and (self.confirmed is None or x.captured_ms > self.confirmed_ms)]
        if current.reading.resolution_ms == 1000 and not shot_recovery:
            return [x for x in samples if self._same_display(x.reading, current.reading)]
        # Rechecking every earlier point prevents chaining many individually
        # plausible drops into an impossibly fast countdown.
        paths: list[list[Observation]] = []
        for sample in samples:
            candidates = [[sample]]
            for path in paths:
                if all(self._countdown(old, sample) for old in path):
                    candidates.append([*path, sample])
            paths.append(max(candidates, key=lambda path: sum(x.reading.confidence for x in path)))
        return paths[-1]

    def accept(self, reading: Reading | None, captured_ms: float, now_ms: float,
               confidence: float = 0.85, *, shot_clock: bool = True,
               tracking: bool = False) -> tuple[bool, str]:
        self.evidence = 0
        if not math.isfinite(captured_ms) or not math.isfinite(now_ms) or not -200 <= now_ms - captured_ms <= 900:
            return False, "오래된 프레임은 건너뜀 · 마지막 확정값 유지"
        if self.last_frame_ms is not None and captured_ms - self.last_frame_ms < 40:
            return False, "중복/역순 프레임은 건너뜀"
        self.last_frame_ms = captured_ms
        if reading and reading.confidence < confidence:
            reading = None
        current = Observation(reading, captured_ms)
        self.history = [x for x in self.history if captured_ms - x.captured_ms <= self.window_ms]
        self.history.append(current)
        if reading is None:
            return False, "가림/낮은 신뢰도 · 마지막 확정값 유지"

        required, span_ms, label = 3, 240, "최근 1초 후보 확인"
        shot_recovery = False
        if self.confirmed is not None:
            old = self.confirmed
            elapsed = (captured_ms - self.confirmed_ms) / 1000
            delta = old.seconds - reading.seconds
            reset = shot_clock and reading.resolution_ms == 1000 and reading.seconds in (14, 24) and abs(delta) > .001
            shot_recovery = (shot_clock and reading.resolution_ms == 1000 and 0 <= reading.seconds <= 24
                             and (reset or delta < -.001 or elapsed >= 1.2))
            if shot_recovery:
                required, span_ms, label = 4, 450, "샷클락 리셋/가림 뒤 복구 확인"
            elif delta < -.001:
                return False, "자동 복구 범위 밖 증가 보류 · 다시 맞추기를 누르세요" if shot_clock else "증가 무시 · 새 경기 시간은 다시 맞추기를 누르세요"
            elif delta > .001:
                quantum = max(old.resolution_ms, reading.resolution_ms) / 1000
                correction = tracking and reading.resolution_ms == 1000 and delta > 1.001
                if not correction and delta > elapsed + quantum + .12:
                    return False, "실제 경과 시간보다 빠른 감소 무시"
                if delta > 1.001:
                    if not correction and elapsed < 1.2:
                        return False, "1초 넘는 급감 보류 · 가림 뒤 복구 확인 중"
                    required, span_ms, label = 4, 450, "감소 보정/가림 뒤 복구 확인"
            elif self._same_display(old, reading) and elapsed <= .6:
                # Repeated confirmed values cannot shift the clock. A fresh frame
                # is still required; blank frames never trigger this path.
                self.evidence = 1
                self.confirmed_ms = captured_ms
                return True, "확정값과 같음"

        # Only fresh evidence after the last confirmation can justify a jump.
        path = self._path(current, shot_recovery=shot_recovery)
        self.evidence = len(path)
        if len(path) < required or captured_ms - path[0].captured_ms < span_ms:
            return False, f"{label} · {min(len(path), required)}/{required}프레임"
        # Compare the newest corroborating sequence to all visible alternatives
        # over the same interval. Occlusion is missing evidence, not a vote.
        evidence = path[-required:]
        alternatives = [x for x in self.history if x.reading and x.captured_ms >= evidence[0].captured_ms]
        support = sum(x.reading.confidence for x in evidence)
        total = sum(x.reading.confidence for x in alternatives)
        if support < total * .7:
            return False, "최근 후보가 충돌하여 보류 · 마지막 확정값 유지"
        self.confirmed = reading
        self.confirmed_ms = captured_ms
        return True, f"{label} 완료 · {len(evidence)}프레임 일치"


class ClockTracker:
    """Integer timer first; camera evidence corrects it or confirms a stop.

    Returns the wire mode to send, or None when the running clock is already close
    enough. No calls are made for missing/unconfirmed frames. Decimal observations
    always hold their exact value, without interpolation.
    """
    def __init__(self):
        self.reset()

    def reset(self):
        self.last_reading = None
        self.last_ms = None
        self.stable_since = None
        self.anchor = None
        self.last_phase_adjust = -math.inf

    def current(self, now_ms):
        if self.anchor is None:
            return None
        seconds, captured, running = self.anchor
        return {"seconds": max(0, seconds - (now_ms - captured) / 1000) if running else seconds,
                "running": running}

    def hold(self, reading: Reading, captured_ms: float):
        self.anchor = (reading.seconds, captured_ms, False)

    def decide(self, reading: Reading, captured_ms: float, *, current=None,
               shot_clock=True, compensation_seconds=0, phase_ms=0,
               phase_ready=False, uncertainty_ms=0, age_ms=0) -> tuple[str | None, str]:
        previous = self.last_reading
        same = previous is not None and ReadingGate._same_display(previous, reading)
        if not same or captured_ms - self.last_ms > 650:
            self.stable_since = captured_ms
        self.last_reading, self.last_ms = reading, captured_ms
        clock = current or self.current(captured_ms)
        # Compare in the physical scoreboard's coordinate system. The web timer
        # is deliberately ahead, so never subtract compensation again on a skip.
        predicted = math.ceil(clock["seconds"] + (compensation_seconds if clock["running"] else 0)) if clock else reading.seconds
        stable = captured_ms - self.stable_since >= 1200
        desired = max(0, reading.seconds - compensation_seconds - phase_ms / 1000 - age_ms / 1000)
        phase_error = abs(clock["seconds"] - desired) if clock else 0
        shot_integer = shot_clock and reading.resolution_ms == 1000 and 0 <= reading.seconds <= 24
        reset = (shot_clock and previous is not None and not same
                 and shot_integer
                 and (reading.seconds > previous.seconds
                      or (reading.seconds in (14, 24) and (previous.seconds - reading.seconds > 1
                                                          or predicted < reading.seconds - 1))))
        preset_reset = (shot_integer and reading.seconds in (14, 24)
                        and (previous is None or previous.resolution_ms == 100 or reset
                             or (clock and reading.seconds - predicted >= 2)))

        if reading.resolution_ms == 100:
            mode, reason = "hold", "소수는 확인된 관찰값만 표시"
        elif preset_reset:
            mode, reason = "hold", "14·24초 리셋 확인 · 숫자 감소까지 정지"
        elif previous is None or previous.resolution_ms == 100 or reset:
            mode, reason = "run", "확인된 값에서 타이머 시작" if not reset else "여러 프레임으로 확인한 샷클락 리셋 반영"
        elif stable:
            mode, reason = "hold", "같은 값이 1.2초 이상 보여 정지로 판단"
        elif shot_integer and clock and reading.seconds - predicted >= 2:
            mode, reason = "run", "가림 중 리셋/정지로 뒤처진 샷클락 복구"
        elif clock and not clock["running"] and reading.seconds < previous.seconds:
            mode, reason = "run", "숫자 감소가 확인되어 타이머 재개"
        elif predicted - reading.seconds >= 2:
            mode, reason = "run", "관찰값이 예측보다 2초 이상 작아 보정"
        elif phase_ready and clock and clock["running"] and abs(predicted - reading.seconds) <= 1 and phase_error > max(.25, uncertainty_ms * 2 / 1000) and captured_ms - self.last_phase_adjust >= 2000:
            mode, reason = "run", "숫자 전환 시각으로 초 경계 보정"
            self.last_phase_adjust = captured_ms
        else:
            return None, "타이머 신뢰 · 오차 1초 이내는 보정하지 않음"

        if mode == "hold" and clock and not clock["running"] and abs(clock["seconds"] - reading.seconds) < .001:
            return None, reason
        seconds = max(0, reading.seconds - compensation_seconds - phase_ms / 1000) if mode == "run" else reading.seconds
        self.anchor = (seconds, captured_ms, mode == "run")
        return mode, reason
