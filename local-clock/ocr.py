"""CPU OCR with explicit diagnostics and image-backed clock punctuation."""
from dataclasses import dataclass
import re

import cv2
import numpy as np
import onnxruntime
from rapidocr import RapidOCR

from clock_reader import Reading, parse_clock
from clock_image import find_separators, split_clock_image, tight_clock_crop
from segments import read_segments


@dataclass(frozen=True)
class Recognition:
    reading: Reading | None = None
    raw_text: str = ""
    reason: str = "숫자 또는 구분자를 읽지 못했습니다. 숫자 영역과 초점을 확인하세요."
    method: str = ""


def resolve_readings(neural, geometric):
    """Geometry may fix punctuation, but never overrides conflicting digits."""
    if not geometric:
        return neural, False
    if not neural or neural.confidence < .85:
        return geometric, False
    if re.sub(r"\D", "", neural.text) != re.sub(r"\D", "", geometric.text):
        return None, True
    if neural.text != geometric.text:
        # Missing punctuation is not evidence for removing a visible separator.
        return (geometric if any(c in geometric.text for c in ":.") else neural), False
    return max([neural, geometric], key=lambda reading: reading.confidence), False


class ClockOCR:
    def __init__(self):
        onnxruntime.disable_telemetry_events()
        self.engine = RapidOCR(params={
            "Global.use_det": False, "Global.use_cls": False,
            "Global.log_level": "warning",
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        })

    def _recognize_line(self, image, preprocessing):
        image = tight_clock_crop(image)
        if preprocessing != "color":
            gray = np.max(image, axis=2)
            if preprocessing == "threshold":
                _, gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            border = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
            if np.median(border) < 127:
                gray = 255 - gray
            image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        height, width = image.shape[:2]
        scale = min(96 / height, 960 / width)
        image = cv2.resize(image, (max(12, round(width * scale)), max(12, round(height * scale))))
        result = self.engine(image, use_det=False, use_cls=False, use_rec=True)
        if result.txts and len(result.txts) == 1:
            return str(result.txts[0]), float(result.scores[0])
        return "", 0.0

    def _read_parts(self, image, separators, preprocessing):
        readings = []
        for chunk in split_clock_image(image, separators):
            if min(chunk.shape[:2]) < 3:
                return None
            text, confidence = self._recognize_line(chunk, preprocessing)
            reading = parse_clock(text, confidence) if re.fullmatch(r"[0-9]{1,5}", text) else None
            segmented = read_segments(chunk)
            if segmented and not re.fullmatch(r"[0-9]{1,5}", segmented.text):
                segmented = None
            reading, conflict = resolve_readings(reading, segmented)
            if conflict or not reading or reading.confidence < .85:
                return None
            readings.append(reading)
        text = readings[0].text
        for separator, reading in zip(separators, readings[1:]):
            text += separator.text + reading.text
        return parse_clock(text, min(reading.confidence for reading in readings))

    def read_detailed(self, image, preprocessing="auto", reader="auto"):
        if image is None or min(image.shape[:2]) < 12:
            return Recognition(reason="숫자 영역이 너무 작습니다.")
        if float(np.std(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))) < 5:
            return Recognition(reason="선택 영역에 숫자가 보이지 않습니다.")
        image = tight_clock_crop(image)
        segmented = read_segments(image) if reader != "ocr" else None
        if reader == "segments":
            return Recognition(segmented, segmented.text if segmented else "", method="7세그먼트")
        raw, confidence = self._recognize_line(image, preprocessing)
        neural = parse_clock(raw, confidence)
        separators = find_separators(image)
        # Full-line OCR may drop a tiny dot yet confidently read the digits.
        separated = self._read_parts(image, separators, preprocessing) if separators else None
        geometry, conflict = resolve_readings(separated, segmented) if segmented and separated else (separated or segmented, False)
        reading, digits_conflict = resolve_readings(neural, geometry)
        candidates = " / ".join(dict.fromkeys(text for text in [raw, separated.text if separated else "", segmented.text if segmented else ""] if text))
        if conflict or digits_conflict:
            return Recognition(raw_text=candidates, reason="인식기별 숫자가 달라 보정 보류 — 영역·초점을 확인하세요.")
        if separators and reading and ''.join(re.findall(r"[:.]", reading.text)) != ''.join(part.text for part in separators):
            return Recognition(raw_text=candidates, reason="콜론·소수점은 보이지만 숫자 조합을 확정하지 못해 보정 보류")
        if not reading:
            return Recognition(raw_text=candidates)
        return Recognition(reading, candidates, "", "구분자 분리 인식" if separated else "OCR / 7세그먼트")

    def read(self, image, maximum=86400, preprocessing="auto", reader="auto"):
        # The UI uses read_detailed and applies its synchronization limit only
        # after showing the recognized number. Retain this standalone API.
        reading = self.read_detailed(image, preprocessing, reader).reading
        return reading if reading and reading.seconds <= maximum else None
