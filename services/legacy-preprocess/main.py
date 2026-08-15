"""
main.py — Legacy document preprocessing microservice.

A thin FastAPI wrapper around pipeline.py's preprocess_legacy_scan().
Exists as a separate Python service (not inside the Next.js app)
because true adaptive binarization + Hough-based deskew need real
OpenCV, which the Node/sharp stack the rest of ZameenVerify runs on
cannot do. This service does ONE job — clean an image — and returns
the result; it does not call Qwen-VL, does not talk to Supabase, and
does not know anything about land records. That separation keeps it
independently testable (see test_pipeline.py) and independently
deployable (Railway/Render, per the project's stated plan) without
coupling its lifecycle to the Next.js app's.

Run locally:
    uvicorn main:app --reload --port 8000

Deploy: point Railway/Render at this directory. Needs a Python 3.11+
runtime with opencv-python-headless (NOT opencv-python — the headless
build avoids pulling in GUI/X11 dependencies that fail to install on
a typical container image and are never used server-side).
"""

import base64
import io
import time
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline import preprocess_legacy_scan

app = FastAPI(
    title="ZameenVerify Legacy Preprocessing Service",
    description="OpenCV-based cleanup for handwritten/legacy land record scans (Mode 2 ingestion).",
    version="1.0.0",
)

# CORS: the Next.js app calls this service server-side (route handler
# to microservice), not from the browser, so CORS restrictions here are
# a defense-in-depth measure rather than the primary access control —
# there is no browser-facing caller to restrict via origin. Kept
# permissive rather than hardcoded to a specific origin because the
# Next.js app's deployed origin can change (preview deployments,
# custom domain) and this service has no other access control of its
# own to fall back on. If this service is ever exposed to direct
# browser calls, add real auth (an API key header, checked below)
# before that happens — CORS alone is not access control.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB — generous for a single-page phone photo/scan
SUPPORTED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class PreprocessResponse(BaseModel):
    success: bool
    # Base64-encoded PNG of the binarized (black/white) result — the
    # primary OCR input.
    binarized_image_b64: str | None = None
    # Base64-encoded PNG of the grayscale, contrast-enhanced (but not
    # binarized) result — kept as an alternate OCR input since
    # binarization is a lossy, irreversible decision (see
    # pipeline.PreprocessResult docstring).
    enhanced_grayscale_b64: str | None = None
    detected_skew_degrees: float | None = None
    ink_contrast_before: float | None = None
    ink_contrast_after: float | None = None
    processing_time_ms: float | None = None
    error: str | None = None


def _encode_png_b64(image: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Failed to encode processed image as PNG")
    return base64.b64encode(buf.tobytes()).decode("ascii")


@app.get("/health")
def health() -> dict:
    """Plain liveness check — no image processing, so a healthy
    response here doesn't guarantee the pipeline itself works, only
    that the service is up and importable. Real correctness confidence
    comes from test_pipeline.py, run in CI before deploy, not from this
    endpoint."""
    return {"status": "ok"}


@app.post("/preprocess", response_model=PreprocessResponse)
async def preprocess(file: UploadFile = File(...)) -> PreprocessResponse:
    if file.content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f'Unsupported content type "{file.content_type}". '
            f"Supported: {', '.join(sorted(SUPPORTED_CONTENT_TYPES))}. "
            f"(HEIC/HEIF and PDF must be converted before reaching this "
            f"service — see the Next.js /api/extract route, which "
            f"handles HEIC rejection and PDF rasterization upstream of "
            f"this call.)",
        )

    raw_bytes = await file.read()
    if len(raw_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024*1024)}MB limit.",
        )

    np_buffer = np.frombuffer(raw_bytes, dtype=np.uint8)
    bgr_image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if bgr_image is None:
        raise HTTPException(
            status_code=400,
            detail="Could not decode this file as an image — it may be corrupted "
            "or not a valid JPEG/PNG/WebP.",
        )

    start = time.perf_counter()
    try:
        result = preprocess_legacy_scan(bgr_image)
    except Exception as exc:  # noqa: BLE001 — deliberately broad: any
        # preprocessing failure should become a clean 500 with a
        # message, not an unhandled crash that leaves the caller
        # (the Next.js /api/extract route) waiting on a hung request.
        raise HTTPException(
            status_code=500,
            detail=f"Preprocessing failed: {exc}",
        ) from exc
    elapsed_ms = (time.perf_counter() - start) * 1000

    return PreprocessResponse(
        success=True,
        binarized_image_b64=_encode_png_b64(result.binarized),
        enhanced_grayscale_b64=_encode_png_b64(result.enhanced_grayscale),
        detected_skew_degrees=result.detected_skew_degrees,
        ink_contrast_before=result.ink_contrast_before,
        ink_contrast_after=result.ink_contrast_after,
        processing_time_ms=elapsed_ms,
    )
