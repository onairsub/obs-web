"""Reproducible synthetic accuracy/latency check, not a real-camera benchmark."""
import argparse
import json
import time

import cv2
import numpy as np

from ocr import ClockOCR


def sample(text):
    image = np.zeros((140, 430, 3), np.uint8)
    cv2.putText(image, text, (18, 104), cv2.FONT_HERSHEY_SIMPLEX, 2.8, (30, 80, 255), 5, cv2.LINE_AA)
    return image


def segment_sample(text):
    patterns = {"0": [0,1,2,4,5,6], "1": [2,5], "2": [0,2,3,4,6], "3": [0,2,3,5,6],
                "4": [1,2,3,5], "5": [0,1,3,5,6], "6": [0,1,3,4,5,6], "7": [0,2,5],
                "8": list(range(7)), "9": [0,1,2,3,5,6]}
    rectangles = [(12,3,46,11), (3,14,11,56), (48,14,56,56), (12,59,46,67),
                  (3,70,11,112), (48,70,56,112), (12,115,46,123)]
    image = np.zeros((146, 82 * len(text) + 20, 3), np.uint8)
    x = 10
    for character in text:
        if character == ":":
            for y in [44, 86]:
                cv2.circle(image, (x+10, y), 6, (30,80,255), -1)
            x += 32
        elif character == ".":
            cv2.circle(image, (x+8,129), 5, (30,80,255), -1)
            x += 26
        else:
            for n in patterns[character]:
                left, top, right, bottom = rectangles[n]
                cv2.rectangle(image, (x+left, top+10), (x+right, bottom+10), (30,80,255), -1)
            x += 78
    return image[:, :x+8]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", help="실제 촬영한 숫자 영역 이미지도 검사할 수 있습니다.")
    parser.add_argument("--jpeg", help="통합 테스트용 합성 JPEG를 stdout에 기록합니다.")
    parser.add_argument("--segments", action="store_true", help="7세그먼트 LED 형태도 검사합니다.")
    args = parser.parse_args()
    if args.jpeg is not None:
        import sys
        sys.stdout.buffer.write(cv2.imencode(".jpg", sample(args.jpeg))[1].tobytes())
        raise SystemExit
    engine = ClockOCR()
    cases = [(args.image, cv2.imread(args.image))] if args.image else [(s, sample(s)) for s in ["24", "14", "7:00", "3:43", "50.1", "4.9", "0.0", "0", ""]]
    if args.segments:
        cases += [(s, segment_sample(s)) for s in ["24", "14", "7:00", "3:43", "50.1", "4.9", "0.0", "1", "8"]]
    passed = True
    for expected, image in cases:
        start = time.perf_counter()
        reading = engine.read(image)
        elapsed = (time.perf_counter() - start) * 1000
        actual = reading.text if reading else ""
        passed &= args.image is not None or actual == expected
        print(json.dumps({"input": expected, "read": actual, "confidence": reading.confidence if reading else None,
                          "inference_ms": round(elapsed, 1)}, ensure_ascii=False))
    raise SystemExit(0 if passed else 1)
