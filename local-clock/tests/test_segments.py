import unittest

from benchmark import segment_sample
from segments import read_segments


class SegmentTests(unittest.TestCase):
    def test_digits_colon_and_decimal_are_preserved(self):
        for text in ["0123456789", "24", "14", "7:00", "3:43", "50.1", "4.9", "0.0", "1", "8"]:
            if len(text) > 8:
                for digit in text:
                    self.assertEqual(read_segments(segment_sample(digit)).text, digit)
            else:
                self.assertEqual(read_segments(segment_sample(text)).text, text)

    def test_blurred_small_led_and_blank_input(self):
        import cv2
        import numpy as np
        for text in ["24", "7:00", "50.1"]:
            sample = segment_sample(text)
            image = cv2.resize(sample, None, fx=.6, fy=.6)
            image = cv2.GaussianBlur(image, (3, 3), .6)
            self.assertEqual(read_segments(image).text, text)
        self.assertIsNone(read_segments(np.zeros((100, 100, 3), np.uint8)))
