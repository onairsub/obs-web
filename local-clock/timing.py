"""Estimate the fractional second boundary from confirmed integer transitions."""
from statistics import median


class ClockPhase:
    def __init__(self):
        self.reset()

    def reset(self):
        self.samples = []
        self.boundaries = []
        self.last_boundary = None
        self.uncertainty_ms = None

    def observe(self, reading, captured_ms):
        self.samples = [(r, t) for r, t in self.samples if captured_ms - t <= 1600]
        if reading is not None and (not self.samples or captured_ms > self.samples[-1][1]):
            self.samples.append((reading, captured_ms))

    def confirm(self, previous, reading, captured_ms):
        if reading.resolution_ms != 1000:
            self.reset()
            return
        if previous is None or previous.resolution_ms != 1000:
            return
        delta = previous.seconds - reading.seconds
        if delta == 0:
            return
        if delta != 1:
            self.boundaries = []
            self.last_boundary = None
            self.uncertainty_ms = None
            return
        old = [(r, t) for r, t in self.samples if r.seconds == previous.seconds and r.resolution_ms == 1000]
        if not old:
            return
        before = old[-1][1]
        after = next((t for r, t in self.samples if t > before and r.seconds == reading.seconds and r.resolution_ms == 1000), None)
        if after is None or not 40 <= after - before <= 450:
            return
        boundary = (before + after) / 2
        if self.last_boundary is not None and boundary <= self.last_boundary:
            return
        self.last_boundary = boundary
        phase = boundary % 1000
        if self.boundaries and abs((phase - self.boundaries[-1][0] + 500) % 1000 - 500) > 200:
            self.boundaries = []  # A stop/resume can move the second boundary.
        self.boundaries = [*self.boundaries[-5:], (phase, (after - before) / 2)]
        self.uncertainty_ms = round(max(x[1] for x in self.boundaries))

    def estimate(self, captured_ms):
        if not self.boundaries:
            return 0
        reference = self.boundaries[-1][0]
        phase = reference + median((value - reference + 500) % 1000 - 500 for value, _ in self.boundaries)
        return round((captured_ms - phase) % 1000)

    def status(self, captured_ms):
        return {"phase_ms": self.estimate(captured_ms), "samples": len(self.boundaries),
                "uncertainty_ms": self.uncertainty_ms}
