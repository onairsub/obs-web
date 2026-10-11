"""Outbound-only client for obs-web's existing /api/remote-ws protocol."""
import asyncio
import json
import re
import time
import uuid
from urllib.parse import urlparse, urlunparse

from websockets.asyncio.client import connect

from clock_reader import Reading


def now_ms():
    return time.monotonic() * 1000


def session_address(link: str, origin: str = "") -> tuple[str, str]:
    link = link.strip()
    if re.fullmatch(r"[a-f0-9]{32}", link):
        session = link
        parsed = urlparse(origin.strip())
    else:
        parsed = urlparse(link)
        match = re.fullmatch(r"/obs/remote/([a-f0-9]{32})(?:/[a-z]+)?/?", parsed.path)
        if not match:
            raise ValueError("원격 공유 링크 또는 32자리 세션 ID를 입력하세요.")
        session = match[1]
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("세션 ID만 입력할 때는 http(s) 웹 중계 주소도 필요합니다.")
    return urlunparse(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, "/api/remote-ws", "", "", "")), session


class Relay:
    def __init__(self):
        self.task = None
        self.socket = None
        self.snapshot = None
        self.offset = None
        self.last_seen = 0
        self.best_rtt = float("inf")
        self.sampled_at = 0
        self.probes = {}
        self.status = "연결 전"
        self.sent = 0
        self.rtt_ms = None
        self.generation = 0

    def ready(self):
        return self.socket is not None and self.offset is not None and now_ms() - self.last_seen < 5000

    def tracking_supported(self):
        return bool(self.snapshot and self.snapshot.get("trackingVersion") == 2)

    async def stop(self):
        self.generation += 1
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        self.task = self.socket = self.snapshot = self.offset = None
        self.probes.clear()
        self.status = "연결 전"

    async def start(self, link, origin):
        address, session = session_address(link, origin)
        await self.stop()
        self.status = "중계 서버 연결 중"
        self.task = asyncio.create_task(self._run(address, session))

    async def _send(self, message):
        if self.socket:
            await self.socket.send(json.dumps(message))

    def accept(self, message):
        snapshot = message.get("snapshot", {})
        received = now_ms()
        sent = self.probes.pop(message.get("replyTo"), None)
        measured = sent is not None and 0 <= received - sent < 1000
        new_host = not self.snapshot or snapshot.get("epoch") != self.snapshot.get("epoch")
        if new_host and not measured:
            return
        if not new_host and snapshot.get("revision", -1) < self.snapshot.get("revision", 0):
            return
        if message.get("replyTo") and not measured:
            return
        if snapshot.get("observationVersion") != 1:
            self.status = "웹 호스트를 새 버전으로 배포한 뒤 새로고침하세요 (카메라 연동 미지원)."
            self.offset = None
            return
        if not isinstance(snapshot.get("hostNow"), (int, float)) or not isinstance(snapshot.get("clocks"), dict):
            return
        if new_host:
            self.generation += 1
            self.probes.clear()
            self.offset = None
            self.best_rtt = float("inf")
        if measured:
            rtt = received - sent
            self.rtt_ms = round(rtt)
            if rtt <= self.best_rtt or received - self.sampled_at > 60000:
                self.offset = snapshot["hostNow"] - (received + sent) / 2
                self.best_rtt = rtt
                self.sampled_at = received
        if self.offset is None:
            return
        self.snapshot = snapshot
        self.last_seen = received
        self.status = "웹 호스트 연결됨"

    async def _heartbeat(self):
        while True:
            request_id = str(uuid.uuid4())
            self.probes = {k: v for k, v in self.probes.items() if now_ms() - v < 3000}
            self.probes[request_id] = now_ms()
            await self._send({"type": "clock-sync", "requestId": request_id})
            await self._send({"type": "ping"})
            if not self.ready():
                self.status = "웹 호스트 응답 대기 — 호스트 화면을 열어두세요"
            await asyncio.sleep(1)

    async def _run(self, address, session):
        delay = 0.5
        client_id = str(uuid.uuid4())
        while True:
            heartbeat = None
            try:
                async with connect(address, open_timeout=8, close_timeout=1, ping_interval=20,
                                   max_size=262144, proxy=None) as socket:
                    self.socket = socket
                    await self._send({"type": "join", "sessionId": session, "clientId": client_id,
                                      "role": "remote", "protocolVersion": 3})
                    async for raw in socket:
                        message = json.loads(raw)
                        kind = message.get("type")
                        if kind == "ready":
                            delay = 0.5
                            heartbeat = asyncio.create_task(self._heartbeat())
                        elif kind == "clock-state":
                            self.accept(message)
                        elif kind in ("closed", "error"):
                            self.status = message.get("message", "원격 세션이 종료되었습니다. 새 링크를 연결하세요.")
                            return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Avoid exposing session links in errors/logs.
                self.status = f"연결 재시도 중 ({type(error).__name__})"
            finally:
                self.generation += 1
                self.socket = self.snapshot = self.offset = None
                self.probes.clear()
                if heartbeat:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5)

    async def observe(self, reading: Reading, captured_ms: float, key: str, mode: str, offset_ms: float = 0):
        if not self.ready():
            return False
        # Decimal displays always follow confirmed camera values. Never start or
        # extrapolate tenths between frames, even if integer preserve was selected.
        if reading.resolution_ms == 100:
            mode = "hold"
        if mode == "run" and not self.tracking_supported():
            return False
        try:
            await self._send({"type": "clock-command", "command": {
                "id": str(uuid.uuid4()), "epoch": self.snapshot["epoch"],
                "issuedAt": now_ms() + self.offset, "key": key,
                "operation": {"action": "observe", "seconds": reading.seconds,
                              "resolutionMs": reading.resolution_ms, "capturedAt": captured_ms + self.offset,
                              "format": "minutes" if ":" in reading.text else "seconds",
                              "mode": mode, **({"offsetMs": offset_ms} if mode == "run" else {})}}})
            self.sent += 1
            return True
        except Exception:
            return False

    def current(self, key):
        if not self.ready():
            return None
        clock = self.snapshot["clocks"].get(key)
        if not clock:
            return None
        elapsed = max(0, now_ms() + self.offset - clock["startedAt"]) if clock["running"] else 0
        return {"seconds": max(0, clock["baseMs"] - elapsed) / 1000, "running": clock["running"]}
