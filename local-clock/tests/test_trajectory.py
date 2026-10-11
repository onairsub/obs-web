import unittest

from clock_reader import ClockTracker, ReadingGate, parse_clock
from trajectory import ClockTrajectory


class TrajectoryTests(unittest.TestCase):
    def setUp(self):
        self.model = ClockTrajectory()

    def see(self, value, t):
        return self.model.observe(parse_clock(value), t)

    def test_running_line_fits_offset_and_quantization(self):
        self.assertIsNone(self.see('8:9', 1000))
        self.assertIsNone(self.see('8.7', 1180))
        fit = self.see('8:5', 1360)
        self.assertEqual(fit.rate, 1)
        self.assertAlmostEqual(fit.seconds, 8.47)
        self.assertEqual(fit.inliers, 3)
        self.assertLessEqual(fit.uncertainty_ms, 100)

    def test_stationary_jitter_is_held_only_after_sufficient_span(self):
        for value, t in [('8.1', 1000), ('8.1', 1180), ('8.2', 1360), ('8.1', 1540)]:
            self.assertIsNone(self.see(value, t))
        fit = self.see('8.1', 1720)
        self.assertEqual(fit.rate, 0)
        self.assertEqual(fit.seconds, 8.1)

    def test_isolated_outlier_does_not_move_the_fitted_line(self):
        for value, t in [('8.9',1000), ('8.7',1180), ('8.5',1360)]:
            self.see(value,t)
        self.assertIsNone(self.see('7.1',1540))
        fit = self.see('8.2',1720)
        self.assertEqual(fit.rate,1)
        self.assertEqual((fit.inliers,fit.points),(4,5))
        self.assertAlmostEqual(fit.seconds,8.15,delta=.05)

    def test_stop_and_resume_replace_the_old_line(self):
        for value, t in [('8.9',1000), ('8.7',1180), ('8.5',1360), ('8.3',1540),
                         ('8.3',1720), ('8.3',1900), ('8.3',2080), ('8.3',2260), ('8.3',2440)]:
            fit = self.see(value,t)
        self.assertEqual(fit.rate,0)
        self.assertEqual(fit.seconds,8.3)
        for value,t in [('8.1',2620),('7.9',2800),('7.7',2980)]:
            fit = self.see(value,t)
        self.assertEqual(fit.rate,1)
        self.assertAlmostEqual(fit.seconds,7.65,delta=.06)

    def test_long_occlusion_requires_new_points_not_an_inferred_pause(self):
        for value,t in [('8.9',1000),('8.7',1180),('8.5',1360)]:
            self.see(value,t)
        self.assertIsNone(self.see('8.5',4000))
        self.assertIsNone(self.see('8.5',4180))
        self.assertIsNone(self.see('8.5',4360))
        self.assertIsNone(self.see('8.5',4540))
        self.assertEqual(self.see('8.5',4720).rate,0)

    def test_two_times_speed_and_random_values_never_form_a_supported_line(self):
        for i in range(15):
            self.assertIsNone(self.see(f'{20-i*.4:.1f}',1000+i*180))


class DecimalTrackingTests(unittest.TestCase):
    def setUp(self):
        self.gate = ReadingGate()
        self.tracker = ClockTracker()

    def see(self, value, t, **kwargs):
        reading = parse_clock(value)
        accepted, reason = self.gate.accept(reading,t,t+20,shot_clock=False,tracking=True)
        if not accepted:
            return None, reason
        return self.tracker.decide(reading,t,shot_clock=False,decimal_fit=self.gate.decimal_fit,**kwargs)

    def test_fitted_timer_runs_through_occlusion_and_holds_on_stop_evidence(self):
        for value,t in [('8.9',1000),('8.7',1180),('8.5',1360)]:
            mode,_ = self.see(value,t,compensation_seconds=.3)
        self.assertEqual(mode,'run')
        self.assertAlmostEqual(self.tracker.current(2000)['seconds'],7.53)
        anchor = self.tracker.anchor
        self.see('',2200)
        self.see('39.1',2380)
        self.assertEqual(self.tracker.anchor,anchor)
        for i in range(5):
            mode,_ = self.see('8.1',2600+i*180,compensation_seconds=.3)
        self.assertEqual(mode,'hold')
        self.assertEqual(self.tracker.current(9000),{'seconds':8.1,'running':False})

    def test_change_bound_uses_trusted_values_not_previous_outliers(self):
        for value,t in [('8.9',1000),('8.7',1180),('8.5',1360)]:
            self.see(value,t)
        for value,t in [('3.0',1540),('3.2',1720),('18.0',1900)]:
            mode,reason = self.see(value,t)
            self.assertIsNone(mode)
            self.assertIn('경과 시간 + 2초',reason)
        self.assertEqual(self.gate.confirmed.seconds,8.5)
        # After four elapsed seconds, a six-second difference is still the cap.
        self.assertIn('경과 시간 + 2초',self.see('1.9',5360)[1])
        self.assertEqual(self.gate.confirmed.seconds,8.5)

    def test_frame_age_and_compensation_apply_once_and_offsets_stay_wire_valid(self):
        for value,t in [('8.9',1000),('8.7',1180)]:
            self.see(value,t)
        mode,_ = self.see('8.5',1360,current={'seconds':10,'running':True},age_ms=80,compensation_seconds=.3)
        self.assertEqual(mode,'run')
        self.assertGreaterEqual(self.tracker.sync_offset_ms,300)
        wire_at_capture=self.tracker.sync_seconds-self.tracker.sync_offset_ms/1000
        self.assertAlmostEqual(wire_at_capture,self.tracker.current(1360)['seconds'])
        self.assertAlmostEqual(wire_at_capture-.08,self.tracker.current(1440)['seconds'])

    def test_gate_restarts_trajectory_after_manual_or_integer_reset(self):
        for value,t in [('8.9',1000),('8.7',1180),('8.5',1360)]:
            self.see(value,t)
        self.gate.set_baseline(parse_clock('3:00'),2000,shot_clock=False)
        self.assertIsNone(self.gate.trajectory.last_fit)
        self.assertIn('경과 시간 + 2초',self.see('8.1',2180)[1])
