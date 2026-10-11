"""Optional phone/IP camera adapter. Keep only the newest decoded frame."""
import threading
from urllib.parse import urlparse

import cv2

from relay import now_ms


class StreamCamera:
    def __init__(self, url):
        if urlparse(url).scheme not in ("http", "https", "rtsp"):
            raise ValueError("직접 영상 스트림의 http(s) 또는 rtsp 주소를 입력하세요.")
        self.url = url
        self.closed = threading.Event()
        self.lock = threading.Lock()
        self.latest = None
        self.status = "스트림 연결 중"
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        while not self.closed.is_set():
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG, [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 3000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 1500])
            try:
                if not cap.isOpened():
                    self.status = "스트림 연결 실패 — 직접 MJPEG/RTSP 주소를 확인하세요"
                else:
                    self.status = "스트림 수신 중"
                    while not self.closed.is_set():
                        ok, frame = cap.read()
                        if not ok:
                            self.status = "스트림 끊김 — 재연결 중"
                            break
                        with self.lock:
                            self.latest = (frame, now_ms())
            finally:
                cap.release()
            self.closed.wait(1)

    def frame(self):
        with self.lock:
            if self.latest and now_ms() - self.latest[1] < 700:
                return self.latest
        return None

    def close(self):
        self.closed.set()
