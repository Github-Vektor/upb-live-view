"""
Localisation server — Phase 3+.

POST /localise   multipart form: frame=<JPEG bytes>
GET  /status     returns index size and feature type

Usage:
    python scripts/server.py
    python scripts/server.py --port 8787
"""

import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import load_index, make_matcher, make_extractor

ROOT    = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "feature_index.db"

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
