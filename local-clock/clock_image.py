"""Find clock punctuation from visible pixels, never from a guessed numeric value."""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Separator:
    text: str
    left: int
    right: int


def foreground_mask(image):
    gray = np.max(image, axis=2)
    border = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
    if np.median(border) > 127:
        gray = 255 - gray
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return mask


def tight_clock_crop(image):
    """Remove flat ROI margins before resizing so small dots retain their pixels."""
    mask = foreground_mask(image)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    useful = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >= 3]
    if not useful or len(useful) > 80 or np.mean(mask > 0) > .6:
        return image
    boxes = stats[useful]
    left, top = boxes[:, 0].min(), boxes[:, 1].min()
    right = (boxes[:, 0] + boxes[:, 2]).max()
    bottom = (boxes[:, 1] + boxes[:, 3]).max()
    if bottom - top < 12 or right - left < 4:
        return image
    pad = max(4, round((bottom - top) * .08))
    # Keep original colors and punctuation; thresholding only locates the crop.
    return image[max(0, top-pad):min(image.shape[0], bottom+pad),
                 max(0, left-pad):min(image.shape[1], right+pad)]


def find_separators(image):
    mask = foreground_mask(image)
    count, _, stats, centers = cv2.connectedComponentsWithStats(mask)
    components = [(i, stats[i], centers[i]) for i in range(1, count) if stats[i, 4] >= 3]
    if not components or len(components) > 80:
        return []
    top = min(s[1] for _, s, _ in components)
    bottom = max(s[1] + s[3] for _, s, _ in components)
    height = bottom - top
    if height < 18:
        return []
    dots = [(i, s, c) for i, s, c in components if s[2] <= height*.26 and s[3] <= height*.26
            and .4 <= s[2]/s[3] <= 2.5 and s[4]/(s[2]*s[3]) >= .35]

    def between_digits(left, right, excluded):
        # A punctuation column must be separate from the digits. This also
        # prevents disconnected seven-segment strokes from becoming a colon.
        others = [s for i, s, _ in components if i not in excluded]
        if any(s[0] < right and s[0]+s[2] > left for s in others):
            return False
        return (any(s[0]+s[2] <= left and s[3] >= height*.24 for s in others)
                and any(s[0] >= right and s[3] >= height*.24 for s in others))

    separators, used = [], set()
    for i, first, a in dots:
        for j, second, b in dots:
            if i >= j or i in used or j in used:
                continue
            upper, lower = sorted([a[1], b[1]])
            left, right = min(first[0], second[0]), max(first[0]+first[2], second[0]+second[2])
            if (abs(a[0]-b[0]) <= max(first[2], second[2])*.55
                and .16*height <= lower-upper <= .65*height
                and top+.08*height <= upper <= top+.55*height
                and top+.4*height <= lower <= top+.87*height
                and min(first[4], second[4])/max(first[4], second[4]) >= .3
                and between_digits(left, right, {i, j})):
                separators.append(Separator(":", int(left), int(right)))
                used.update([i, j])
    for i, s, center in dots:
        if i not in used and center[1] >= top+.78*height and between_digits(s[0], s[0]+s[2], {i}):
            separators.append(Separator(".", int(s[0]), int(s[0]+s[2])))
    separators.sort(key=lambda part: part.left)
    punctuation = ''.join(part.text for part in separators)
    return separators if punctuation in (":", ".", ":.") else []


def split_clock_image(image, separators):
    chunks, left = [], 0
    for separator in separators:
        chunks.append(image[:, left:separator.left])
        left = separator.right
    chunks.append(image[:, left:])
    return chunks
