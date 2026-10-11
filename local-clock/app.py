import argparse
import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict
import io
import math
from pathlib import Path
import secrets
from typing import Literal

import cv2
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
import numpy as np
from PIL import Image
from pydantic import BaseModel, Field
import uvicorn

from clock_reader import ClockTracker, ReadingGate
from ocr import ClockOCR
from relay import Relay, now_ms
from stream import StreamCamera
from timing import ClockPhase

ROOT = Path(__file__).resolve().parent
TOKEN = secrets.token_urlsafe(32)
relay = Relay()
ClockKey = Literal["OBS_BASKETBALL_SHOT_CLOCK", "OBS_BASKETBALL_GAME_CLOCK"]
CLOCK_KEYS = ("OBS_BASKETBALL_SHOT_CLOCK", "OBS_BASKETBALL_GAME_CLOCK")
gates = {key: ReadingGate() for key in CLOCK_KEYS}
trackers = {key: ClockTracker() for key in CLOCK_KEYS}
phases = {key: ClockPhase() for key in CLOCK_KEYS}


def reset_channels(keys=None):
    for key in keys or CLOCK_KEYS:
        gates[key].reset()
        trackers[key].reset()
        phases[key].reset()
ocr = None
model_status = "로컬 OCR 모델 준비 중"
camera = None
generation = 0
gate_relay_generation = -1
frame_lock = asyncio.Lock()


class Settings(BaseModel):
    enabled: bool = False
    key: ClockKey = "OBS_BASKETBALL_SHOT_CLOCK"
    keys: list[ClockKey] | None = Field(default=None, min_length=1, max_length=2)
    shot_maximum: float = Field(default=60, ge=1, le=86400)
    game_maximum: float = Field(default=1200, ge=1, le=86400)
    mode: Literal["auto", "preserve", "hold"] = "auto"
    compensation_seconds: float = Field(default=0, ge=0, le=3)
    minimum_confidence: float = Field(default=0.85, ge=0.5, le=1)
    maximum: float = Field(default=60, ge=1, le=86400)
    preprocessing: Literal["auto", "color", "threshold"] = "auto"
    reader: Literal["auto", "ocr", "segments"] = "auto"


settings = Settings()


async def warm_model():
    global ocr, model_status
    try:
        ocr = await asyncio.to_thread(ClockOCR)
        model_status = "로컬 OCR 준비됨"
    except Exception as error:
        model_status = f"모델 준비 실패 ({type(error).__name__}) — 터미널에서 설치/모델 경로를 확인하세요"
        print(f"OCR initialization failed: {error}", flush=True)


@asynccontextmanager
async def lifespan(_app):
    warmup = asyncio.create_task(warm_model())
    yield
    warmup.cancel()
    await relay.stop()
    if camera:
        camera.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def local_only(request: Request, call_next):
    if request.url.hostname not in ("127.0.0.1", "localhost", "::1"):
        return JSONResponse({"detail": "localhost에서 실행하세요."}, status_code=403)
    if request.url.path.startswith("/api/") and not secrets.compare_digest(request.headers.get("x-local-token", ""), TOKEN):
        return JSONResponse({"detail": "로컬 페이지를 새로고침하세요."}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/"):
        return JSONResponse({"detail": "다른 사이트에서 로컬 프로그램에 접근할 수 없습니다."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/", response_class=HTMLResponse)
async def index():
    return (ROOT / "index.html").read_text().replace("__LOCAL_TOKEN__", TOKEN)


@app.get("/app.js")
async def javascript():
    return Response((ROOT / "app.js").read_text(), media_type="text/javascript")


@app.get("/style.css")
async def stylesheet():
    return Response((ROOT / "style.css").read_text(), media_type="text/css")


@app.get("/api/status")
async def status():
    return {"now_ms": now_ms(), "model": model_status, "model_ready": ocr is not None,
            "relay": relay.status, "connected": relay.ready(), "rtt_ms": relay.rtt_ms,
            "current": relay.current(settings.key), "sent": relay.sent,
            "clocks": {key: {"current": relay.current(key), "preview": trackers[key].current(now_ms()),
                              "confirmed": asdict(gates[key].confirmed) if gates[key].confirmed else None,
                              "timing": phases[key].status(now_ms())} for key in CLOCK_KEYS},
            "stream": camera.status if camera else None, "generation": generation,
            "settings": settings.model_dump()}


class Connection(BaseModel):
    link: str = Field(max_length=2048)
    origin: str = Field(default="", max_length=2048)


@app.post("/api/connect")
async def connect_relay(body: Connection):
    global generation
    try:
        await relay.start(body.link, body.origin)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    settings.enabled = False
    generation += 1
    reset_channels()
    return {"generation": generation}


@app.post("/api/settings")
async def configure(body: Settings):
    global settings, generation
    if body.enabled and (ocr is None or not relay.ready()):
        raise HTTPException(409, "OCR와 웹 호스트가 연결된 뒤 동기화를 시작하세요.")
    if body.enabled and body.mode == "auto" and not relay.tracking_supported():
        raise HTTPException(409, "자동 타이머를 지원하는 새 버전으로 OBS 호스트 PC 화면을 새로고침하세요.")
    settings = body
    generation += 1
    reset_channels()
    return {"generation": generation}


class Reacquire(BaseModel):
    key: ClockKey | None = None


@app.post("/api/reacquire")
async def reacquire(body: Reacquire):
    """Explicitly establish a new baseline without replaying a pending frame."""
    global generation
    generation += 1
    reset_channels([body.key] if body.key else None)
    return {"generation": generation}


class Source(BaseModel):
    url: str = Field(default="", max_length=2048)


@app.post("/api/source")
async def source(body: Source):
    global camera, generation
    try:
        replacement = StreamCamera(body.url) if body.url else None
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if camera:
        camera.close()
    camera = replacement
    settings.enabled = False
    generation += 1
    reset_channels()
    return {"generation": generation}


@app.get("/api/stream-frame")
async def stream_frame():
    latest = camera.frame() if camera else None
    if latest is None:
        raise HTTPException(409, camera.status if camera else "스트림이 연결되지 않았습니다.")
    frame, captured = latest
    # Bound preview bandwidth; OCR still receives a crop, never the whole stream.
    height, width = frame.shape[:2]
    if width > 1280:
        frame = cv2.resize(frame, (1280, round(height * 1280 / width)))
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(500, "프레임 인코딩 실패")
    return Response(jpg.tobytes(), media_type="image/jpeg", headers={"X-Captured-Ms": str(captured)})


@app.post("/api/frame")
async def recognize(request: Request):
    global gate_relay_generation
    if ocr is None:
        raise HTTPException(503, model_status)
    key = request.headers.get("x-clock-key", settings.key)
    if key not in CLOCK_KEYS:
        raise HTTPException(400, "알 수 없는 시계입니다.")
    gate, tracker, phase = gates[key], trackers[key], phases[key]
    shot_clock = key == "OBS_BASKETBALL_SHOT_CLOCK"
    maximum = (settings.shot_maximum if shot_clock else settings.game_maximum) if settings.keys else settings.maximum
    armed = settings.enabled and key in (settings.keys or [settings.key])
    try:
        captured = float(request.headers["x-captured-ms"])
        frame_generation = int(request.headers["x-generation"])
    except (ValueError, KeyError) as error:
        raise HTTPException(400, "프레임 시간/설정 버전이 필요합니다.") from error
    if not math.isfinite(captured) or not -200 <= now_ms() - captured < 900:
        return {"accepted": False, "reason": "오래된 프레임은 건너뜀"}
    if frame_lock.locked() or frame_generation != generation:
        return {"accepted": False, "reason": "이전 프레임 처리 중 또는 설정 변경됨"}
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 1_000_000:
            raise HTTPException(413, "선택 영역 이미지는 1 MB 이하여야 합니다.")
    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.width > 1920 or image.height > 1080 or min(image.size) < 12:
                raise ValueError("image dimensions")
            pixels = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception as error:
        raise HTTPException(400, "12×12 이상, 1920×1080 이하 이미지를 보내세요.") from error
    if frame_lock.locked():
        return {"accepted": False, "reason": "처리 중인 프레임이 있어 건너뜀"}
    async with frame_lock:
        started = now_ms()
        relay_generation = relay.generation
        if gate_relay_generation != relay_generation:
            reset_channels()
            gate_relay_generation = relay_generation
        try:
            recognition = await asyncio.to_thread(ocr.read_detailed, pixels, settings.preprocessing, settings.reader)
            reading = recognition.reading
        except Exception as error:
            raise HTTPException(500, f"OCR 처리 실패 ({type(error).__name__})") from error
        elapsed = now_ms() - started
        if frame_generation != generation or relay_generation != relay.generation:
            if relay_generation != relay.generation:
                reset_channels()
            return {"accepted": False, "reason": "연결/설정 변경으로 결과 폐기"}
        over_limit = reading is not None and reading.seconds > maximum
        valid = reading if reading and not over_limit and reading.confidence >= settings.minimum_confidence else None
        phase.observe(valid, captured)
        previous = gate.confirmed
        accepted, reason = gate.accept(None if over_limit else reading, captured, now_ms(),
                                       settings.minimum_confidence,
                                       shot_clock=shot_clock,
                                       tracking=settings.mode == "auto")
        if over_limit:
            reason = f"{reading.text} = {reading.seconds:g}초 인식됨 · 동기화 최대값 {maximum:g}초 초과. 경기 시계를 선택하거나 최대값을 늘리세요."
        elif not reading:
            reason = f"{recognition.reason} · 마지막 확정값 유지"
        sent = False
        mode, offset_ms = settings.mode, 0
        if accepted:
            phase.confirm(previous, reading, captured)
        timing = phase.status(captured)
        if accepted and mode == "auto":
            mode, reason = tracker.decide(reading, captured,
                                         current=relay.current(key) if armed else None,
                                         shot_clock=shot_clock,
                                         compensation_seconds=settings.compensation_seconds,
                                         phase_ms=timing["phase_ms"], phase_ready=timing["samples"] > 0,
                                         uncertainty_ms=timing["uncertainty_ms"] or 0,
                                         age_ms=now_ms() - captured)
            if mode == "run":
                offset_ms = timing["phase_ms"] + settings.compensation_seconds * 1000
                reason += f" · 초 경계 {timing['phase_ms']}ms / 추가 {round(settings.compensation_seconds * 1000)}ms"
            elif mode == "hold":
                phase.reset()
        if accepted and armed and mode:
            sent = await relay.observe(reading, captured, key, mode, offset_ms)
            reason += " · 웹 전송" if sent else " · 웹 호스트 연결 대기"
            if not sent and settings.mode == "auto":
                tracker.reset()
        elif accepted and not armed:
            reason += " · 미리보기"
        return {"key": key, "reading": asdict(reading) if reading else None, "accepted": accepted, "timing": timing,
                "confirmed": asdict(gate.confirmed) if gate.confirmed else None,
                "confirmation_frames": gate.evidence,
                "sent": sent, "reason": reason, "inference_ms": round(elapsed),
                "raw_text": recognition.raw_text, "method": recognition.method,
                "age_ms": round(now_ms() - captured)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local scoreboard clock reader")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(f"카메라 화면: http://127.0.0.1:{args.port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)
