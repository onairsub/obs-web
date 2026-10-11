"""Robust, fixed-slope hypotheses for observed tenths: stopped or -1 s/s."""
from dataclasses import asdict, dataclass
from statistics import median


@dataclass(frozen=True)
class ClockFit:
    seconds: float
    captured_ms: float
    rate: int
    inliers: int
    points: int
    span_ms: int
    uncertainty_ms: int


class ClockTrajectory:
    window_ms = 1500
    residual_seconds = .14

    def __init__(self):
        self.reset()

    def reset(self):
        self.points = []
        self.last_fit = None

    @staticmethod
    def _weighted_median(values):
        ordered = sorted(values)
        midpoint = sum(weight for _, weight in ordered) / 2
        cumulative = 0
        for value, weight in ordered:
            cumulative += weight
            if cumulative >= midpoint:
                return value

    def _transition(self, captured_ms):
        """Detect a new state without waiting for the old 1.5s line to expire.

        Repeated *identical* tenths give stronger stop evidence than the loose
        residual used to fit a noisy line. Resume needs two decreasing frames
        consistent with both real time and the previously established stop.
        Neither path can turn a single wrong digit into a state change.
        """
        recent = self.points
        newest = recent[-1][0]
        matches = [(r, t) for r, t in recent if abs(r.seconds-newest.seconds) < .025]
        recent = [(r, t) for r, t in recent if t >= matches[0][1]]
        support = sum(r.confidence for r, _ in matches)
        total = sum(r.confidence for r, _ in recent)
        if (len(matches) >= 3 and captured_ms-matches[0][1] >= 240
                and support >= total*.7
                and all(b[1]-a[1] <= 850 for a, b in zip(matches, matches[1:]))):
            return ClockFit(newest.seconds, captured_ms, 0, len(matches), len(recent),
                            round(captured_ms-matches[0][1]), 50)

        stopped = self.last_fit
        if not stopped or stopped.rate != 0 or len(self.points) < 2:
            return None
        (first, first_ms), (last, last_ms) = self.points[-2:]
        elapsed = (last_ms-first_ms)/1000
        held_points = [(r, t) for r, t in self.points
                       if t < first_ms and abs(r.seconds-stopped.seconds) < .025]
        # A loose stationary fit may include the first 0.1s decrease as noise.
        # Anchor to the last actual held digit, not that fit's update timestamp.
        if not held_points:
            return None
        held_ms = held_points[-1][1]
        # A long blind gap requires the ordinary three-point fit.
        if not (0 < first_ms-held_ms <= 450 and .12 <= elapsed <= .45):
            return None
        first_drop = stopped.seconds-first.seconds
        drop = first.seconds-last.seconds
        if not (.1-1e-6 <= first_drop <= (first_ms-held_ms)/1000 + .12
                and stopped.seconds-last.seconds >= .25
                and drop >= .1-1e-6 and abs(drop-elapsed) <= .11):
            return None
        projected = [first.seconds-elapsed, last.seconds]
        offset = self._weighted_median([(projected[0], first.confidence), (projected[1], last.confidence)])
        return ClockFit(max(0, offset-.05), captured_ms, 1, 2, 2,
                        round(last_ms-first_ms), round((abs(drop-elapsed)/2+.05)*1000))

    def _remember(self, fit):
        if self.last_fit is not None and self.last_fit.rate != fit.rate:
            # Once a transition is supported, observations from the previous
            # state must not outvote it again or pull its offset backward.
            self.points = [(r, t) for r, t in self.points if t >= fit.captured_ms-fit.span_ms-1]
        self.last_fit = fit
        return fit

    def observe(self, reading, captured_ms):
        self.points = [(r, t) for r, t in self.points if captured_ms - t <= self.window_ms]
        # A blind interval does not constitute evidence for a pause.
        if self.points and captured_ms - self.points[-1][1] > 850:
            self.points = []
        self.points.append((reading, captured_ms))
        transition = self._transition(captured_ms)
        if transition is not None:
            return self._remember(transition)
        candidates = []
        # Recent suffixes allow a stop/resume to replace an older trajectory.
        # Within each suffix use consensus first, then a weighted median offset.
        for start in range(len(self.points) - 2):
            points = self.points[start:]
            for rate in (0, 1):
                required, minimum_span = (4, 600) if rate == 0 else (3, 320)
                projected = [r.seconds - rate * (captured_ms-t)/1000 for r, t in points]
                total = sum(r.confidence for r, _ in points)
                for seed in projected:
                    indexes = [i for i, value in enumerate(projected) if abs(value-seed) <= self.residual_seconds]
                    if len(indexes) < required:
                        continue
                    offset = self._weighted_median([(projected[i], points[i][0].confidence) for i in indexes])
                    indexes = [i for i, value in enumerate(projected) if abs(value-offset) <= self.residual_seconds]
                    if len(indexes) < required or len(points)-1 not in indexes:
                        continue
                    inliers = [points[i] for i in indexes]
                    support = sum(r.confidence for r, _ in inliers)
                    span = captured_ms - inliers[0][1]
                    if support < total*.7 or span < minimum_span:
                        continue
                    if any(b[1]-a[1] > 850 for a, b in zip(inliers, inliers[1:])):
                        continue
                    if rate and inliers[0][0].seconds - reading.seconds < .25:
                        continue
                    residual = median(abs(projected[i]-offset) for i in indexes)
                    # Running tenths identify a 100ms ceil bucket. Its midpoint
                    # estimates phase without inventing sub-frame precision.
                    fit = ClockFit(max(0, offset - (.05 if rate else 0)), captured_ms,
                                   rate, len(inliers), len(points), round(span), round((residual+.05)*1000))
                    candidates.append((support - (total-support), -residual, span, fit))
        if not candidates:
            return None
        winner = max(candidates, key=lambda item: item[:3])[3]
        return self._remember(winner)

    def status(self):
        return asdict(self.last_fit) if self.last_fit else None
