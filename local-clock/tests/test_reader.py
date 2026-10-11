import unittest

from clock_reader import ReadingGate, parse_clock
from relay import session_address


class ParsingTests(unittest.TestCase):
    def test_supported_displays(self):
        for text, seconds, resolution in [("7:00", 420, 1000), ("3:43", 223, 1000),
                                          ("50.1", 50.1, 100), ("24", 24, 1000),
                                          ("0.0", 0, 100), ("00:04.9", 4.9, 100),
                                          ("３：４３", 223, 1000)]:
            reading = parse_clock(text)
            self.assertEqual((reading.seconds, reading.resolution_ms), (seconds, resolution))

    def test_ambiguous_and_invalid_reads_never_become_numbers(self):
        for value in ["", "7:60", "7:0", "50 1", "5O.1", "-4", "4.92", "1:2:3", "24 14", "score 24", "NaN", "50,1"]:
            self.assertIsNone(parse_clock(value), value)
        self.assertIsNone(parse_clock("700", maximum=60))
        self.assertIsNone(parse_clock("24", confidence=float('nan')))

    def test_sessions_require_an_explicit_server_and_valid_shared_link(self):
        session = "a" * 32
        self.assertEqual(session_address(f"https://example.com/obs/remote/{session}/basketball"),
                         ("wss://example.com/api/remote-ws", session))
        self.assertEqual(session_address(session, "http://localhost:3000"),
                         ("ws://localhost:3000/api/remote-ws", session))
        for link in [session, "file:///etc/passwd", "https://example.com/wrong", "https://name:secret@example.com/obs/remote/" + session]:
            with self.assertRaises(ValueError):
                session_address(link)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.gate = ReadingGate()

    def push(self, text, t, confidence=1, shot_clock=True):
        return self.gate.accept(parse_clock(text, confidence), t, t + 20,
                                shot_clock=shot_clock)[0]

    def confirm(self, text, t=1000, count=3, shot_clock=True):
        for i in range(count - 1):
            self.assertFalse(self.push(text, t + i * 180, shot_clock=shot_clock))
        self.assertTrue(self.push(text, t + (count - 1) * 180, shot_clock=shot_clock))
        self.assertEqual(self.gate.confirmed.text, text)

    def test_initial_value_and_integer_decrement_need_three_votes(self):
        self.confirm("20")
        self.confirm("19", 1540)
        self.assertTrue(self.push("19", 2080))
        self.assertEqual(self.gate.confirmed.seconds, 19)

    def test_one_or_two_wrong_frames_do_not_move_confirmed_display(self):
        self.confirm("20")
        self.assertFalse(self.push("19", 1540))
        self.assertFalse(self.push("19", 1720))
        self.assertTrue(self.push("20", 1900))
        self.assertFalse(self.push("24", 2080))
        self.assertFalse(self.push("24", 2260))
        self.assertEqual(self.gate.confirmed.text, "20")

    def test_shot_reset_can_reappear_below_14_or_24_with_four_votes(self):
        self.confirm("8")
        self.confirm("13", 1540, count=4)
        self.confirm("18", 2500, count=4)
        self.confirm("24", 3400, count=4)
        self.confirm("14", 4300, count=4)

    def test_reset_evidence_can_cross_a_second_boundary(self):
        self.confirm("8")
        self.push("", 1540)
        for value, t in [("13", 2500), ("13", 2680), ("12", 2860)]:
            self.assertFalse(self.push(value, t))
        self.assertTrue(self.push("12", 3040))
        self.assertEqual(self.gate.confirmed.seconds, 12)

    def test_relaxed_reset_still_rejects_outliers_conflicts_and_values_above_24(self):
        self.confirm("8")
        for value, t in [("13", 1540), ("13", 1720), ("8", 1900),
                         ("13", 2080), ("21", 2260), ("13", 2440),
                         ("21", 2620), ("13", 2800), ("13", 2980)]:
            accepted = self.push(value, t)
            if value != "8":
                self.assertFalse(accepted)
            self.assertEqual(self.gate.confirmed.seconds, 8)
        for i in range(6):
            self.assertFalse(self.push("28", 3200 + i * 180))
        self.assertEqual(self.gate.confirmed.seconds, 8)

    def test_game_clock_does_not_inherit_relaxed_shot_reset(self):
        self.confirm("8", shot_clock=False)
        for i in range(6):
            self.assertFalse(self.push("13", 2500 + i * 180, shot_clock=False))
        self.assertEqual(self.gate.confirmed.seconds, 8)

    def test_blank_low_confidence_and_outliers_hold_value_without_replay(self):
        self.confirm("20")
        for value, t, confidence in [("", 1540, 1), ("19", 1720, .5), ("2", 1900, 1), ("", 2080, 1)]:
            self.assertFalse(self.push(value, t, confidence))
            self.assertEqual(self.gate.confirmed.text, "20")
        self.confirm("20", 2440, count=4)

    def test_recovery_after_occlusion_requires_time_and_four_consistent_frames(self):
        self.confirm("20")
        self.push("", 1540)
        self.push("", 2500)
        self.confirm("17", 3500, count=4)
        self.assertEqual(self.gate.confirmed.seconds, 17)
        # A truncated leading digit is not a plausible elapsed countdown.
        for i in range(6):
            self.assertFalse(self.push("7", 4220 + i * 180))
        self.assertEqual(self.gate.confirmed.seconds, 17)

    def test_decimal_trajectory_not_exact_value_majority_and_no_prediction(self):
        self.assertFalse(self.push("4.9", 1000))
        self.assertFalse(self.push("4.7", 1180))
        self.assertTrue(self.push("4.5", 1360))
        self.assertEqual(self.gate.confirmed.text, "4.5")
        self.assertFalse(self.push("", 1540))
        self.assertFalse(self.push("9.9", 1720))
        self.assertEqual(self.gate.confirmed.text, "4.5")
        self.assertFalse(self.push("4.0", 1900))
        self.assertFalse(self.push("3.8", 2080))
        self.assertTrue(self.push("3.6", 2260))
        self.assertEqual(self.gate.confirmed.text, "3.6")

    def test_impossibly_fast_decimal_path_never_accumulates_support(self):
        for text, t in [("4.9", 1000), ("4.5", 1180), ("4.1", 1360), ("3.7", 1540)]:
            self.assertFalse(self.push(text, t))
        self.assertIsNone(self.gate.confirmed)

    def test_intermittent_occlusion_keeps_evidence_but_conflicting_votes_do_not_win(self):
        for text, t in [("20", 1000), ("", 1180), ("20", 1360), ("", 1540)]:
            self.assertFalse(self.push(text, t))
        self.assertTrue(self.push("20", 1720))
        self.gate.reset()
        for text, t in [("20", 2000), ("28", 2180), ("20", 2360), ("28", 2540), ("20", 2720)]:
            self.assertFalse(self.push(text, t))
        self.assertIsNone(self.gate.confirmed)

    def test_stale_duplicate_out_of_order_and_expired_votes(self):
        reading = parse_clock("24")
        self.assertFalse(self.gate.accept(reading, 1000, 2000)[0])
        self.assertFalse(self.gate.accept(reading, 3000, 2000)[0])
        self.assertFalse(self.push("24", 3000))
        self.assertFalse(self.push("24", 3000))
        self.assertFalse(self.push("24", 2990))
        self.assertFalse(self.push("24", 3180))
        self.assertFalse(self.push("24", 5000))
        self.assertIsNone(self.gate.confirmed)

    def test_game_clock_has_no_shot_reset_exception_and_can_cross_minute(self):
        self.confirm("1:00", shot_clock=False)
        self.assertFalse(self.push("59.9", 1540, shot_clock=False))
        self.assertFalse(self.push("59.7", 1720, shot_clock=False))
        self.assertTrue(self.push("59.5", 1900, shot_clock=False))
        for i in range(5):
            self.assertFalse(self.push("24", 2080 + i * 180, shot_clock=False))
        self.assertEqual(self.gate.confirmed.text, "59.5")

    def test_explicit_reset_still_requires_votes_for_new_baseline(self):
        self.confirm("8")
        self.gate.reset()
        self.confirm("50.1", 2000)


if __name__ == "__main__":
    unittest.main()
