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

    def push(self, text, t, confidence=1):
        return self.gate.accept(parse_clock(text, confidence), t, t + 20)[0]

    def test_countdown_tenths_and_reset_confirmation(self):
        self.assertFalse(self.push("4.9", 1000))
        self.assertTrue(self.push("4.7", 1200))
        self.assertTrue(self.push("4.5", 1400))
        self.assertFalse(self.push("24", 1600))
        self.assertTrue(self.push("24", 1800))
        self.assertFalse(self.push("14", 2000))
        self.assertTrue(self.push("14", 2200))

    def test_occlusion_and_low_confidence_break_confirmation(self):
        self.push("24", 1000)
        self.assertFalse(self.push("", 1200))
        self.assertFalse(self.push("24", 1400))
        self.assertFalse(self.push("24", 1600, .5))
        self.assertFalse(self.push("24", 1800))
        self.assertTrue(self.push("24", 2000))

    def test_stale_duplicate_and_long_gap_frames(self):
        reading = parse_clock("24")
        self.assertFalse(self.gate.accept(reading, 1000, 2000)[0])
        self.assertFalse(self.gate.accept(reading, 3000, 2000)[0])
        self.assertFalse(self.push("24", 3000))
        self.assertFalse(self.push("24", 3000))
        self.assertFalse(self.push("24", 5000))


if __name__ == "__main__":
    unittest.main()
