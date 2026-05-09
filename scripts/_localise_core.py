"""
Shared localisation logic used by server.py, query.py and evaluate.py.
Reads feature_type from DB metadata so the same index works for ORB and SIFT.
"""

import pickle
import sqlite3
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

QUERY_HEIGHT = 480
LOWE_RATIO   = 0.75
MIN_MATCHES  = 6
TOP_K        = 5


def _read_metadata(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM metadata").fetchall()
    return {k: v for k, v in rows}


def load_index(db_path: Path) -> tuple[list, dict]:
    """Returns (index_list, metadata_dict).
    index_list entries: (frame_id, node_id, descriptors_ndarray)
    """
    conn = sqlite3.connect(db_path)
    meta = _read_metadata(conn)
    dtype = np.float32 if meta.get("desc_dtype") == "float32" else np.uint8
    cols  = meta.get("desc_dtype") == "float32" and 128 or 32

    rows = conn.execute("SELECT id, node_id, descriptors FROM frames").fetchall()
    conn.close()

    index = [
        (row_id, node_id, np.frombuffer(blob, dtype=dtype).reshape(-1, cols))
        for row_id, node_id, blob in rows
    ]
    return index, meta


def make_matcher(meta: dict) -> cv2.BFMatcher:
    if meta.get("feature_type", "ORB").upper() == "SIFT":
        return cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
    return cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)


def make_extractor(meta: dict, n_features: int = 500):
    if meta.get("feature_type", "ORB").upper() == "SIFT":
        return cv2.SIFT_create(nfeatures=n_features)
    return cv2.ORB_create(nfeatures=n_features)


def resize_gray(img: np.ndarray) -> np.ndarray:
    if len(img.shape) == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape
    return cv2.resize(img, (int(w * QUERY_HEIGHT / h), QUERY_HEIGHT), interpolation=cv2.INTER_AREA)


def match_count(query_descs: np.ndarray, ref_descs: np.ndarray, bf: cv2.BFMatcher) -> int:
    try:
        raw = bf.knnMatch(query_descs, ref_descs, k=2)
    except cv2.error:
        return 0
    return sum(1 for pair in raw if len(pair) == 2 and pair[0].distance < LOWE_RATIO * pair[1].distance)


def localise(jpeg_bytes: bytes, index: list, extractor, bf: cv2.BFMatcher) -> dict:
    buf = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Could not decode image"}

    gray = resize_gray(img)
    _, descs = extractor.detectAndCompute(gray, None)
    if descs is None:
        return {"error": "No features detected"}

    scores = [
        (match_count(descs, ref, bf), frame_id, node_id)
        for frame_id, node_id, ref in index
    ]
    scores = [(g, fid, nid) for g, fid, nid in scores if g >= MIN_MATCHES]

    if not scores:
        return {"node_id": None, "confidence": 0.0, "top": []}

    scores.sort(reverse=True)
    top       = scores[:TOP_K]
    top_nodes = [nid for _, _, nid in top]
    vote      = Counter(top_nodes).most_common(1)[0][0]

    return {
        "node_id":    vote,
        "confidence": round(top_nodes.count(vote) / len(top_nodes), 2),
        "top": [{"frame_id": fid, "node_id": nid, "matches": g} for g, fid, nid in top],
    }
