"""Strict clock parsing and temporal validation, independent of camera/model I/O."""
from dataclasses import dataclass, replace
import math
import re
import unicodedata
from trajectory import ClockTrajectory


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
    if not math.isfinite(confidence) or not 0 <= confidence <= 1:
        return None
    # Some scoreboards use a colon for tenths below one minute. The single
    # trailing digit distinguishes 3:9 (3.9s) from 3:09 (3m 9s).
    short_colon = re.fullmatch(r"([0-5]?\d):(\d)", text)
    if short_colon:
        value = int(short_colon[1]) + int(short_colon[2]) / 10
        return Reading(text, value, 100, confidence) if value <= maximum else None
    match = re.fullmatch(r"(?:(\d{1,3}):([0-5]\d)(\.\d)?|(\d{1,5})(\.\d)?)", text)
    if not match:
        return None
    minutes, seconds, fraction, plain, plain_fraction = match.groups()
    value = int(minutes) * 60 + int(seconds) + float(fraction or 0) if minutes else float(plain + (plain_fraction or ""))
    if value > maximum:
        return None
    return Reading(text, value, 100 if fraction or plain_fraction else 1000, confidence)


def format_confirmed_reading(reading: Reading | None, *, shot_clock: bool) -> Reading | None:
    """Use the timer's format for accepted output, preserving the OCR evidence.

    Raw text still drives validation and is shown as the current candidate.
    Formatting an observed integer as 4.0 must not invent decimal precision
    or turn a running timer into a held decimal observation.
    """
    if reading is None:
        return None
    seconds = reading.seconds
    if seconds < (5 if shot_clock else 60):
        text = f"{seconds:.1f}"
    elif shot_clock:
        text = str(math.ceil(seconds))
    else:
        whole = math.ceil(seconds)
        text = f"{whole // 60:02d}:{whole % 60:02d}"
    return replace(reading, text=text)


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
    game_window_ms = 10000
    game_reset_seconds = (180, 420)
    pause_window_ms = 2200
    game_recovery_seconds = 10

    def __init__(self):
        self.reset()

    def reset(self):
        self.history: list[Observation] = []
        self.confirmed: Reading | None = None
        self.confirmed_ms: float | None = None
        self.last_frame_ms: float | None = None
        self.evidence = 0
        self.game_history: list[Observation] = []
        self.game_reset_confirmed = False
        self.game_pause_confirmed = False
        self.pause_history: list[Observation] = []
        self.game_recovery_ceiling = math.inf
        self.trajectory = ClockTrajectory()
        self.decimal_fit = None
        self.trusted_history: list[Observation] = []

    def set_baseline(self, reading, captured_ms, *, shot_clock):
        self.reset()
        self._confirm(reading, captured_ms, shot_clock=shot_clock)
        self.last_frame_ms = captured_ms

    def _game_pause_evidence(self, reading):
        visible = [x for x in self.pause_history if x.reading]
        matches = [x for x in visible if self._same_display(x.reading, reading)]
        if len(matches) < 4 or matches[-1].captured_ms - matches[0].captured_ms < 1200:
            return []
        # Brief occlusions do not erase stop evidence; a long blind interval
        # cannot prove that the clock was stationary throughout it.
        if any(b.captured_ms - a.captured_ms > 850 for a, b in zip(matches, matches[1:])):
            return []
        visible = [x for x in visible if x.captured_ms >= matches[0].captured_ms]
        if sum(x.reading.confidence for x in matches) < .8 * sum(x.reading.confidence for x in visible):
            return []
        return matches

    def _game_countdown_possible(self, reading, captured_ms):
        # Checking only the latest accepted value lets repeated one-second
        # mistakes chain into a clock that runs faster than real time.
        recent = [x for x in self.game_history if captured_ms - x.captured_ms <= self.game_window_ms]
        if not recent and self.game_history:
            recent = self.game_history[-1:]
        for old in recent:
            quantum = max(old.reading.resolution_ms, reading.resolution_ms) / 1000
            if old.reading.seconds - reading.seconds > (captured_ms - old.captured_ms) / 1000 + quantum + .12:
                return False
        return True

    def _confirm(self, reading, captured_ms, *, shot_clock, game_reset=False, game_pause=False):
        self.confirmed = reading
        self.confirmed_ms = captured_ms
        self.game_reset_confirmed = game_reset
        self.game_pause_confirmed = game_pause
        self.trusted_history = [x for x in self.trusted_history if captured_ms - x.captured_ms <= 10000]
        if game_reset or (shot_clock and reading.resolution_ms == 1000 and reading.seconds in (14, 24)):
            self.trusted_history = []
        self.trusted_history.append(Observation(reading, captured_ms))
        if reading.resolution_ms == 1000:
            self.trajectory.reset()
        if not shot_clock:
            ceiling = reading.seconds + self.game_recovery_seconds
            # Recovery itself cannot keep raising the maximum plausible time.
            self.game_recovery_ceiling = ceiling if game_reset else min(self.game_recovery_ceiling, ceiling)
            self.game_history = [] if game_reset else [x for x in self.game_history if captured_ms - x.captured_ms <= self.game_window_ms]
            self.game_history.append(Observation(reading, captured_ms))
            if game_reset:
                self.pause_history = [Observation(reading, captured_ms)]

    @staticmethod
    def _same_display(a: Reading, b: Reading) -> bool:
        return (a.seconds == b.seconds and a.resolution_ms == b.resolution_ms
                and (a.resolution_ms == 100 or (":" in a.text) == (":" in b.text)))

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
                   and (current.reading.resolution_ms == 100 or (":" in x.reading.text) == (":" in current.reading.text))
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
        self.game_reset_confirmed = False
        self.game_pause_confirmed = False
        self.decimal_fit = None
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
        self.pause_history = [x for x in self.pause_history if captured_ms - x.captured_ms <= self.pause_window_ms]
        self.pause_history.append(current)
        if reading is None:
            return False, "가림/낮은 신뢰도 · 마지막 확정값 유지"

        if tracking and reading.resolution_ms == 100:
            # Compare against trusted points, never a rejected OCR candidate.
            # Keeping a history also prevents consecutive small errors from
            # repeatedly spending the same two-second tolerance.
            references = [x for x in self.trusted_history if captured_ms - x.captured_ms <= 10000]
            if not references:
                references = self.trusted_history[-1:]
            for old in references:
                allowance = max(0, captured_ms-old.captured_ms)/1000 + 2
                if abs(old.reading.seconds-reading.seconds) > allowance + 1e-6:
                    return False, "소수 후보 변화가 경과 시간 + 2초 초과 · 보류"
            self.decimal_fit = self.trajectory.observe(reading, captured_ms)
            if self.decimal_fit is None:
                return False, "소수 관측점에서 정지/감소 직선 가설 확인 중"
            self.evidence = self.decimal_fit.inliers
            self._confirm(reading, captured_ms, shot_clock=shot_clock)
            return True, f"소수 {'감소' if self.decimal_fit.rate else '정지'} 가설 · {self.evidence}/{self.decimal_fit.points}점 일치"

        required, span_ms, label = 3, 240, "최근 1초 후보 확인"
        shot_recovery = game_reset = False
        if self.confirmed is not None:
            old = self.confirmed
            elapsed = (captured_ms - self.confirmed_ms) / 1000
            delta = old.seconds - reading.seconds
            game_possible = shot_clock or self._game_countdown_possible(reading, captured_ms)
            game_reset = (not shot_clock and reading.resolution_ms == 1000
                          and reading.seconds in self.game_reset_seconds
                          and (delta < -.001 or not game_possible))
            if (not shot_clock and not game_reset and game_possible
                    and reading.seconds <= self.game_recovery_ceiling
                    and delta >= -self.game_recovery_seconds):
                pause_evidence = self._game_pause_evidence(reading)
                if pause_evidence:
                    self.evidence = len(pause_evidence)
                    self._confirm(reading, captured_ms, shot_clock=False, game_pause=True)
                    return True, "같은 게임클락을 여러 프레임에서 확인 · 정지값 복구"
            reset = shot_clock and reading.resolution_ms == 1000 and reading.seconds in (14, 24) and abs(delta) > .001
            shot_recovery = (shot_clock and reading.resolution_ms == 1000 and 0 <= reading.seconds <= 24
                             and (reset or delta < -.001 or elapsed >= 1.2))
            if game_reset:
                required, span_ms, label = 4, 450, "게임클락 7:00·3:00 리셋 확인"
            elif not game_possible:
                return False, "게임클락 실제 경과 시간보다 빠른 감소 보류 · 확정 흐름 유지"
            elif shot_recovery:
                required, span_ms, label = 4, 450, "샷클락 리셋/가림 뒤 복구 확인"
            elif delta < -.001:
                return False, "자동 복구 범위 밖 증가 보류 · 다시 맞추기를 누르세요" if shot_clock else "게임클락 증가 보류 · 가까운 정지값은 1.2초 이상 확인 후 복구"
            elif delta > .001:
                quantum = max(old.resolution_ms, reading.resolution_ms) / 1000
                correction = shot_clock and tracking and reading.resolution_ms == 1000 and delta > 1.001
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
                self._confirm(reading, captured_ms, shot_clock=shot_clock)
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
        self._confirm(reading, captured_ms, shot_clock=shot_clock, game_reset=game_reset)
        return True, f"{label} 완료 · {len(evidence)}프레임 일치"


class ClockTracker:
    """Timer first; camera evidence corrects it or confirms a stop.

    Returns the wire mode to send, or None when the running clock is already close
    enough. No calls are made for missing/unconfirmed frames. Shot clocks at or
    below five seconds keep the timer by default. Enabled decimal observations
    fit stopped/countdown trajectories; low-time synchronization is optional.
    """
    def __init__(self):
        self.reset()

    def reset(self):
        self.last_reading = None
        self.last_ms = None
        self.stable_since = None
        self.anchor = None
        self.last_phase_adjust = -math.inf
        self.sync_seconds = None
        self.sync_offset_ms = 0
        self.last_decimal_adjust = -math.inf

    def current(self, now_ms):
        if self.anchor is None:
            return None
        seconds, captured, running = self.anchor
        return {"seconds": max(0, seconds - (now_ms - captured) / 1000) if running else seconds,
                "running": running}

    def hold(self, reading: Reading, captured_ms: float):
        self.anchor = (reading.seconds, captured_ms, False)

    def set_baseline(self, reading, captured_ms, *, running):
        self.reset()
        self.last_reading, self.last_ms = reading, captured_ms
        self.stable_since = captured_ms
        self.anchor = (reading.seconds, captured_ms, running)

    def timer_only(self, reading: Reading, captured_ms: float, *, current=None,
                   shot_clock=True, recovery_confirmed=False,
                   shot_low_sync=False, game_low_sync=True) -> bool:
        clock = current if current is not None else self.current(captured_ms)
        if not shot_clock:
            return not game_low_sync and (reading.seconds < 60 or
                   (clock is not None and clock["seconds"] < 60 and reading.seconds <= 60))
        if shot_low_sync:
            return False
        if reading.seconds <= 5:
            return True
        if clock is None or clock["seconds"] > 5:
            return False
        # Once the timer reaches five seconds, delayed higher observations must
        # not stop it or move it back up. A corroborated reset can leave this
        # interval, including a hidden 14/24 reset first seen at 13 or 12.
        reset = (reading.resolution_ms == 1000 and 5 < reading.seconds <= 24
                 and (reading.seconds in (14, 24)
                      or (recovery_confirmed and reading.seconds - clock["seconds"] >= 2)))
        return not reset

    def decide(self, reading: Reading, captured_ms: float, *, current=None,
               shot_clock=True, compensation_seconds=0, phase_ms=0,
               phase_ready=False, uncertainty_ms=0, age_ms=0,
               recovery_confirmed=False, game_pause_confirmed=False,
               shot_low_sync=False, game_low_sync=True, decimal_fit=None) -> tuple[str | None, str]:
        if self.timer_only(reading, captured_ms, current=current, shot_clock=shot_clock,
                           recovery_confirmed=recovery_confirmed,
                           shot_low_sync=shot_low_sync, game_low_sync=game_low_sync):
            return None, ("샷클락 5초 이하" if shot_clock else "게임클락 1분 미만") + " · 카메라 보정 없이 타이머 유지"
        previous = self.last_reading
        same = previous is not None and ReadingGate._same_display(previous, reading)
        if not same or captured_ms - self.last_ms > 650:
            self.stable_since = captured_ms
        self.last_reading, self.last_ms = reading, captured_ms
        clock = current or self.current(captured_ms)
        if reading.resolution_ms == 100:
            if decimal_fit is None:
                return None, "소수 직선 가설 확인 중 · 기존 타이머 유지"
            mode = "run" if decimal_fit.rate else "hold"
            physical = decimal_fit.seconds
            seconds = max(0, physical - (compensation_seconds if decimal_fit.rate else 0))
            # The authoritative current value is sampled after inference. Local
            # preview current() above is already in capture-time coordinates.
            desired_now = max(0, seconds - (age_ms/1000 if current and decimal_fit.rate else 0))
            reason = f"소수 {'감소' if decimal_fit.rate else '정지'} 가설 · {decimal_fit.inliers}/{decimal_fit.points}점 · 오차 ±{decimal_fit.uncertainty_ms}ms"
            same_mode = clock is not None and clock["running"] == bool(decimal_fit.rate)
            tolerance = max(.12, decimal_fit.uncertainty_ms*2/1000) if decimal_fit.rate else .025
            if same_mode and (abs(clock["seconds"]-desired_now) <= tolerance or
                              (decimal_fit.rate and captured_ms-self.last_decimal_adjust < 400)):
                return None, reason + " · 타이머 유지"
            self.anchor = (seconds, captured_ms, bool(decimal_fit.rate))
            self.last_decimal_adjust = captured_ms
            # Preserve the existing wire contract (seconds in 100ms buckets),
            # with the fitted fractional offset carried separately.
            self.sync_seconds = math.ceil(physical*10 - 1e-9)/10 if decimal_fit.rate else round(physical, 1)
            self.sync_offset_ms = max(0, (self.sync_seconds-physical + compensation_seconds)*1000) if decimal_fit.rate else 0
            return mode, reason
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

        if not shot_clock and game_pause_confirmed:
            mode, reason = "hold", "같은 게임클락을 1.2초 이상 확인 · 실제 정지값으로 복구"
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
