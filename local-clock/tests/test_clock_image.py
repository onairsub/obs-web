import unittest
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

from clock_image import connected_components, find_separators, tight_clock_crop
from segments import read_segments


class ComponentTests(unittest.TestCase):
    def test_diagonal_pixels_and_punctuation_keep_their_geometry(self):
        mask = np.zeros((17, 21), np.uint8)
        mask[0, 0] = mask[1, 1] = 255  # Eight-way connectivity at the border.
        mask[3:5, 9:11] = 255
        mask[10:12, 9:11] = 255  # Separate colon dots.
        mask[16, 20] = 255
        for image in [mask, mask[:, ::-1]]:  # Include a noncontiguous ROI view.
            count, labels, stats, centers = connected_components(image)
            self.assertEqual(count, 5)
            np.testing.assert_array_equal(labels > 0, image > 0)
            self.assertEqual(sorted(stats[1:, cv2.CC_STAT_AREA]), [1, 2, 4, 4])
            for label in range(1, count):
                rows, columns = np.nonzero(labels == label)
                self.assertEqual(stats[label].tolist(), [
                    columns.min(), rows.min(), columns.max() - columns.min() + 1,
                    rows.max() - rows.min() + 1, len(rows),
                ])
                np.testing.assert_allclose(centers[label], [columns.mean(), rows.mean()])

    def test_thin_blank_and_solid_masks(self):
        for shape in [(1, 1), (1, 97), (97, 1), (31, 33), (480, 960)]:
            for lit in [False, True]:
                with self.subTest(shape=shape, lit=lit):
                    mask = np.full(shape, 255 if lit else 0, np.uint8)
                    count, labels, stats, _ = connected_components(mask)
                    self.assertEqual(count, 2 if lit else 1)
                    self.assertTrue(np.all(labels == int(lit)))
                    self.assertEqual(stats[int(lit), cv2.CC_STAT_AREA], mask.size)

    def test_preprocessing_survives_noisy_and_occluded_frames_in_worker(self):
        # Exercise the same worker-thread preprocessing used by the server.
        # Real camera masks vary far more than clean synthetic clock digits.
        def process():
            rng = np.random.default_rng(114905)
            for index in range(500):
                height, width = [int(n) for n in rng.integers(12, 481, size=2)]
                density = [0, .01, .2, .5, .9, 1][index % 6]
                mask = (rng.random((height, width)) < density).astype(np.uint8) * 255
                image = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
                cropped = tight_clock_crop(image)
                self.assertGreater(min(cropped.shape[:2]), 0)
                find_separators(cropped)
                # Narrow partial glyphs and punctuation go through a third
                # connected-component call in the LED fallback.
                read_segments(cropped)

        with ThreadPoolExecutor(max_workers=1) as worker:
            worker.submit(process).result(timeout=30)
