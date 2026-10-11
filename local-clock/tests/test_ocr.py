import unittest
from unittest.mock import patch

import cv2

from benchmark import sample, segment_sample
from clock_image import find_separators, tight_clock_crop
from clock_reader import parse_clock
from ocr import ClockOCR, resolve_readings
from segments import read_segments


class PunctuationTests(unittest.TestCase):
    def test_visible_separators_in_print_and_led_fonts(self):
        for render in [sample, segment_sample]:
            for text, separators in [("7:00", ":"), ("3:43", ":"), ("50.1", "."), ("4.9", "."), ("24", ""), ("14", "")]:
                with self.subTest(font=render.__name__, text=text):
                    image = tight_clock_crop(render(text))
                    self.assertEqual(''.join(part.text for part in find_separators(image)), separators)

    def test_punctuation_correction_requires_matching_digits(self):
        value, conflict = resolve_readings(parse_clock("501", .99), parse_clock("50.1", .97))
        self.assertFalse(conflict)
        self.assertEqual(value.text, "50.1")
        value, conflict = resolve_readings(parse_clock("700", .99), parse_clock("7:00", .97))
        self.assertFalse(conflict)
        self.assertEqual(value.text, "7:00")
        self.assertTrue(resolve_readings(parse_clock("501", .99), parse_clock("50.7", .97))[1])
        # A segment reader that misses a dot cannot delete the OCR's dot.
        self.assertEqual(resolve_readings(parse_clock("50.1", .99), parse_clock("501", .97))[0].text, "50.1")


class ActualModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = ClockOCR()

    def test_wide_roi_keeps_time_and_tenths(self):
        # Regression: padding 180/400 made 50.1 disappear, or lowered 4.9 below
        # the confidence gate because the entire ROI was shrunk to 96px high.
        for text in ["7:00", "3:43", "50.1", "4.9"]:
            for padding in [0, 180, 400]:
                with self.subTest(text=text, padding=padding):
                    image = cv2.copyMakeBorder(sample(text), padding, padding, 20, 20, cv2.BORDER_CONSTANT)
                    result = self.engine.read_detailed(image)
                    self.assertIsNotNone(result.reading, result)
                    self.assertEqual(result.reading.text, text)
                    self.assertGreaterEqual(result.reading.confidence, .85)

    def test_printed_five_is_not_vetoed_by_a_false_led_six(self):
        for scale in [1, .6]:
            image = cv2.resize(sample('5'), None, fx=scale, fy=scale)
            image = cv2.imdecode(cv2.imencode('.jpg', image)[1], cv2.IMREAD_COLOR)
            result = self.engine.read_detailed(image)
            self.assertIsNotNone(result.reading, result)
            self.assertEqual(result.reading.text, '5')
            geometric = read_segments(tight_clock_crop(image))
            self.assertTrue(geometric is None or geometric.text == '5')

    def test_led_vertical_shape_check_preserves_digits_and_clock_boundaries(self):
        for text in ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '1:00', '59.9', '4.9']:
            for scale in [1, .6]:
                with self.subTest(text=text, scale=scale):
                    image = cv2.resize(segment_sample(text), None, fx=scale, fy=scale)
                    image = cv2.GaussianBlur(image, (3, 3), .6)
                    image = cv2.imdecode(cv2.imencode('.jpg', image)[1], cv2.IMREAD_COLOR)
                    result = read_segments(tight_clock_crop(image))
                    self.assertIsNotNone(result)
                    self.assertEqual(result.text, text)

    def test_missing_full_line_punctuation_recovered_from_pixels(self):
        original = self.engine._recognize_line
        for text, wrong in [("50.1", "501"), ("7:00", "700")]:
            calls = 0

            def drop_first_punctuation(image, preprocessing):
                nonlocal calls
                calls += 1
                return (wrong, .99) if calls == 1 else original(image, preprocessing)

            with patch.object(self.engine, '_recognize_line', side_effect=drop_first_punctuation):
                result = self.engine.read_detailed(sample(text), reader="ocr")
                self.assertEqual(result.reading.text, text)
                self.assertIn(wrong, result.raw_text)
                self.assertIn("구분자", result.method)

    def test_small_blurred_jpeg_punctuation_and_light_background(self):
        for text in ["7:00", "3:43", "50.1", "4.9"]:
            for render in [sample, segment_sample]:
                with self.subTest(text=text, font=render.__name__):
                    image = cv2.resize(render(text), None, fx=.6, fy=.6)
                    image = cv2.GaussianBlur(image, (3, 3), .6)
                    image = cv2.imdecode(cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 75])[1], cv2.IMREAD_COLOR)
                    result = self.engine.read_detailed(image)
                    self.assertIsNotNone(result.reading, result)
                    self.assertEqual(result.reading.text, text)
            gray = cv2.cvtColor(sample(text), cv2.COLOR_BGR2GRAY)
            light = cv2.cvtColor(255-gray, cv2.COLOR_GRAY2BGR)
            self.assertEqual(self.engine.read_detailed(light).reading.text, text)

    def test_invalid_ocr_text_is_available_for_diagnosis(self):
        with patch.object(self.engine, '_recognize_line', return_value=("5O.1", .95)):
            result = self.engine.read_detailed(sample("50.1"), reader="ocr")
            self.assertIsNone(result.reading)
            self.assertIn("5O.1", result.raw_text)
            self.assertTrue(result.reason)

    def test_visible_dot_with_unreadable_fraction_never_becomes_integer(self):
        with patch.object(self.engine, '_recognize_line', return_value=("501", .99)), \
             patch.object(self.engine, '_read_parts', return_value=None):
            result = self.engine.read_detailed(sample("50.1"), reader="ocr")
            self.assertIsNone(result.reading)
            self.assertEqual(result.raw_text, "501")
            self.assertIn("소수점", result.reason)
