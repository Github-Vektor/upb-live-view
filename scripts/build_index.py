"""
Offline index builder — Phase 2/3.

Reads graph.json, opens each node's recording from recordings/, extracts frames
at a configurable rate, computes descriptors, and stores everything in
data/feature_index.db (SQLite).

Usage:
    python scripts/build_index.py                        # evening_demo_light, ORB, 1 fps
    python scripts/build_index.py --feature-type sift    # SIFT (better viewpoint invariance)
    python scripts/build_index.py --augment              # add perspective + brightness variants
    python scripts/build_index.py --fps 3 --min-frames-per-clip 8 --clear
        # denser sampling for the short evening_demo_light clips, fresh index
    python scripts/build_index.py --condition evening_medium_light --graph data/graph_medium.json --db data/index_med_orb.db
        # build an older dataset instead of the current default
"""

from __future__ import annotations

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

# Set at runtime from --condition; the graph stores bare filenames so the same
# graph can be indexed under any lighting-condition subfolder.
RECORDINGS_DIR = RECORDINGS

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
    min_frames_per_clip: int = 1,
) -> int:
    path = RECORDINGS_DIR / recording
    if not path.exists():
        print(f"  WARNING: {path} not found — skipping.")
        return 0

    cap   = cv2.VideoCapture(str(path))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step  = max(1, int(fps * frame_interval_sec))

    # Safety net for very short clips (e.g. a 3-5s stairwell approach at 1 fps
    # would only yield 3-5 frames): if the requested sampling rate wouldn't hit
    # at least `min_frames_per_clip` frames, densify the sampling for this clip
    # alone, capped at reading every native frame.
    if min_frames_per_clip > 1 and total > 0 and total // step < min_frames_per_clip:
        step = max(1, total // min_frames_per_clip)

    # Resume support: skip frame indices already stored for this recording so a
    # build interrupted by a time limit can be re-run and pick up where it left off.
    existing = {fi for (fi,) in conn.execute(
        "SELECT frame_index FROM frames WHERE node_id=? AND recording=?", (node_id, recording))}

    insert_sql = ("INSERT INTO frames (node_id, recording, frame_index, timestamp_sec, augmentation, keypoints, descriptors) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?)")
    rows      = []
    written   = 0
    frame_idx = 0
    variants  = [("none", lambda g: g)] + (AUGMENTATIONS if augment else [])

    # Some phone recordings (variable-frame-rate H.264, or clips trimmed by a
    # tool that stream-copies without rewriting the container's frame-count
    # metadata) report a CAP_PROP_FRAME_COUNT far larger than what's actually
    # decodable — and on some OpenCV/FFmpeg builds, seeking past the real end
    # doesn't fail (ret stays True) but just re-returns the last frame forever.
    # Without a guard, that turns a 5-second clip into a multi-minute hang
    # re-extracting features from the same frozen frame thousands of times.
    # Detect "no timestamp progress" and treat it as end-of-video.
    last_pos_msec = -1.0

    with tqdm(total=total // step, desc=f"  {recording}", unit="frame", leave=False) as pbar:
        while True:
            if frame_idx in existing:
                frame_idx += step
                pbar.update(1)
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
            if pos_msec > 0 and last_pos_msec >= 0 and pos_msec <= last_pos_msec + 1e-6:
                # Stalled on the same timestamp — we've run past the real content.
                break
            if pos_msec > 0:
                last_pos_msec = pos_msec

            base_gray = resize_gray(frame)

            for aug_name, aug_fn in variants:
                packed = extract_and_pack(extractor, aug_fn(base_gray))
                if packed:
                    kp_blob, desc_blob = packed
                    rows.append((node_id, recording, frame_idx, frame_idx / fps, aug_name, kp_blob, desc_blob))

            # Commit incrementally so progress survives an interrupted run.
            if len(rows) >= 8:
                conn.executemany(insert_sql, rows)
                conn.commit()
                written += len(rows)
                rows = []

            frame_idx += step
            pbar.update(1)

    cap.release()

    if rows:
        conn.executemany(insert_sql, rows)
        conn.commit()
        written += len(rows)
    return written


# ---------------------------------------------------------------------------
# Walkthrough indexing — one video covering the whole path, with frames labelled
# by the ground-truth crossing times instead of one short clip per node.
# ---------------------------------------------------------------------------

def gt_label_at(timestamp: float, path: list[str], crossings: list[float]) -> str:
    """Ground-truth node for a timestamp: before the first crossing it is the
    start node, after the last crossing the end node, otherwise the node whose
    crossing interval contains the timestamp."""
    if timestamp < crossings[0]:
        return path[0]
    for i in range(len(crossings) - 1):
        if crossings[i] <= timestamp < crossings[i + 1]:
            return path[i]
    return path[-1]


def index_walkthrough(
    conn: sqlite3.Connection,
    extractor,
    video: str,
    gt_path: Path,
    frame_interval_sec: float,
    augment: bool,
) -> int:
    path = RECORDINGS_DIR / video
    if not path.exists():
        print(f"  WARNING: walkthrough {path} not found — skipping.")
        return 0
    if not gt_path.exists():
        print(f"  WARNING: ground-truth {gt_path} not found — skipping walkthrough.")
        return 0

    gt = json.loads(gt_path.read_text())
    gt_nodes, crossings = gt["path"], gt["crossings_sec"]

    cap   = cv2.VideoCapture(str(path))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step  = max(1, int(fps * frame_interval_sec))

    rows      = []
    frame_idx = 0
    variants  = [("none", lambda g: g)] + (AUGMENTATIONS if augment else [])

    with tqdm(total=total // step, desc=f"  {video}", unit="frame", leave=False) as pbar:
        while True:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            t         = frame_idx / fps
            node_id   = gt_label_at(t, gt_nodes, crossings)
            base_gray = resize_gray(frame)

            for aug_name, aug_fn in variants:
                packed = extract_and_pack(extractor, aug_fn(base_gray))
                if packed:
                    kp_blob, desc_blob = packed
                    rows.append((node_id, video, frame_idx, t, aug_name, kp_blob, desc_blob))

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
    global DB_PATH, RECORDINGS_DIR

    parser = argparse.ArgumentParser(description="Build feature index from recordings.")
    parser.add_argument("--fps",          type=float, default=1.0,   help="Frames per second to extract (default: 1.0)")
    parser.add_argument("--min-frames-per-clip", type=int, default=1,
                        help="Densify sampling for any single clip shorter than this many "
                             "frames at the chosen --fps (default: 1, i.e. off). Useful for "
                             "conditions with very short clips (e.g. a few seconds each) where "
                             "a low --fps would otherwise index only 1-2 frames from some clips.")
    parser.add_argument("--features",     type=int,   default=500,   help="Features per frame (default: 500)")
    parser.add_argument("--feature-type", type=str,   default="orb", choices=["orb", "sift"],
                        help="Feature extractor: orb (default) or sift")
    parser.add_argument("--augment",      action="store_true",       help="Add perspective + brightness augmentations")
    parser.add_argument("--clear",        action="store_true",       help="Delete existing index before building")
    parser.add_argument("--condition",    type=str,   default="evening_demo_light",
                        help="Recordings subfolder / lighting condition (default: evening_demo_light, "
                             "matching the node ids/filenames in the default data/graph.json). Pass "
                             "evening_high_light or evening_medium_light with their matching --graph "
                             "file (data/graph_high_light.json / data/graph_medium.json) to build an "
                             "index for one of the older datasets instead.")
    parser.add_argument("--recordings",   type=str,   default=str(RECORDINGS),
                        help="Recordings root (default: repo recordings/). Point at a local "
                             "copy for much faster frame seeking than a network/FUSE mount.")
    parser.add_argument("--only",         type=str,   default=None,
                        help="Comma-separated node ids to index (default: all). Lets a build "
                             "be split across runs; commits happen per recording so progress persists.")
    parser.add_argument("--graph",        type=str,   default=str(GRAPH_PATH),
                        help="Graph JSON describing nodes and their recordings (default: data/graph.json). "
                             "Use a condition-specific graph when filenames differ (e.g. h1.mp4 vs hall1.mp4).")
    parser.add_argument("--with-train",   action="store_true",
                        help="Also index the full walkthrough (train.mp4) labelled by data/gt_train.json")
    parser.add_argument("--train-video",  type=str,   default="train.mp4",
                        help="Walkthrough filename in the condition folder (used with --with-train)")
    parser.add_argument("--train-gt",     type=str,   default=str(ROOT / "data" / "gt_train.json"),
                        help="Ground-truth crossings JSON for the walkthrough")
    parser.add_argument("--db",           type=str,   default=str(DB_PATH),
                        help="Output index path (default: data/feature_index.db). "
                             "Use distinct paths to keep ORB and SIFT indexes side by side.")
    args = parser.parse_args()

    DB_PATH = Path(args.db)
    RECORDINGS_DIR = Path(args.recordings) / args.condition
    if not RECORDINGS_DIR.is_dir():
        parser.error(f"recordings condition folder not found: {RECORDINGS_DIR}")
    print(f"Recordings: {RECORDINGS_DIR}")

    frame_interval_sec = 1.0 / args.fps
    extractor = make_extractor(args.feature_type, args.features)

    graph = json.loads(Path(args.graph).read_text())
    conn  = open_db(DB_PATH, args.clear)

    import time
    t_build0 = time.perf_counter()

    # Write the constant metadata immediately so an interrupted/incremental build
    # still produces a loadable index (load_index needs feature_type + desc_dtype).
    conn.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)", [
        ("feature_type",       args.feature_type.upper()),
        ("features_per_frame", str(args.features)),
        ("frame_interval_sec", str(frame_interval_sec)),
        ("query_height_px",    str(QUERY_HEIGHT)),
        ("augmented",          str(args.augment)),
        ("desc_dtype",         desc_dtype(args.feature_type)),
        ("condition",          args.condition),
        ("min_frames_per_clip", str(args.min_frames_per_clip)),
    ])
    conn.commit()

    only = {n.strip() for n in args.only.split(",")} if args.only else None

    total_frames = 0
    for node in graph["nodes"]:
        if only and node["id"] not in only:
            continue
        # Primary recording for the node, plus any extra corridor/transition
        # clips listed under "paths" (the walks between rooms). All are indexed
        # under this node's id. Missing files are skipped with a warning, so a
        # condition folder that lacks the transition clips still builds fine.
        recs = []
        if node.get("recording"):
            recs.append(node["recording"])
        recs.extend(node.get("paths", []))
        if not recs:
            continue
        print(f"{node['id']}  ({len(recs)} recording(s))")
        node_frames = 0
        for rec in recs:
            node_frames += index_recording(conn, extractor, node["id"], rec, frame_interval_sec,
                                             args.augment, args.min_frames_per_clip)
        print(f"  {node_frames} frames indexed")
        total_frames += node_frames

    if args.with_train:
        print(f"walkthrough  ({args.train_video}, labelled by {Path(args.train_gt).name})")
        n = index_walkthrough(conn, extractor, args.train_video, Path(args.train_gt),
                              frame_interval_sec, args.augment)
        print(f"  {n} frames indexed")
        total_frames += n

    build_seconds = time.perf_counter() - t_build0

    # total_frames reflects the whole index (cumulative across incremental runs).
    db_frames = conn.execute("SELECT COUNT(*) FROM frames").fetchone()[0]
    prev_secs = conn.execute("SELECT value FROM metadata WHERE key='build_seconds'").fetchone()
    cum_secs  = (float(prev_secs[0]) if prev_secs else 0.0) + build_seconds
    conn.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)", [
        ("total_frames",  str(db_frames)),
        ("build_seconds", f"{cum_secs:.2f}"),
    ])
    conn.commit()
    conn.close()
    total_frames = db_frames

    size_kb = DB_PATH.stat().st_size // 1024
    print(f"\nDone. {total_frames} frames → {DB_PATH}")
    print(f"Index size: {size_kb} KB ({size_kb/1024:.1f} MB)")
    print(f"Build time: {build_seconds:.1f} s")


if __name__ == "__main__":
    main()
