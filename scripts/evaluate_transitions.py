"""
Transition-clip evaluation.

When a dataset has a recording for each node *and* a clip for each transition
between adjacent nodes (e.g. evening_medium_light: h1.mp4, d1.mp4, h1_to_d1.mp4,
d1_to_h2.mp4, ...), the transition clips make a natural held-out test set: the
index is built only from the static node clips, and a clip named "X_to_Y" should
be localised to either node X or node Y at every frame.

This avoids needing per-frame crossing timestamps: for a transition the camera is,
by definition, somewhere between its two endpoints, so a prediction is counted
correct when it equals either endpoint. That is the navigation-relevant question
("does the system know which two nodes it is between?").

Filename convention (case-insensitive), matching data/graph_medium.json:
    h<N>  ->  conn_<N-1>_<N>     (hallway / connector)
    d<N>  ->  tower_<N>          (room / door)
Clips whose names contain "start" or "end" are ignored.

Usage:
    python scripts/evaluate_transitions.py --dir recordings/evening_medium_light --db data/index_med_sift.db
    python scripts/evaluate_transitions.py --dir recordings/evening_medium_light --db data/index_med_orb.db --fps 2 --json data/eval_med_orb.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import (load_index, make_matcher, make_extractor, resize_gray,
                            match_count, MIN_MATCHES, TOP_K)

ROOT = Path(__file__).parent.parent


def clip_token_to_node(token: str) -> str | None:
    """Map a filename token like 'h1' or 'D4' to a graph node id."""
    token = token.strip().lower()
    if len(token) < 2 or not token[1:].isdigit():
        return None
    n = int(token[1:])
    if token[0] == "h":
        return f"conn_{n-1}_{n}"
    if token[0] == "d":
        return f"tower_{n}"
    return None


def endpoints_from_name(stem: str) -> tuple[str, str] | None:
    """Parse 'X_to_Y' into (nodeX, nodeY); return None if not a usable transition."""
    low = stem.lower()
    if "start" in low or "end" in low or "_to_" not in low:
        return None
    a, b = low.split("_to_", 1)
    na, nb = clip_token_to_node(a), clip_token_to_node(b)
    if na is None or nb is None:
        return None
    return na, nb


def localise_gray(gray, index, extractor, bf) -> tuple[str | None, float]:
    """Return (voted_node, confidence) for one frame, mirroring the deployed logic."""
    _, descs = extractor.detectAndCompute(gray, None)
    if descs is None:
        return None, 0.0
    scores = [(match_count(descs, ref, bf), nid) for _, nid, ref in index]
    scores = [(g, nid) for g, nid in scores if g >= MIN_MATCHES]
    if not scores:
        return None, 0.0
    scores.sort(reverse=True)
    top  = [nid for _, nid in scores[:TOP_K]]
    vote = Counter(top).most_common(1)[0][0]
    return vote, top.count(vote) / len(top)


def eval_clip(path: Path, endpoints: tuple[str, str], fps_target: float,
              index, extractor, bf) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {"frames": 0, "correct": 0}
    vid_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step    = max(1, int(vid_fps / fps_target))

    frames = correct = 0
    confs, lats = [], []
    idx = 0
    while idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, fr = cap.read()
        if not ok:
            break
        t0 = time.perf_counter()
        pred, conf = localise_gray(resize_gray(fr), index, extractor, bf)
        lats.append((time.perf_counter() - t0) * 1000.0)
        frames += 1
        if pred in endpoints:
            correct += 1
            confs.append(conf)
        idx += step
    cap.release()
    return {
        "between": list(endpoints),
        "frames": frames,
        "correct": correct,
        "accuracy_pct": round(100 * correct / frames, 1) if frames else 0.0,
        "lat_mean": round(statistics.fmean(lats), 1) if lats else 0.0,
        "conf_mean": round(statistics.fmean(confs), 3) if confs else 0.0,
    }


def _aggregate(per_clip: dict, meta: dict, args) -> dict:
    frames  = sum(c["frames"] for c in per_clip.values())
    correct = sum(c["correct"] for c in per_clip.values())
    lat = (sum(c["lat_mean"] * c["frames"] for c in per_clip.values()) / frames) if frames else 0.0
    cc  = sum(c["correct"] for c in per_clip.values())
    conf = (sum(c["conf_mean"] * c["correct"] for c in per_clip.values()) / cc) if cc else 0.0
    return {
        "feature_type":          meta.get("feature_type", "ORB"),
        "index_frames":          int(meta.get("total_frames", 0)) or None,
        "condition":             meta.get("condition"),
        "dir":                   args.dir,
        "fps_sampled":           args.fps,
        "clips":                 len(per_clip),
        "frames":                frames,
        "endpoint_accuracy_pct": round(100 * correct / frames, 1) if frames else 0.0,
        "mean_confidence":       round(conf, 3),
        "latency_ms":            {"mean": round(lat, 1)},
        "per_clip":              per_clip,
    }


def main():
    ap = argparse.ArgumentParser(description="Evaluate localisation on transition clips.")
    ap.add_argument("--dir",  required=True, help="Folder with X_to_Y transition clips")
    ap.add_argument("--db",   default=str(ROOT / "data" / "feature_index.db"), help="Index path")
    ap.add_argument("--fps",  type=float, default=1.0, help="Frames per second to sample (default 1)")
    ap.add_argument("--json", default=None, help="Write metrics to this JSON file")
    args = ap.parse_args()

    db = Path(args.db)
    if not db.exists():
        print(f"ERROR: index not found at {db}. Build it first.")
        return

    clips = []
    for f in sorted(Path(args.dir).glob("*.mp4")):
        ep = endpoints_from_name(f.stem)
        if ep:
            clips.append((f, ep))
    if not clips:
        print(f"No usable transition clips in {args.dir}.")
        return

    print("Loading index…")
    index, meta = load_index(db)
    extractor   = make_extractor(meta)
    bf          = make_matcher(meta)
    print(f"{len(index)} frames in index ({meta.get('feature_type','ORB')}). "
          f"{len(clips)} transition clips.\n")

    # Resume: reuse per-clip results already in the JSON so a long run can be
    # split across invocations (writes happen after every clip).
    per_clip: dict = {}
    if args.json and Path(args.json).exists():
        try:
            per_clip = json.loads(Path(args.json).read_text()).get("per_clip", {})
            if per_clip:
                print(f"Resuming: {len(per_clip)} clips already done.\n")
        except json.JSONDecodeError:
            per_clip = {}

    print(f"{'Clip':<22}{'Between':<24}{'Frames':>7}{'OK':>6}{'Acc':>7}")
    print("-" * 66)
    for path, (na, nb) in clips:
        if path.stem in per_clip:
            c = per_clip[path.stem]
            print(f"{path.stem:<22}{na+'–'+nb:<24}{c['frames']:>7}{c['correct']:>6}{c['accuracy_pct']:>6.0f}%  (cached)")
            continue
        r = eval_clip(path, (na, nb), args.fps, index, extractor, bf)
        per_clip[path.stem] = r
        print(f"{path.stem:<22}{na+'–'+nb:<24}{r['frames']:>7}{r['correct']:>6}{r['accuracy_pct']:>6.0f}%")
        if args.json:  # write after each clip so progress survives a time limit
            Path(args.json).write_text(json.dumps(_aggregate(per_clip, meta, args), indent=2))

    agg = _aggregate(per_clip, meta, args)
    print("-" * 66)
    print(f"{'OVERALL':<46}{agg['frames']:>7}{sum(c['correct'] for c in per_clip.values()):>6}{agg['endpoint_accuracy_pct']:>6.1f}%")
    print(f"\nEndpoint accuracy : {agg['endpoint_accuracy_pct']}%")
    print(f"Mean confidence   : {agg['mean_confidence']}")
    print(f"Latency / frame   : mean {agg['latency_ms']['mean']} ms")
    if args.json:
        Path(args.json).write_text(json.dumps(agg, indent=2))
        print(f"\nMetrics written to {args.json}")


if __name__ == "__main__":
    main()
