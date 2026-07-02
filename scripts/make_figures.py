"""
Generate Chapter 6 (Evaluation) figures from evaluate.py JSON outputs.

Usage:
    python scripts/make_figures.py data/eval_sift.json data/eval_orb.json

Produces, in pics/chapter6/ :
    recall_per_node.pdf   per-node recall of the primary (first) index
    smoothing.pdf         per-frame vs temporally smoothed accuracy
    sift_vs_orb.pdf       accuracy comparison of the two extractors
    latency.pdf           mean / p95 query latency of the two extractors
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT    = Path(__file__).parent.parent
OUT_DIR = ROOT / "pics" / "chapter6"


def load(paths: list[str]) -> list[dict]:
    return [json.loads(Path(p).read_text()) for p in paths]


def fig_recall_per_node(primary: dict) -> None:
    nodes  = list(primary["per_node"].keys())
    recall = [100 * c / t if t else 0 for c, t in primary["per_node"].values()]
    fig, ax = plt.subplots(figsize=(7, 3.2))
    ax.bar(range(len(nodes)), recall, color="#4477aa")
    ax.set_xticks(range(len(nodes)))
    ax.set_xticklabels(nodes, rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("Recall (%)")
    ax.set_ylim(0, 100)
    ax.set_title(f"Per-node recall ({primary['feature_type']}, Top-1)")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "recall_per_node.pdf")
    plt.close(fig)


def fig_smoothing(primary: dict) -> None:
    acc = primary["accuracy_pct"]
    labels = ["Per-frame\n(voted)", f"Smoothed\n(window {primary['smooth_window']})"]
    vals   = [acc["voted"], acc["voted_smoothed"]]
    fig, ax = plt.subplots(figsize=(4.2, 3.4))
    bars = ax.bar(labels, vals, color=["#bbbbbb", "#4477aa"])
    ax.set_ylabel("Accuracy (%)")
    ax.set_ylim(0, 100)
    ax.set_title(f"Effect of temporal smoothing ({primary['feature_type']})")
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 1, f"{v:.1f}", ha="center", fontsize=9)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "smoothing.pdf")
    plt.close(fig)


def fig_sift_vs_orb(results: list[dict]) -> None:
    metrics = ["top1", "voted", "voted_smoothed"]
    labels  = ["Top-1", "Voted", "Voted+smooth"]
    colors  = ["#4477aa", "#ee6677", "#228833", "#ccbb44"]
    x = range(len(metrics))
    w = 0.8 / max(1, len(results))
    fig, ax = plt.subplots(figsize=(6, 3.4))
    for i, r in enumerate(results):
        vals = [r["accuracy_pct"][m] for m in metrics]
        ax.bar([xi + i * w for xi in x], vals, width=w,
               label=r["feature_type"], color=colors[i % len(colors)])
    ax.set_xticks([xi + w * (len(results) - 1) / 2 for xi in x])
    ax.set_xticklabels(labels)
    ax.set_ylabel("Accuracy (%)")
    ax.set_ylim(0, 100)
    ax.set_title("Localization accuracy: SIFT vs ORB")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "sift_vs_orb.pdf")
    plt.close(fig)


def fig_latency(results: list[dict]) -> None:
    names = [r["feature_type"] for r in results]
    means = [r["latency_ms"]["mean"] for r in results]
    p95s  = [r["latency_ms"]["p95"]  for r in results]
    x = range(len(names))
    w = 0.35
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    ax.bar([xi - w / 2 for xi in x], means, width=w, label="mean", color="#4477aa")
    ax.bar([xi + w / 2 for xi in x], p95s,  width=w, label="p95",  color="#ee6677")
    ax.set_xticks(list(x))
    ax.set_xticklabels(names)
    ax.set_ylabel("Latency per query (ms)")
    ax.set_title("Query latency per extractor")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "latency.pdf")
    plt.close(fig)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/make_figures.py <eval1.json> [eval2.json ...]")
        return
    results = load(sys.argv[1:])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    fig_recall_per_node(results[0])
    fig_smoothing(results[0])
    if len(results) >= 2:
        fig_sift_vs_orb(results)
        fig_latency(results)

    print(f"Figures written to {OUT_DIR}")


if __name__ == "__main__":
    main()
