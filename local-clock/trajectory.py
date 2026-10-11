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

    def observe(self, reading, captured_ms):
        self.points = [(r, t) for r, t in self.points if captured_ms - t <= self.window_ms]
        # A blind interval does not constitute evidence for a pause.
        if self.points and captured_ms - self.points[-1][1] > 850:
            self.points = []
        self.points.append((reading, captured_ms))
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
        self.last_fit = winner
        return winner

    def status(self):
        return asdict(self.last_fit) if self.last_fit else None
