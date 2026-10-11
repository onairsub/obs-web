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
    support: float = 1.0
    strong_inliers: int = 0
    temporal_evidence: bool = False


class ClockTrajectory:
    window_ms = 1500
    residual_seconds = .14

    def __init__(self):
        self.reset()

    def reset(self):
        self.points = []
        self.last_fit = None
        self.minimum_confidence = .85
        self.hypotheses = {}
        self.checked_ms = None

    @staticmethod
    def candidate_floor(minimum_confidence):
        # Borderline OCR can provide evidence, but very uncertain text cannot.
        return min(minimum_confidence, max(.65, minimum_confidence-.15))

    def _assess(self, rate, points, indexes, captured_ms, residual):
        inliers = [points[i] for i in indexes]
        support = sum(r.confidence for r, _ in inliers)
        total = sum(r.confidence for r, _ in points)
        ratio = support/total if total else 0
        span = captured_ms-inliers[0][1]
        strong = sum(r.confidence >= self.minimum_confidence for r, _ in inliers)
        required, minimum_span = (4, 600) if rate == 0 else (3, 320)
        latest = len(points)-1 in indexes
        coherent = (latest and ratio >= .7 and span >= minimum_span
                    and all(b[1]-a[1] <= 850 for a, b in zip(inliers, inliers[1:]))
                    and (not rate or inliers[0][0].seconds-points[-1][0].seconds >= .25))
        # A correct countdown changes digits every frame. Accumulate agreement
        # after projecting to one timestamp, not votes for an identical number.
        # Weaker OCR needs more independent evidence and a tighter line.
        pooled = (len(inliers) >= 5 and span >= 600 and ratio >= .85 and residual <= .06
                  and support/len(inliers) >= max(self.candidate_floor(self.minimum_confidence), self.minimum_confidence-.1)-1e-6)
        qualified = coherent and (strong >= required or pooled)
        evidence = {"inliers": len(inliers), "points": len(points), "support": round(ratio,3),
                    "span_ms": round(span), "strong_inliers": strong,
                    "residual_ms": round(residual*1000), "qualified": qualified,
                    "temporal_evidence": qualified and strong < required}
        rank = (qualified, support-(total-support), -residual, span)
        old = self.hypotheses.get(rate)
        if old is None or rank > old[0]:
            self.hypotheses[rate] = (rank,evidence)
        return qualified, ratio, strong, qualified and strong < required

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
        strong = sum(r.confidence >= self.minimum_confidence for r, _ in matches)
        if (strong >= 3 and captured_ms-matches[0][1] >= 240
                and support >= total*.7
                and all(b[1]-a[1] <= 850 for a, b in zip(matches, matches[1:]))):
            return ClockFit(newest.seconds, captured_ms, 0, len(matches), len(recent),
                            round(captured_ms-matches[0][1]), 50, support/total, strong)

        stopped = self.last_fit
        if not stopped or stopped.rate != 0 or len(self.points) < 2:
            return None
        (first, first_ms), (last, last_ms) = self.points[-2:]
        if min(first.confidence,last.confidence) < self.minimum_confidence:
            return None
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
                        round(last_ms-first_ms), round((abs(drop-elapsed)/2+.05)*1000), 1.0, 2)

    def _remember(self, fit):
        if self.last_fit is not None and self.last_fit.rate != fit.rate:
            # Once a transition is supported, observations from the previous
            # state must not outvote it again or pull its offset backward.
            self.points = [(r, t) for r, t in self.points if t >= fit.captured_ms-fit.span_ms-1]
        self.last_fit = fit
        return fit

    def observe(self, reading, captured_ms, minimum_confidence=.85):
        self.minimum_confidence = minimum_confidence
        self.hypotheses = {}
        self.checked_ms = captured_ms
        self.points = [(r, t) for r, t in self.points if captured_ms - t <= self.window_ms]
        # A blind interval does not constitute evidence for a pause.
        if self.points and captured_ms - self.points[-1][1] > 850:
            self.points = []
        self.points.append((reading, captured_ms))
        transition = self._transition(captured_ms)
        candidates = []
        # Recent suffixes allow a stop/resume to replace an older trajectory.
        # Within each suffix use consensus first, then a weighted median offset.
        for start in range(max(1,len(self.points) - 2)):
            points = self.points[start:]
            for rate in (0, 1):
                projected = [r.seconds - rate * (captured_ms-t)/1000 for r, t in points]
                total = sum(r.confidence for r, _ in points)
                for seed in projected:
                    indexes = [i for i, value in enumerate(projected) if abs(value-seed) <= self.residual_seconds]
                    offset = self._weighted_median([(projected[i], points[i][0].confidence) for i in indexes])
                    indexes = [i for i, value in enumerate(projected) if abs(value-offset) <= self.residual_seconds]
                    inliers = [points[i] for i in indexes]
                    support = sum(r.confidence for r, _ in inliers)
                    span = captured_ms - inliers[0][1]
                    residual = median(abs(projected[i]-offset) for i in indexes)
                    qualified, ratio, strong, pooled = self._assess(rate,points,indexes,captured_ms,residual)
                    if not qualified:
                        continue
                    # Running tenths identify a 100ms ceil bucket. Its midpoint
                    # estimates phase without inventing sub-frame precision.
                    fit = ClockFit(max(0, offset - (.05 if rate else 0)), captured_ms,
                                   rate, len(inliers), len(points), round(span), round((residual+.05)*1000),
                                   ratio, strong, pooled)
                    candidates.append((support - (total-support), -residual, span, fit))
        if transition is not None:
            self.hypotheses[transition.rate] = ((True,float('inf'),0,0), {
                "inliers": transition.inliers, "points": transition.points,
                "support": round(transition.support,3), "span_ms": transition.span_ms,
                "strong_inliers": transition.strong_inliers, "residual_ms": 0,
                "qualified": True, "temporal_evidence": False})
            return self._remember(transition)
        if not candidates:
            return None
        winner = max(candidates, key=lambda item: item[:3])[3]
        return self._remember(winner)

    def status(self):
        return asdict(self.last_fit) if self.last_fit else None

    def diagnostics(self):
        return {"captured_ms": self.checked_ms, "observations": len(self.points),
                "running": self.hypotheses.get(1,(None,None))[1],
                "stopped": self.hypotheses.get(0,(None,None))[1]}
