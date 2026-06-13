"""
Localisation server — Phase 3+.

POST /localise   multipart form: frame=<JPEG bytes>
GET  /status     returns index size and feature type

Usage:
    python scripts/server.py
    python scripts/server.py --port 8787
"""

import os
import sys
import tempfile
from pathlib import Path

import cv2
import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import load_index, make_matcher, make_extractor

ROOT       = Path(__file__).parent.parent
DB_PATH    = ROOT / "data" / "feature_index.db"

# Source for the on-demand test clip served to the Test view.
TEST_VIDEO   = ROOT / "recordings" / "evening_high_light" / "test.mp4"
CLIP_SECONDS = 7
CLIP_HEIGHT  = 720

app = FastAPI(title="Interior Live View — Localisation API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "GET"], allow_headers=["*"])

_index     = []
_meta      = {}
_extractor = None
_bf        = None


@app.on_event("startup")
def startup():
    global _index, _meta, _extractor, _bf
    if not DB_PATH.exists():
        print(f"WARNING: index not found at {DB_PATH}. Run build_index.py first.")
        return
    _index, _meta = load_index(DB_PATH)
    _extractor    = make_extractor(_meta)
    _bf           = make_matcher(_meta)
    print(f"Index loaded: {len(_index)} frames ({_meta.get('feature_type', 'ORB')}).")


@app.post("/localise")
async def localise_endpoint(frame: UploadFile = File(...)):
    from _localise_core import localise
    return localise(await frame.read(), _index, _extractor, _bf)


N_SEGMENTS = 10  # the recording is divided into this many equal windows


@app.get("/test-clip")
def test_clip(background_tasks: BackgroundTasks, segment: int = 0):
    """Cut a CLIP_SECONDS clip from the `segment`-th 1/N_SEGMENTS window of the
    test recording (segment 0 = first 10%, 1 = next 10%, …), downscaled to
    CLIP_HEIGHT and re-encoded as browser-playable H.264. Far lighter than
    serving the full 4K file."""
    if not TEST_VIDEO.exists():
        return JSONResponse({"error": f"test video not found: {TEST_VIDEO}"}, status_code=404)

    cap = cv2.VideoCapture(str(TEST_VIDEO))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    clip_frames = int(fps * CLIP_SECONDS)

    # Start at the window boundary, clamped so a full clip fits inside the video.
    seg   = segment % N_SEGMENTS
    start = min(int(seg / N_SEGMENTS * total), max(0, total - clip_frames))

    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    ret, frame = cap.read()
    if not ret:
        cap.release()
        return JSONResponse({"error": "could not read source video"}, status_code=500)

    h, w = frame.shape[:2]
    size = (int(w * CLIP_HEIGHT / h), CLIP_HEIGHT)

    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"avc1"), fps, size)

    written = 0
    while ret and written < clip_frames:
        writer.write(cv2.resize(frame, size))
        written += 1
        ret, frame = cap.read()

    writer.release()
    cap.release()

    start_sec = start / fps
    print(f"/test-clip: {written} frames from {start_sec:.1f}s, {size[0]}x{size[1]} → {path}")
    background_tasks.add_task(os.remove, path)
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "no-store"})


@app.get("/status")
def status():
    return {
        "frames_indexed": len(_index),
        "feature_type":   _meta.get("feature_type", "unknown"),
        "augmented":      _meta.get("augmented", "False"),
        "ready":          len(_index) > 0,
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    uvicorn.run("server:app", host=args.host, port=args.port, reload=False)
