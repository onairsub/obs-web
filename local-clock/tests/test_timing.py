import unittest
from clock_reader import ClockTracker, parse_clock
from timing import ClockPhase


class PhaseTests(unittest.TestCase):
    def test_transition_bracket_estimates_fraction_without_inventing_delay(self):
        phase = ClockPhase()
        self.assertEqual(phase.estimate(1000), 0)
        for value, t in [('24', 850), ('24', 970), ('23', 1090), ('23', 1270), ('23', 1450)]:
            phase.observe(parse_clock(value), t)
        phase.confirm(parse_clock('24'), parse_clock('23'), 1450)
        self.assertEqual(phase.estimate(1450), 420)  # boundary midpoint = 1030
        self.assertEqual(phase.uncertainty_ms, 60)
        self.assertEqual(phase.status(1450)['samples'], 1)

    def test_phase_wraps_near_zero_and_tolerates_frame_jitter(self):
        phase = ClockPhase()
        for previous, current, before, after in [('24','23',920,1060), ('23','22',1940,2080)]:
            phase.observe(parse_clock(previous), before)
            phase.observe(parse_clock(current), after)
            phase.confirm(parse_clock(previous), parse_clock(current), after+360)
        self.assertEqual(phase.estimate(2400), 400)  # phases 990 and 10 average to 0, not 500

    def test_long_occlusion_reset_and_decimal_do_not_fit_a_false_boundary(self):
        phase = ClockPhase()
        phase.observe(parse_clock('24'), 1000)
        phase.observe(parse_clock('23'), 1800)
        phase.confirm(parse_clock('24'), parse_clock('23'), 2000)
        self.assertEqual(phase.estimate(2000), 0)
        phase.observe(parse_clock('23'), 2080)
        phase.observe(parse_clock('22'), 2260)
        phase.confirm(parse_clock('23'), parse_clock('22'), 2440)
        self.assertGreater(phase.status(2440)['samples'], 0)
        phase.confirm(parse_clock('22'), parse_clock('14'), 2700)
        self.assertEqual(phase.status(2700)['samples'], 0)
        phase.confirm(parse_clock('5'), parse_clock('4.9'), 2800)
        self.assertEqual(phase.estimate(2800), 0)

    def test_phase_correction_refines_a_running_clock_then_avoids_jitter(self):
        tracker = ClockTracker()
        self.assertEqual(tracker.decide(parse_clock('24'), 1000)[0], 'run')
        # Host previously anchored near the far edge of a one-second display bucket.
        mode, _ = tracker.decide(parse_clock('23'), 1450, current={'seconds':23.8,'running':True},
                                 phase_ms=420, phase_ready=True, uncertainty_ms=60)
        self.assertEqual(mode, 'run')
        self.assertAlmostEqual(tracker.current(1450)['seconds'], 22.58)
        self.assertIsNone(tracker.decide(parse_clock('23'), 1630, phase_ms=610,
                                        phase_ready=True, uncertainty_ms=60)[0])

    def test_two_clocks_have_independent_motion_and_phase(self):
        shot, game = ClockTracker(), ClockTracker()
        shot.decide(parse_clock('24'), 1000)
        game.decide(parse_clock('7:00'), 1000)
        shot.decide(parse_clock('4.9'), 1500)
        self.assertEqual(shot.current(4000), {'seconds':4.9, 'running':False})
        self.assertEqual(game.current(4000), {'seconds':417, 'running':True})
