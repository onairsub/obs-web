import math
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
        for value, t in [('8.1', 1000), ('8.1', 1180), ('8.2', 1360)]:
            self.assertIsNone(self.see(value, t))
        fit = self.see('8.1', 1540)
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
        self.assertEqual(self.see('8.5',4360).rate,0)

    def test_two_times_speed_and_random_values_never_form_a_supported_line(self):
        for i in range(15):
            self.assertIsNone(self.see(f'{20-i*.4:.1f}',1000+i*180))

    def test_brief_pause_and_resume_replace_the_previous_state_promptly(self):
        for value,t in [('50.9',1000),('50.7',1180),('50.5',1360),('50.3',1540)]:
            self.see(value,t)
        self.see('50.3',1720)
        fit = self.see('50.3',1900)
        self.assertEqual(fit.rate,0,'a 360ms decimal plateau must pause')
        self.assertEqual(fit.seconds,50.3)
        self.see('50.1',2080)
        fit = self.see('49.9',2260)
        self.assertEqual(fit.rate,1,'two time-consistent decreases must resume a confirmed stop')
        self.assertTrue(all(t >= 2080 for _,t in self.model.points),'discard the previous state after a transition')

    def test_first_tenth_decrement_does_not_keep_refreshing_stop_evidence(self):
        for t in [1000,1180,1360,1540]:
            self.see('8.3',t)
        self.see('8.2',1720)
        fit = self.see('8.0',1900)
        self.assertEqual(fit.rate,1)

    def test_one_wrong_read_and_small_jitter_cannot_restart_a_stopped_clock(self):
        for t in [1000,1180,1360]:
            self.see('50.3',t)
        for value,t in [('50.1',1540),('50.3',1720),('50.2',1900),('50.3',2080),
                        ('48.9',2260),('48.7',2440),('50.3',2620)]:
            fit = self.see(value,t)
            self.assertTrue(fit is None or fit.rate == 0,(value,t,fit))

    def test_fast_stop_tolerates_one_outlier_without_using_old_moving_votes(self):
        for value,t in [('50.9',1000),('50.7',1180),('50.5',1360),
                        ('50.3',1540),('50.3',1720),('48.8',1900)]:
            self.see(value,t)
        fit = self.see('50.3',2080)
        self.assertEqual(fit.rate,0)
        self.assertEqual((fit.inliers,fit.points),(3,4))

    def test_sparse_valid_frames_can_still_establish_a_stop_and_resume(self):
        # At ~2 valid reads/sec, requiring four points in a 1.5s window can
        # never succeed, even when every visible frame says the same time.
        self.assertIsNone(self.see('48.6',1000))
        self.assertIsNone(self.see('48.6',1520))
        self.assertEqual(self.see('48.6',2040).rate,0)
        self.assertEqual(self.see('48.6',2560).rate,0)
        for value,t in [('48.1',3080),('47.6',3600),('47.1',4120)]:
            fit = self.see(value,t)
        self.assertEqual(fit.rate,1)

    def test_short_repeated_reads_cannot_prove_a_stop_within_one_display_bucket(self):
        for t in [1000,1040,1080,1120,1160,1200]:
            self.assertIsNone(self.see('48.6',t))

    def test_repeated_short_stops_and_resumes_across_capture_phases(self):
        for offset in [0,40,90,140]:
            with self.subTest(offset=offset):
                model = ClockTrajectory()
                changes = []
                rate = None
                for t in range(offset,7200,180):
                    elapsed = (min(t,1400) + max(0,min(t,3000)-2120)
                               + max(0,min(t,4600)-3720) + max(0,t-5320))
                    value = math.ceil((59-elapsed/1000)*10-1e-8)/10
                    fit = model.observe(parse_clock(f'{value:.1f}'),t)
                    if fit and fit.rate != rate:
                        changes.append((t,fit.rate))
                        rate = fit.rate
                self.assertEqual([rate for _,rate in changes],[1,0,1,0,1,0,1])
                for (t,_),trigger in zip(changes[1:],[1400,2120,3000,3720,4600,5320]):
                    self.assertGreaterEqual(t,trigger)
                    self.assertLessEqual(t-trigger,540,'state changes must not wait for the old window to expire')


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
        for i in range(3):
            mode,_ = self.see('8.1',2600+i*180,compensation_seconds=.3)
        self.assertEqual(mode,'hold')
        self.assertEqual(self.tracker.current(9000),{'seconds':8.1,'running':False})

    def test_pause_and_resume_bypass_position_correction_throttle_and_then_keep_ticking(self):
        for value,t in [('50.9',1000),('50.7',1180),('50.5',1360),
                        ('50.5',1540),('50.5',1720)]:
            mode,_ = self.see(value,t)
        self.assertEqual(mode,'hold')
        self.assertEqual(self.tracker.current(5000),{'seconds':50.5,'running':False})
        self.see('50.3',1900)
        mode,_ = self.see('50.1',2080)
        self.assertEqual(mode,'run')
        self.assertAlmostEqual(self.tracker.current(2580)['seconds'],49.55,delta=.03)
        anchor = self.tracker.anchor
        self.see('',2760)
        self.see('30.1',2940)
        self.assertEqual(self.tracker.anchor,anchor)
        self.assertTrue(self.tracker.current(4000)['running'])

    def test_stop_overwrites_prediction_with_confirmed_value_not_fit_median(self):
        for shot_clock in (False, True):
            with self.subTest(shot_clock=shot_clock):
                gate, tracker = ReadingGate(), ClockTracker()
                # Both tenths support a stationary line, whose median differs
                # from the newest accepted value shown in the confirmed field.
                for i, value in enumerate(['4.0', '4.1', '4.0', '4.1']):
                    t = 1000 + i * 200
                    reading = parse_clock(value)
                    accepted, _ = gate.accept(reading, t, t+30, shot_clock=shot_clock, tracking=True)
                self.assertTrue(accepted)
                self.assertEqual(gate.decimal_fit.rate, 0)
                self.assertNotEqual(gate.decimal_fit.seconds, gate.confirmed.seconds)
                mode, _ = tracker.decide(gate.confirmed, t, shot_clock=shot_clock,
                    decimal_fit=gate.decimal_fit, shot_low_sync=True,
                    current={'seconds': 2.7, 'running': True},
                    compensation_seconds=1, phase_ms=500, age_ms=300)
                self.assertEqual(mode, 'hold')
                self.assertEqual(tracker.sync_seconds, gate.confirmed.seconds)
                self.assertEqual(tracker.sync_offset_ms, 0)
                self.assertEqual(tracker.current(t+5000), {'seconds': 4.1, 'running': False})

    def test_stop_corrects_even_a_small_paused_error_and_reanchors_local_preview(self):
        for value, t in [('8.9', 1000), ('8.7', 1180), ('8.5', 1360)]:
            self.see(value, t, compensation_seconds=.3)
        self.assertGreater(self.tracker.sync_offset_ms, 0)
        for i in range(3):
            mode, _ = self.see('8.1', 1600+i*180, current={'seconds': 8.09, 'running': False})
        self.assertEqual(mode, 'hold', 'a 10ms error must not prevent an exact confirmed hold')
        self.assertEqual(self.tracker.sync_seconds, 8.1)
        self.assertEqual(self.tracker.sync_offset_ms, 0)
        # Even when the host is already correct, local prediction must stop too.
        self.tracker.anchor = (8.1, 1960, True)
        mode, _ = self.see('8.1', 2140, current={'seconds': 8.1, 'running': False})
        self.assertIsNone(mode, 'an already exact stopped host needs no duplicate write')
        self.assertEqual(self.tracker.current(5000), {'seconds': 8.1, 'running': False})

    def test_missing_frames_between_sparse_valid_stop_evidence_do_not_erase_it(self):
        for value,t in [('49.4',1000),('49.2',1180),('49.0',1360)]:
            self.see(value,t)
        for value,t in [('49.0',1540),('',1720),('',1900),('49.0',2080)]:
            mode,_ = self.see(value,t)
        self.assertEqual(mode,'hold')
        self.assertEqual(self.tracker.current(5000),{'seconds':49.0,'running':False})

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


class TemporalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.gate = ReadingGate()
        self.tracker = ClockTracker()

    def see(self, value, t, confidence=.8, threshold=.85, tracking=True):
        reading = parse_clock(value,confidence)
        accepted,reason = self.gate.accept(reading,t,t+20,confidence=threshold,
                                         shot_clock=False,tracking=tracking)
        if accepted:
            self.tracker.decide(reading,t,shot_clock=False,decimal_fit=self.gate.decimal_fit)
        return accepted,reason

    def test_every_decimal_value_can_change_without_resetting_evidence(self):
        # No value repeats over a complete final-minute countdown.
        for i in range(333):
            value = math.ceil((59.9-i*.18)*10-1e-8)/10
            accepted,_ = self.see(f'{value:.1f}',1000+i*180)
            self.assertEqual(accepted,i>=4,(i,value))
            if accepted:
                self.assertEqual(self.gate.decimal_fit.rate,1)
                self.assertTrue(self.gate.decimal_fit.temporal_evidence)
                self.assertTrue(self.tracker.current(1000+i*180)['running'])
        evidence = self.gate.trajectory.diagnostics()
        self.assertGreater(evidence['running']['support'],evidence['stopped']['support'])
        self.assertEqual(evidence['running']['inliers'],9)

    def test_mixed_confidence_no_longer_discards_all_but_isolated_frames(self):
        for i in range(15):
            accepted,_ = self.see(f'{50-i*.2:.1f}',1000+i*200,
                                  confidence=.94 if i%5 == 0 else .8)
            self.assertEqual(accepted,i>=4)
        self.assertEqual(self.gate.decimal_fit.rate,1)

    def test_pooled_running_evidence_still_detects_stop_resume_and_keeps_ticking(self):
        for i in range(6):
            self.see(f'{50-i*.2:.1f}',1000+i*200)
        self.assertTrue(self.tracker.current(2100)['running'])
        for i in range(1,5):
            self.see('49.0',2000+i*200)
        self.assertEqual(self.tracker.current(5000),{'seconds':49.0,'running':False})
        for i in range(1,6):
            self.see(f'{49-i*.2:.1f}',2800+i*200)
        at = self.tracker.current(3800)
        self.assertTrue(at['running'])
        self.assertAlmostEqual(self.tracker.current(4800)['seconds'],at['seconds']-1)

    def test_low_quality_and_inconsistent_sequences_cannot_gain_temporal_trust(self):
        for confidence,values in [(.64,[f'{50-i*.2:.1f}' for i in range(15)]),
                                  (.8,[f'{50-i*.4:.1f}' for i in range(15)]),
                                  (.8,['50.0','48.1','49.7','47.2','50.8']*3)]:
            self.setUp()
            for i,value in enumerate(values):
                self.assertFalse(self.see(value,1000+i*180,confidence=confidence)[0],(value,confidence))
            self.assertIsNone(self.tracker.anchor)

    def test_one_bad_point_after_pooled_confirmation_is_never_sent_as_a_new_value(self):
        for i in range(6):
            self.see(f'{50-i*.2:.1f}',1000+i*200)
        anchor = self.tracker.anchor
        self.assertFalse(self.see('47.6',2200)[0])
        self.assertEqual(self.tracker.anchor,anchor)
        self.assertEqual(self.gate.confirmed.seconds,49.0)

    def test_manual_mode_integer_readings_and_user_threshold_retain_their_contract(self):
        for i in range(8):
            self.assertFalse(self.see('49.0',1000+i*180,tracking=False)[0])
        self.setUp()
        for i in range(8):
            self.assertFalse(self.see('49',1000+i*180)[0])
        self.setUp()
        for i in range(3):
            accepted,_ = self.see(f'{49-i*.2:.1f}',1000+i*180,confidence=.6,threshold=.5)
        self.assertTrue(accepted,'an explicitly lowered threshold must not be silently raised')

    def test_diagnostics_show_pending_hypotheses_before_any_value_is_confirmed(self):
        self.see('59.9',1000)
        self.see('59.7',1180)
        self.assertIsNone(self.gate.confirmed)
        evidence = self.gate.trajectory.diagnostics()
        self.assertEqual(evidence['running']['inliers'],2)
        self.assertFalse(evidence['running']['qualified'])
        self.assertEqual(evidence['running']['strong_inliers'],0)
        self.assertEqual(evidence['captured_ms'],1180)
