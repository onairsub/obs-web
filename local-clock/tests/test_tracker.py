import unittest

from clock_reader import ClockTracker, ReadingGate, parse_clock


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.tracker = ClockTracker()

    def see(self, value, t, **kwargs):
        kwargs.setdefault("compensation_seconds", 1)
        return self.tracker.decide(parse_clock(value), t, **kwargs)[0]

    def test_integer_runs_through_occlusion_with_compensation_once(self):
        self.assertEqual(self.see('24', 1000), 'run')
        self.assertEqual(self.tracker.current(1000)['seconds'], 23)
        self.assertEqual(self.tracker.current(4000)['seconds'], 20)
        self.assertTrue(self.tracker.current(4000)['running'])
        self.assertIsNone(self.see('21', 4000))
        self.assertEqual(self.tracker.current(4000)['seconds'], 20)
        self.assertIsNone(self.see('20', 5000))
        self.assertEqual(self.tracker.current(5000)['seconds'], 19)

    def test_small_error_is_ignored_but_two_seconds_lower_corrects(self):
        self.see('24', 1000)
        self.assertIsNone(self.see('22', 2000))  # predicted physical display 23
        self.assertEqual(self.see('20', 2180), 'run')
        self.assertEqual(self.tracker.current(2180)['seconds'], 19)
        self.assertIsNone(self.see('20', 2360))
        self.assertAlmostEqual(self.tracker.current(2360)['seconds'], 18.82)

    def test_same_value_over_one_second_stops_and_restores_uncompensated_value(self):
        self.see('20', 1000)
        for t in [1180, 1360, 1540, 1720, 1900, 2080]:
            self.assertIsNone(self.see('20', t))
        self.assertEqual(self.see('20', 2260), 'hold')
        self.assertEqual(self.tracker.current(5000), {'seconds': 20, 'running': False})
        self.assertIsNone(self.see('20', 2440))
        self.assertEqual(self.see('19', 2620), 'run')
        self.assertEqual(self.tracker.current(2620)['seconds'], 18)

    def test_no_visibility_does_not_count_as_stationary_evidence(self):
        self.see('20', 1000)
        self.assertEqual(self.see('20', 4000), 'run')
        self.assertEqual(self.tracker.current(4000)['seconds'], 19)
        self.assertTrue(self.tracker.current(4000)['running'])

    def test_hidden_reset_recovers_even_below_the_last_seen_value(self):
        # Last seen 20, hidden for 12s, reset to 14, and reappears at 13/12.
        # It is below 20 but above the prediction, so lower-only correction fails.
        gate = ReadingGate()
        for value, t in [('20', 1000), ('20', 1180), ('20', 1360)]:
            if gate.accept(parse_clock(value), t, t+20, tracking=True)[0]:
                self.see(value, t)
        self.assertAlmostEqual(self.tracker.current(13000)['seconds'], 7.36)
        for value, t in [('', 3000), ('', 11000), ('13', 13000), ('13', 13180), ('12', 13360)]:
            self.assertFalse(gate.accept(parse_clock(value), t, t+20, tracking=True)[0])
        self.assertTrue(gate.accept(parse_clock('12'), 13540, 13560, tracking=True)[0])
        self.assertEqual(self.see('12', 13540), 'run')
        self.assertEqual(self.tracker.current(13540)['seconds'], 11)
        self.assertIsNone(self.see('12', 13720))

    def test_confirmed_upward_recovery_restarts_a_stopped_shot_clock(self):
        self.see('8', 1000)
        self.assertEqual(self.see('13', 3000, current={'seconds':8, 'running':False}), 'run')
        self.assertEqual(self.tracker.current(3000), {'seconds':12, 'running':True})

    def test_decimals_never_run_or_apply_one_second_compensation(self):
        self.see('5', 1000)
        self.assertEqual(self.see('4.9', 1500), 'hold')
        self.assertEqual(self.tracker.current(5000), {'seconds': 4.9, 'running': False})
        self.assertEqual(self.see('4.3', 2040), 'hold')
        self.assertEqual(self.tracker.current(6000)['seconds'], 4.3)
        self.assertEqual(self.see('24', 2580), 'run')
        self.assertEqual(self.tracker.current(2580)['seconds'], 23)

    def test_reset_applies_compensation_and_zero_never_goes_negative(self):
        self.see('8', 1000)
        self.assertEqual(self.see('14', 2000), 'run')
        self.assertEqual(self.tracker.current(2000)['seconds'], 13)
        self.tracker.reset()
        self.see('0', 1000)
        self.assertEqual(self.tracker.current(2000)['seconds'], 0)
        self.tracker.reset()
        self.see('24', 1000, compensation_seconds=0)
        self.assertEqual(self.tracker.current(1000)['seconds'], 24)

    def test_authoritative_host_value_controls_correction(self):
        self.see('24', 1000)
        # A changed host timer, rather than an outdated local prediction, is used.
        self.assertEqual(self.see('20', 2000, current={'seconds': 23, 'running': True}), 'run')
        self.assertEqual(self.tracker.current(2000)['seconds'], 19)

    def test_large_correction_still_needs_four_votes_and_ignores_occlusion(self):
        gate = ReadingGate()
        for t in [1000, 1180, 1360]:
            accepted, _ = gate.accept(parse_clock('24'), t, t+20, tracking=True)
        self.assertTrue(accepted)
        for t in [1540, 1720, 1900]:
            self.assertFalse(gate.accept(parse_clock('18'), t, t+20, tracking=True)[0])
        self.assertTrue(gate.accept(parse_clock('18'), 2080, 2100, tracking=True)[0])
        self.assertFalse(gate.accept(None, 2260, 2280, tracking=True)[0])
        self.assertEqual(gate.confirmed.text, '18')

    def test_game_clock_uses_timer_first_then_stops_and_resumes_from_confirmed_values(self):
        def see(value, t):
            return self.see(value, t, shot_clock=False, compensation_seconds=0)
        self.assertEqual(see('7:00', 1000), 'run')
        self.assertEqual(self.tracker.current(4000), {'seconds':417, 'running':True})
        self.assertIsNone(see('6:57', 4000))
        for t in [4180, 4360, 4540, 4720, 4900, 5080]:
            self.assertIsNone(see('6:57', t))
        self.assertEqual(see('6:57', 5260), 'hold')
        self.assertEqual(self.tracker.current(8000), {'seconds':417, 'running':False})
        self.assertEqual(see('6:56', 5440), 'run')
        self.assertEqual(self.tracker.current(7440), {'seconds':414, 'running':True})
        self.assertEqual(see('50.1', 9000), 'hold')
        self.assertEqual(self.tracker.current(12000), {'seconds':50.1, 'running':False})
