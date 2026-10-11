"""Conservative geometric fallback for front-facing seven-segment LED clocks."""
import cv2
import numpy as np

from clock_reader import parse_clock

PATTERNS = {"1110111": "0", "0010010": "1", "1011101": "2", "1011011": "3",
            "0111010": "4", "1101011": "5", "1101111": "6", "1010010": "7",
            "1111111": "8", "1111011": "9"}
# top, upper-left, upper-right, middle, lower-left, lower-right, bottom
ZONES = [(0.3, 0, .7, .12), (0, .18, .22, .38), (.78, .18, 1, .38),
         (.3, .43, .7, .57), (0, .62, .22, .82), (.78, .62, 1, .82), (.3, .88, .7, 1)]


def read_segments(image, maximum=86400):
    gray = np.max(image, axis=2)
    if np.std(gray) < 8:
        return None
    border = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
    if np.median(border) > 127:
        gray = 255 - gray
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    points = cv2.findNonZero(mask)
    if points is None:
        return None
    _, top, _, height = cv2.boundingRect(points)
    if height < 20:
        return None
    # Group lit columns into characters, bridging small gaps between segments.
    columns = (mask.any(axis=0).astype(np.uint8) * 255)[None, :]
    columns = cv2.morphologyEx(columns, cv2.MORPH_CLOSE, np.ones((1, max(3, round(height * .035))), np.uint8))[0]
    edges = np.diff(np.pad(columns > 0, (1, 1)).astype(np.int8))
    groups = list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))
    if not 1 <= len(groups) <= 8:
        return None
    result, confidences = [], []
    for left, right in groups:
        part = mask[:, left:right]
        nonzero = cv2.findNonZero(part)
        x, y, w, h = cv2.boundingRect(nonzero)
        glyph = part[y:y+h, x:x+w] / 255
        if h < height * .65:
            n, _, stats, centers = cv2.connectedComponentsWithStats((glyph * 255).astype(np.uint8))
            components = [(s, c) for s, c in zip(stats[1:], centers[1:]) if s[4] >= 3]
            if len(components) == 1 and y > top + height * .72 and h < height * .2:
                result.append(".")
            elif len(components) == 2 and h > height * .2 and abs(components[0][1][0] - components[1][1][0]) < height * .1:
                result.append(":")
            else:
                return None
            confidences.append(.96)
            continue
        if w / h < .22 and h > height * .72:
            # A one is two aligned vertical segments; reject sparsely lit noise.
            if np.mean(glyph) < .55:
                return None
            result.append("1"); confidences.append(.96)
            continue
        if not .25 <= w / h <= .85:
            return None
        levels = []
        for index, (x0, y0, x1, y1) in enumerate(ZONES):
            zone = glyph[round(y0*h):max(round(y0*h)+1, round(y1*h)), round(x0*w):max(round(x0*w)+1, round(x1*w))]
            level = float(zone.mean())
            # A printed 5's curved bottom can fill the lower-left zone on
            # average and masquerade as a 6. Lit LED verticals must extend
            # along both halves, not only curl into one end of the zone.
            if index in (1, 2, 4, 5) and level >= .38:
                halves = [float(part.mean()) for part in np.array_split(zone, 2, axis=0)]
                if min(halves) < max(.38, max(halves) * .65):
                    return None
            levels.append(level)
        if any(.12 < level < .38 for level in levels):
            return None
        signature = ''.join('1' if level >= .38 else '0' for level in levels)
        if signature not in PATTERNS:
            return None
        result.append(PATTERNS[signature])
        confidences.append(min(.99, .88 + .12 * min(min(level/.65, 1) if level >= .38 else 1-level for level in levels)))
    return parse_clock(''.join(result), min(confidences), maximum)
