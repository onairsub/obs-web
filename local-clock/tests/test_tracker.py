import unittest

from clock_reader import ClockTracker, ReadingGate, parse_clock
from trajectory import ClockTrajectory


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.tracker = ClockTracker()

    def see(self, value, t, **kwargs):
        kwargs.setdefault("compensation_seconds", 1)
        return self.tracker.decide(parse_clock(value), t, **kwargs)[0]

    def stationary(self, value, t, **kwargs):
        model = ClockTrajectory()
        for i in range(5):
            fit = model.observe(parse_clock(value),t+i*180)
        return self.see(value,t+720,decimal_fit=fit,**kwargs)

    def test_integer_runs_through_occlusion_with_compensation_once(self):
        self.assertEqual(self.see('23', 1000), 'run')
        self.assertEqual(self.tracker.current(1000)['seconds'], 22)
        self.assertEqual(self.tracker.current(4000)['seconds'], 19)
        self.assertTrue(self.tracker.current(4000)['running'])
        self.assertIsNone(self.see('20', 4000))
        self.assertEqual(self.tracker.current(4000)['seconds'], 19)
        self.assertIsNone(self.see('19', 5000))
        self.assertEqual(self.tracker.current(5000)['seconds'], 18)

    def test_small_error_is_ignored_but_two_seconds_lower_corrects(self):
        self.see('23', 1000)
        self.assertIsNone(self.see('21', 2000))  # predicted physical display 22
        self.assertEqual(self.see('19', 2180), 'run')
        self.assertEqual(self.tracker.current(2180)['seconds'], 18)
        self.assertIsNone(self.see('19', 2360))
        self.assertAlmostEqual(self.tracker.current(2360)['seconds'], 17.82)

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

    def test_last_five_shot_seconds_ignore_integer_decimal_and_stationary_reads(self):
        self.assertEqual(self.see('6', 1000, compensation_seconds=0), 'run')
        anchor = self.tracker.anchor
        for value, t in [('5', 2000), ('4.9', 2100), ('4.9', 2500),
                         ('4.9', 2900), ('4.9', 3400), ('2', 4000), ('0', 7100)]:
            self.assertIsNone(self.see(value, t, compensation_seconds=0,
                                       phase_ready=True, phase_ms=500))
            self.assertEqual(self.tracker.anchor, anchor)
        self.assertEqual(self.tracker.current(5000), {'seconds': 2, 'running': True})
        self.assertEqual(self.tracker.current(8000), {'seconds': 0, 'running': True})

    def test_low_camera_value_cannot_correct_a_higher_timer_or_start_a_stopped_one(self):
        for value in ['5', '5.0', '4.2', '0']:
            for clock in [None, {'seconds': 10, 'running': True}, {'seconds': 4, 'running': False}]:
                with self.subTest(value=value, clock=clock):
                    self.assertIsNone(self.see(value, 1000, current=clock))
                    self.assertIsNone(self.tracker.current(1000))

    def test_delayed_higher_read_cannot_rewind_timer_after_it_reaches_five(self):
        self.see('6', 1000, compensation_seconds=0)
        for t in [2000, 2300, 2600, 2900, 3300, 7000]:
            self.assertIsNone(self.see('6', t, compensation_seconds=0,
                                       phase_ready=True, phase_ms=300))
        self.assertEqual(self.tracker.current(4000), {'seconds': 3, 'running': True})
        self.assertIsNone(self.see('5.8', 7100))

    def test_low_timer_accepts_confirmed_presets_and_hidden_reset_recovery(self):
        for preset in ['14', '24']:
            self.tracker.reset()
            self.see('6', 1000, compensation_seconds=0)
            self.assertEqual(self.see(preset, 4000), 'hold')
            self.assertEqual(self.tracker.current(8000), {'seconds': float(preset), 'running': False})
            self.assertEqual(self.see(str(int(preset) - 1), 5000), 'run')
        self.tracker.reset()
        self.see('20', 1000, compensation_seconds=0)
        self.assertIsNone(self.see('13', 18000))
        self.assertEqual(self.see('13', 18180, recovery_confirmed=True), 'run')
        self.assertEqual(self.tracker.current(18180), {'seconds': 12, 'running': True})

    def test_game_stationary_decimal_fit_holds_without_compensation(self):
        self.see('1:00', 1000, shot_clock=False)
        self.assertIsNone(self.see('59.9', 1500, shot_clock=False))
        self.assertEqual(self.stationary('59.9', 1680, shot_clock=False), 'hold')
        self.assertEqual(self.tracker.current(5000), {'seconds': 59.9, 'running': False})
        self.assertEqual(self.stationary('4.3', 6000, shot_clock=False), 'hold')
        self.assertEqual(self.tracker.current(9000)['seconds'], 4.3)

    def test_reset_holds_without_compensation_and_zero_never_goes_negative(self):
        self.see('8', 1000)
        self.assertEqual(self.see('14', 2000), 'hold')
        self.assertEqual(self.tracker.current(5000), {'seconds':14, 'running':False})
        self.tracker.reset()
        self.assertIsNone(self.see('0', 1000))
        self.assertIsNone(self.tracker.current(2000))
        self.tracker.reset()
        self.see('24', 1000, compensation_seconds=0)
        self.assertEqual(self.tracker.current(1000)['seconds'], 24)

    def test_authoritative_host_value_controls_correction(self):
        self.see('24', 1000)
        # A changed host timer, rather than an outdated local prediction, is used.
        self.assertEqual(self.see('20', 2000, current={'seconds': 23, 'running': True}), 'run')
        self.assertEqual(self.tracker.current(2000)['seconds'], 19)

    def test_both_presets_hold_until_a_decrement_and_normal_14_passage_keeps_running(self):
        for preset in (14, 24):
            self.tracker.reset()
            self.assertEqual(self.see(str(preset), 1000), 'hold')
            self.assertEqual(self.tracker.current(4000), {'seconds':preset, 'running':False})
            self.assertIsNone(self.see(str(preset), 4000))
            self.assertEqual(self.see(str(preset-1), 5000), 'run')
            self.assertEqual(self.tracker.current(5000), {'seconds':preset-2, 'running':True})
            self.assertEqual(self.see(str(preset), 6000), 'hold')
            self.assertEqual(self.tracker.current(9000), {'seconds':preset, 'running':False})
        self.tracker.reset()
        self.see('15', 1000)
        self.assertIsNone(self.see('14', 2000))
        self.assertTrue(self.tracker.current(2000)['running'])
        self.tracker.reset()
        self.assertEqual(self.see('14', 1000, shot_clock=False), 'run', 'game clock has no shot preset pause')

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
        self.assertEqual(self.stationary('50.1', 9000, shot_clock=False), 'hold')
        self.assertEqual(self.tracker.current(12000), {'seconds':50.1, 'running':False})

    def test_game_pause_evidence_restores_higher_value_without_running_offsets(self):
        gate = ReadingGate()
        actions = []
        for value, t in [('6:40', 1000), ('6:40', 1180), ('6:40', 1360),
                         ('6:43', 1540), ('', 1720), ('6:43', 1900),
                         ('6:43', 2260), ('6:43', 2800)]:
            reading = parse_clock(value)
            if gate.accept(reading, t, t+20, shot_clock=False)[0]:
                actions.append(self.tracker.decide(reading, t, shot_clock=False,
                    compensation_seconds=1, phase_ms=500, game_pause_confirmed=gate.game_pause_confirmed)[0])
        self.assertEqual(actions, ['run', 'hold'])
        self.assertEqual(self.tracker.current(6000), {'seconds':403, 'running':False})
        self.assertEqual(self.see('6:42', 3500, shot_clock=False), 'run')

    def test_low_time_toggles_are_independent_and_preserve_timer_when_off(self):
        self.see('6', 1000, compensation_seconds=0)
        self.assertEqual(self.stationary('3:9', 2000, shot_low_sync=True), 'hold')
        self.assertEqual(self.tracker.current(9000), {'seconds':3.9, 'running':False})
        self.tracker.reset()
        self.see('1:00', 1000, shot_clock=False, compensation_seconds=0)
        anchor = self.tracker.anchor
        for value, t in [('59', 2000), ('59.7', 2500), ('1:00', 3000), ('3:9', 9000)]:
            self.assertIsNone(self.see(value, t, shot_clock=False, game_low_sync=False))
            self.assertEqual(self.tracker.anchor, anchor)
        self.assertTrue(self.tracker.current(10000)['running'])
        self.assertEqual(self.stationary('3:9', 11000, shot_clock=False, game_low_sync=True), 'hold')
        self.assertEqual(self.tracker.current(12000), {'seconds':3.9, 'running':False})

    def test_manual_baseline_does_not_restart_a_stopped_timer_on_next_read(self):
        self.tracker.set_baseline(parse_clock('01:43'), 1000, running=False)
        self.assertIsNone(self.see('01:43', 1180, shot_clock=False))
        self.assertEqual(self.tracker.current(2000), {'seconds':103, 'running':False})
