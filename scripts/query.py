"""
Query the index with a single image — for offline testing.

Usage:
    python scripts/query.py path/to/frame.jpg
    python scripts/query.py path/to/frame.jpg --top 10
"""

import argparse
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).parent))
from _localise_core import load_index, make_matcher, make_extractor, resize_gray, localise

ROOT    = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "feature_index.db"


def main():
    parser = argparse.ArgumentParser(description="Query the feature index with a single image.")
    parser.add_argument("image", help="Path to query image (JPEG/PNG)")
    parser.add_argument("--top", type=int, default=5)
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"ERROR: index not found at {DB_PATH}. Run build_index.py first.")
        return

    index, meta = load_index(DB_PATH)
    extractor   = make_extractor(meta)
    bf          = make_matcher(meta)
    print(f"{len(index)} frames in index ({meta.get('feature_type', 'ORB')}).\n")

    jpeg = Path(args.image).read_bytes()
    result = localise(jpeg, index, extractor, bf)

    if "error" in result:
        print(f"Error: {result['error']}")
        return

    print(f"Predicted node : {result['node_id']}  (confidence {result['confidence']:.0%})")
    print(f"\nTop {args.top} matches:")
    print(f"  {'matches':>7}  {'node':<20}")
    print(f"  {'-'*7}  {'-'*20}")
    for entry in result["top"][:args.top]:
        print(f"  {entry['matches']:>7}  {entry['node_id']:<20}")


if __name__ == "__main__":
    main()
