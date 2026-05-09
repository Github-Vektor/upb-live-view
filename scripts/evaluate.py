"""
Localisation accuracy evaluation — Phase 3 measurement tool.

Ground truth is assigned by timestamp: the test recording follows a known
node path, and each frame is labelled by linear interpolation between node
crossing times. Override with --crossings for precise timestamps.

Metrics reported:
  - Top-1 accuracy    (exact node correct)
  - Top-3 accuracy    (correct node in top-3 predictions)
  - Neighbour accuracy (correct node OR an immediately adjacent node)
  - Per-node recall table
  - Confusion matrix (which nodes get confused with which)

Usage:
    python scripts/evaluate.py <video>
    python scripts/evaluate.py <video> --fps 2
    python scripts/evaluate.py <video> --path conn_0_1,tower_1,...,conn_4_5
    python scripts/evaluate.py <video> --crossings data/gt_crossings.json

Ground truth crossings JSON format (optional, more accurate than linear interp):
    {
      "path": ["conn_4_5", "tower_4", ..., "conn_0_1"],
      "crossings_sec": [0.0, 16.1, 32.2, ...]
    }
    crossings_sec[i] = time (seconds) when the camera reaches path[i].
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import load_index, make_matcher, make_extractor, resize_gray, match_count, MIN_MATCHES, TOP_K

ROOT    = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "feature_index.db"

# Default test path: recording goes conn_4_5 → conn_0_1
DEFAULT_PATH = [
    "conn_4_5", "tower_4", "conn_3_4", "tower_3",
    "conn_2_3", "tower_2", "conn_1_2", "tower_1", "conn_0_1",
]

_extractor = None
_bf        = None


def query_frame(gray: np.ndarray, index: list) -> list[tuple[int, str]]:
    _, descs = _extractor.detectAndCompute(gray, None)
    if descs is None:
        return []
    scores = [
        (match_count(descs, ref, _bf), node_id)
        for _, node_id, ref in index
    ]
    scores = [(g, nid) for g, nid in scores if g >= MIN_MATCHES]
    scores.sort(reverse=True)
    return scores


# ---------------------------------------------------------------------------
# Ground truth assignment
# ---------------------------------------------------------------------------

def build_crossings(path: list[str], duration_sec: float) -> list[float]:
    """Linear interpolation: equal time per segment."""
    n = len(path)
    return [i * duration_sec / (n - 1) for i in range(n)]


def gt_node_at(timestamp: float, path: list[str], crossings: list[float]) -> str:
    """Return the ground-truth node for a given timestamp."""
    for i in range(len(crossings) - 1):
        if crossings[i] <= timestamp < crossings[i + 1]:
            return path[i]
    return path[-1]


def adjacent_nodes(node_id: str, path: list[str]) -> set[str]:
    """Return the immediate neighbours of node_id in the path."""
    idx = path.index(node_id) if node_id in path else -1
    result = {node_id}
    if idx > 0:
        result.add(path[idx - 1])
    if idx < len(path) - 1:
        result.add(path[idx + 1])
    return result


# ---------------------------------------------------------------------------
# Evaluation loop
# ---------------------------------------------------------------------------

def _score_frame(
    gray: np.ndarray,
    gt: str,
    path: list[str],
    index: list,
    accum: dict,
) -> None:
    """Match one frame and accumulate counters into accum."""
    scores = query_frame(gray, index)
    accum["total"] += 1

    if not scores:
        accum["no_match"] += 1
        accum["per_node"][gt][1] += 1
        accum["confusion"][gt]["<no_match>"] += 1
        return

    top_nodes = [n for _, n in scores[:TOP_K]]
    pred = top_nodes[0]
    accum["top1"]  += pred == gt
    accum["top3"]  += gt in top_nodes[:3]
    accum["neigh"] += gt in adjacent_nodes(pred, path)
    accum["per_node"][gt][0] += pred == gt
    accum["per_node"][gt][1] += 1
    accum["confusion"][gt][pred] += 1


def _print_report(path: list[str], accum: dict) -> None:
    total = accum["total"]
    if total == 0:
        print("No frames evaluated.")
        return

    print("=" * 56)
    print(f"  Frames evaluated : {total}  (no match: {accum['no_match']})")
    print(f"  Top-1 accuracy   : {accum['top1']}/{total} = {100*accum['top1']/total:.1f}%")
    print(f"  Top-3 accuracy   : {accum['top3']}/{total} = {100*accum['top3']/total:.1f}%")
    print(f"  Neighbour acc.   : {accum['neigh']}/{total} = {100*accum['neigh']/total:.1f}%")
    print("=" * 56)

    print(f"\n{'Node':<22} {'Correct':>7} {'Total':>6} {'Recall':>7}")
    print("-" * 46)
    for node in path:
        correct, total_n = accum["per_node"][node]
        recall = f"{100*correct/total_n:.0f}%" if total_n else "  n/a"
        print(f"  {node:<20} {correct:>7} {total_n:>6} {recall:>7}")

    confusion  = accum["confusion"]
    pred_nodes = sorted({p for row in confusion.values() for p in row}, key=lambda x: (x == "<no_match>", x))
    col_w      = 10
    print("\nConfusion matrix  (rows = ground truth, cols = predicted)")
    header = f"  {'GT \\ Pred':<20}" + "".join(f"{n[:col_w]:>{col_w}}" for n in pred_nodes)
    print(header)
    print("-" * len(header))
    for gt_node in path:
        row = f"  {gt_node:<20}"
        row += "".join(
            f"{str(confusion[gt_node].get(p, 0)) if confusion[gt_node].get(p, 0) else '.':>{col_w}}"
            for p in pred_nodes
        )
        print(row)


def evaluate(
    video_path: str,
    path: list[str],
    crossings: list[float] | None,
    fps_target: float,
    index: list,
) -> None:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: cannot open {video_path}")
        return

    vid_fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_f    = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration   = total_f / vid_fps
    frame_step = max(1, int(vid_fps / fps_target))

    if crossings is None:
        crossings = build_crossings(path, duration)
        print(f"Ground truth: linear interpolation over {len(path)} nodes ({duration:.1f}s total)")
    else:
        print("Ground truth: manual crossings provided")

    # Stop at last crossing — frames beyond it belong to a return journey or
    # idle period and have no reliable ground truth label.
    end_sec = crossings[-1]
    print(f"Video: {duration:.1f}s, evaluating 0–{end_sec:.1f}s at {fps_target} fps\n")

    accum: dict = {
        "total": 0, "no_match": 0, "top1": 0, "top3": 0, "neigh": 0,
        "per_node": defaultdict(lambda: [0, 0]),
        "confusion": defaultdict(lambda: defaultdict(int)),
    }

    frame_idx = 0
    while True:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret or frame_idx / vid_fps > end_sec:
            break
        gt = gt_node_at(frame_idx / vid_fps, path, crossings)
        _score_frame(resize_gray(frame), gt, path, index, accum)
        frame_idx += frame_step

    cap.release()
    _print_report(path, accum)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Evaluate localisation accuracy on a test recording.")
    parser.add_argument("video",        help="Path to test video")
    parser.add_argument("--fps",        type=float, default=1.0,
                        help="Frames per second to evaluate (default: 1.0)")
    parser.add_argument("--path",       type=str,   default=None,
                        help="Comma-separated node path (default: conn_4_5→conn_0_1)")
    parser.add_argument("--crossings",  type=str,   default=None,
                        help="JSON file with manual crossing timestamps")
    args = parser.parse_args()

    path = [n.strip() for n in args.path.split(",")] if args.path else DEFAULT_PATH

    crossings = None
    if args.crossings:
        data = json.loads(Path(args.crossings).read_text())
        path      = data["path"]
        crossings = data["crossings_sec"]

    if not DB_PATH.exists():
        print(f"ERROR: index not found at {DB_PATH}. Run build_index.py first.")
        return

    global _extractor, _bf
    print("Loading index…")
    index, meta = load_index(DB_PATH)
    _extractor  = make_extractor(meta)
    _bf         = make_matcher(meta)
    print(f"{len(index)} frames in index ({meta.get('feature_type', 'ORB')}).\n")

    evaluate(args.video, path, crossings, args.fps, index)


if __name__ == "__main__":
    main()
