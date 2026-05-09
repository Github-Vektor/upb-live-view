"""
Offline index builder — Phase 2/3.

Reads graph.json, opens each node's recording from recordings/, extracts frames
at a configurable rate, computes descriptors, and stores everything in
data/feature_index.db (SQLite).

Usage:
    python scripts/build_index.py                        # ORB, 1 fps, no augmentation
    python scripts/build_index.py --feature-type sift    # SIFT (better viewpoint invariance)
    python scripts/build_index.py --augment              # add perspective + brightness variants
    python scripts/build_index.py --fps 2 --clear        # denser sampling, fresh index
"""

import argparse
import json
import pickle
import sqlite3
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

ROOT         = Path(__file__).parent.parent
GRAPH_PATH   = ROOT / "data" / "graph.json"
RECORDINGS   = ROOT / "recordings"
DB_PATH      = ROOT / "data" / "feature_index.db"

QUERY_HEIGHT = 480


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS frames (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT    NOT NULL,
    recording       TEXT    NOT NULL,
    frame_index     INTEGER NOT NULL,
    timestamp_sec   REAL    NOT NULL,
    augmentation    TEXT    NOT NULL DEFAULT 'none',
    keypoints       BLOB    NOT NULL,
    descriptors     BLOB    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_id ON frames (node_id);

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def open_db(path: Path, clear: bool) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if clear and path.exists():
        path.unlink()
        print("Cleared existing index.")
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def pack_keypoints(kps: list) -> bytes:
    return pickle.dumps([(kp.pt, kp.size, kp.angle, kp.response, kp.octave, kp.class_id) for kp in kps])


# ---------------------------------------------------------------------------
# Augmentation
# ---------------------------------------------------------------------------

def _tilt_down(gray: np.ndarray, strength: float) -> np.ndarray:
    """Perspective warp simulating camera tilted downward by `strength` (0–1)."""
    h, w = gray.shape
    s = strength
    src = np.float32([[0, 0],    [w, 0],      [w, h], [0, h]])
    dst = np.float32([[s*w, s*h],[w*(1-s), s*h],[w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(gray, M, (w, h))


def _brightness(gray: np.ndarray, factor: float) -> np.ndarray:
    return np.clip(gray.astype(np.float32) * factor, 0, 255).astype(np.uint8)


# (name, transform_fn)
AUGMENTATIONS: list[tuple[str, object]] = [
    ("tilt_low",    lambda g: _tilt_down(g, 0.12)),
    ("tilt_mid",    lambda g: _tilt_down(g, 0.22)),
    ("bright_dark", lambda g: _brightness(g, 0.75)),
    ("bright_light",lambda g: _brightness(g, 1.30)),
]


# ---------------------------------------------------------------------------
# Feature extractor factory
# ---------------------------------------------------------------------------

def make_extractor(feature_type: str, n_features: int):
    if feature_type == "sift":
        return cv2.SIFT_create(nfeatures=n_features)
    return cv2.ORB_create(nfeatures=n_features)


def desc_dtype(feature_type: str) -> str:
    return "float32" if feature_type == "sift" else "uint8"


# ---------------------------------------------------------------------------
# Frame processing
# ---------------------------------------------------------------------------

def resize_gray(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
    h, w = gray.shape
    return cv2.resize(gray, (int(w * QUERY_HEIGHT / h), QUERY_HEIGHT), interpolation=cv2.INTER_AREA)


def extract_and_pack(extractor, gray: np.ndarray) -> tuple[bytes, bytes] | None:
    kps, descs = extractor.detectAndCompute(gray, None)
    if descs is None or len(kps) == 0:
        return None
    return pack_keypoints(kps), descs.tobytes()


def index_recording(
    conn: sqlite3.Connection,
    extractor,
    node_id: str,
    recording: str,
    frame_interval_sec: float,
    augment: bool,
) -> int:
    path = RECORDINGS / recording
    if not path.exists():
        print(f"  WARNING: {path} not found — skipping.")
        return 0

    cap   = cv2.VideoCapture(str(path))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step  = max(1, int(fps * frame_interval_sec))

    rows      = []
    frame_idx = 0
    variants  = [("none", lambda g: g)] + (AUGMENTATIONS if augment else [])

    with tqdm(total=total // step, desc=f"  {recording}", unit="frame", leave=False) as pbar:
        while True:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            base_gray = resize_gray(frame)

            for aug_name, aug_fn in variants:
                packed = extract_and_pack(extractor, aug_fn(base_gray))
                if packed:
                    kp_blob, desc_blob = packed
                    rows.append((node_id, recording, frame_idx, frame_idx / fps, aug_name, kp_blob, desc_blob))

            frame_idx += step
            pbar.update(1)

    cap.release()

    conn.executemany(
        "INSERT INTO frames (node_id, recording, frame_index, timestamp_sec, augmentation, keypoints, descriptors) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build feature index from recordings.")
    parser.add_argument("--fps",          type=float, default=1.0,   help="Frames per second to extract (default: 1.0)")
    parser.add_argument("--features",     type=int,   default=500,   help="Features per frame (default: 500)")
    parser.add_argument("--feature-type", type=str,   default="orb", choices=["orb", "sift"],
                        help="Feature extractor: orb (default) or sift")
    parser.add_argument("--augment",      action="store_true",       help="Add perspective + brightness augmentations")
    parser.add_argument("--clear",        action="store_true",       help="Delete existing index before building")
    args = parser.parse_args()

    frame_interval_sec = 1.0 / args.fps
    extractor = make_extractor(args.feature_type, args.features)

    graph = json.loads(GRAPH_PATH.read_text())
    conn  = open_db(DB_PATH, args.clear)

    total_frames = 0
    for node in graph["nodes"]:
        recording = node.get("recording")
        if not recording:
            continue
        print(f"{node['id']}  ({recording})")
        n = index_recording(conn, extractor, node["id"], recording, frame_interval_sec, args.augment)
        aug_note = f"  ({n // (1 + len(AUGMENTATIONS))} raw × {1 + len(AUGMENTATIONS)} variants)" if args.augment else ""
        print(f"  {n} frames indexed{aug_note}")
        total_frames += n

    conn.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)", [
        ("feature_type",       args.feature_type.upper()),
        ("features_per_frame", str(args.features)),
        ("frame_interval_sec", str(frame_interval_sec)),
        ("query_height_px",    str(QUERY_HEIGHT)),
        ("total_frames",       str(total_frames)),
        ("augmented",          str(args.augment)),
        ("desc_dtype",         desc_dtype(args.feature_type)),
    ])
    conn.commit()
    conn.close()

    print(f"\nDone. {total_frames} frames → {DB_PATH}")
    print(f"Index size: {DB_PATH.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
