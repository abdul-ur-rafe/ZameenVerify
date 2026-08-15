# ZameenVerify Legacy Preprocessing Service

OpenCV-based image cleanup for handwritten/legacy land record scans —
the first stage of Mode 2 ("legacy") ingestion, ahead of the Qwen-VL
Nastaliq OCR step. Mode 1 (typed/computerized PLRA records) is
unaffected and continues to use the existing `sharp()`-based pipeline
in the Next.js app.

## Why this is a separate service

True adaptive binarization and Hough-transform-based deskewing need
real OpenCV. The Node/`sharp` stack the rest of the app runs on cannot
do this — `sharp` has no equivalent for these specific algorithms.
Rather than fake it with `sharp`'s blunter tools, this ships as a
standalone Python microservice that the Next.js app calls over HTTP.

## What it does — and what it deliberately does not do

This service's only job is: take an image, clean it up, hand back a
cleaner image. It does not call Qwen-VL, does not know about land
records or document types, and does not touch Supabase. That
separation is what makes `pipeline.py` independently testable (see
`test_pipeline.py` — 16 tests, run with `pytest`) without needing a
running Next.js app, API keys, or a database.

## The pipeline, and why the stage order matters

`pipeline.py`'s `preprocess_legacy_scan()` runs, in this specific
order:

1. **Deskew** (Hough line transform on the raw grayscale image)
2. **Denoise** (moderate-strength, `fastNlMeansDenoising`)
3. **CLAHE** (adaptive local contrast enhancement)
4. **Adaptive binarization** (Gaussian-weighted local threshold)

This order was arrived at empirically, not by intuition — see the
docstrings in `pipeline.py` for the two specific bugs this order
avoids (a skew-detection axis-ambiguity bug, and a noise-amplification
bug from running CLAHE before denoising). If you change the stage
order or parameters, re-run `pytest test_pipeline.py -v` — the test
suite includes regression tests for both bugs specifically so they
can't silently come back.

## Running locally

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then:
```bash
curl -X POST http://localhost:8000/preprocess \
  -F "file=@/path/to/scan.jpg;type=image/jpeg"
```

## Running the tests

```bash
pip install pytest
pytest test_pipeline.py -v
```

All 16 tests should pass. If any fail after a code change, do not
adjust the test's tolerance to make it pass — the tolerances were set
based on what the algorithm actually achieves on a representative
fixture; a newly-failing test is more likely telling you the change
broke something real (see the regression-test docstrings for the
specific bugs each one guards against).

## Deploying (Railway / Render)

1. Point the platform at this directory (`services/legacy-preprocess/`)
   as the service root.
2. Runtime: Python 3.11+.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Once deployed, set `LEGACY_PREPROCESS_SERVICE_URL` in the Next.js
   app's environment to this service's public URL (e.g.
   `https://zameenverify-preprocess.up.railway.app`). See
   `app/api/extract-legacy/route.ts` in the main app for how this is
   consumed.

**Note on `opencv-python-headless` vs `opencv-python`:** this service
deliberately uses the `-headless` build. The non-headless
`opencv-python` package pulls in GUI/X11 dependencies that are never
used server-side and can fail to install cleanly on a minimal
container image — `-headless` avoids that entirely and is the correct
choice for any server deployment of OpenCV.

## Known limitation — read before treating this as "done"

This service was developed and tested against **synthetic** degraded
scans (controlled fixtures with known skew angles and noise levels —
see `test_pipeline.py`), not real photographs of handwritten Urdu
Nastaliq/Shikasta documents. The mechanical image-processing
properties (deskew accuracy, noise handling, contrast behavior) are
verified and should transfer to real scans reasonably well, since they
don't depend on the script/language in the image. What is **not**
verified is how this pipeline's output actually affects Qwen-VL's OCR
accuracy on real handwritten Urdu — that can only be established by
running real document scans through the full pipeline (this service +
the OCR step) and checking the results, which should happen before
this is presented as production-ready rather than a working
prototype.
