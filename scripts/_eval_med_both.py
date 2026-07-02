"""One-pass transition eval for BOTH extractors (decode each frame once).

Decoding 4K frames dominates cost, so this shares the decode between the SIFT and
ORB indexes and only the feature extraction/matching differs. Resumable per clip.

    python scripts/_eval_med_both.py --dir <clips> --sift <db> --orb <db> --fps 0.5 --json <out>
"""
from __future__ import annotations
import argparse, json, statistics, sys, time
from collections import Counter
from pathlib import Path
import cv2

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import load_index, make_matcher, make_extractor, resize_gray, match_count, MIN_MATCHES, TOP_K
from evaluate_transitions import endpoints_from_name

def vote(gray, index, extractor, bf):
    _, descs = extractor.detectAndCompute(gray, None)
    if descs is None: return None, 0.0
    s = [(match_count(descs, ref, bf), nid) for _, nid, ref in index]
    s = [(g, nid) for g, nid in s if g >= MIN_MATCHES]
    if not s: return None, 0.0
    s.sort(reverse=True)
    top = [nid for _, nid in s[:TOP_K]]
    v = Counter(top).most_common(1)[0][0]
    return v, top.count(v) / len(top)

def agg(per, key):
    fr = sum(c["frames"] for c in per.values())
    co = sum(c[key+"_correct"] for c in per.values())
    return round(100*co/fr, 1) if fr else 0.0, fr, co

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True); ap.add_argument("--sift", required=True)
    ap.add_argument("--orb", required=True); ap.add_argument("--fps", type=float, default=0.5)
    ap.add_argument("--json", required=True)
    a = ap.parse_args()

    clips = [(f, ep) for f in sorted(Path(a.dir).glob("*.mp4")) if (ep := endpoints_from_name(f.stem))]
    sift_index, sm = load_index(Path(a.sift)); se = make_extractor(sm); sbf = make_matcher(sm)
    orb_index,  om = load_index(Path(a.orb));  oe = make_extractor(om); obf = make_matcher(om)

    per = {}
    if Path(a.json).exists():
        try: per = json.loads(Path(a.json).read_text()).get("per_clip", {})
        except json.JSONDecodeError: per = {}

    for path, (na, nb) in clips:
        if path.stem in per: continue
        cap = cv2.VideoCapture(str(path)); fps = cap.get(5) or 30; n = int(cap.get(7))
        step = max(1, int(fps / a.fps)); idx = 0
        fr = sc = oc = 0; sconf = []; oconf = []; slat = []; olat = []
        while idx < n:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx); ok, f = cap.read()
            if not ok: break
            g = resize_gray(f)
            t = time.perf_counter(); sp, scf = vote(g, sift_index, se, sbf); slat.append((time.perf_counter()-t)*1000)
            t = time.perf_counter(); op, ocf = vote(g, orb_index, oe, obf);  olat.append((time.perf_counter()-t)*1000)
            fr += 1
            if sp in (na, nb): sc += 1; sconf.append(scf)
            if op in (na, nb): oc += 1; oconf.append(ocf)
            idx += step
        cap.release()
        per[path.stem] = {"between": [na, nb], "frames": fr,
            "sift_correct": sc, "orb_correct": oc,
            "sift_acc": round(100*sc/fr,1) if fr else 0, "orb_acc": round(100*oc/fr,1) if fr else 0,
            "sift_conf": round(statistics.fmean(sconf),3) if sconf else 0, "orb_conf": round(statistics.fmean(oconf),3) if oconf else 0,
            "sift_lat": round(statistics.fmean(slat),1) if slat else 0, "orb_lat": round(statistics.fmean(olat),1) if olat else 0}
        sa,_,_ = agg(per,"sift"); oa,_,_ = agg(per,"orb")
        out = {"clips_done": len(per), "sift_endpoint_acc": sa, "orb_endpoint_acc": oa, "per_clip": per}
        Path(a.json).write_text(json.dumps(out, indent=2))
        print(f"{path.stem:<16} sift {per[path.stem]['sift_acc']:>5}%  orb {per[path.stem]['orb_acc']:>5}%  ({len(per)}/16)")

    sa,sf,scc = agg(per,"sift"); oa,of,occ = agg(per,"orb")
    print(f"\nSIFT endpoint acc: {sa}%  ({scc}/{sf})")
    print(f"ORB  endpoint acc: {oa}%  ({occ}/{of})")

if __name__ == "__main__":
    main()
