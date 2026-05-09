# Interior Live View — Next Steps & Future Work

## 1. Localisation — Recommended Method Upgrades

### Current baseline
SIFT descriptors + BFMatcher with Lowe ratio test, 5-frame rolling majority vote.
Results: ~39% top-1, ~67% neighbour accuracy on test set.
Known weakness: long featureless corridor causes descriptor confusion (conn_1_2 over-prediction).

---

### Tier 1 — Direct upgrades (drop-in replacements)

**SuperPoint + SuperGlue**
- SuperPoint: self-supervised CNN keypoint detector. Generalises across viewpoints and lighting far better than SIFT.
- SuperGlue: graph neural network matcher. Reasons about geometric consistency over the full frame pair rather than per-descriptor, making it robust to repetitive structure.
- Both open source: https://github.com/magicleap/SuperPointPretrainedNetwork and https://github.com/magicleap/SuperGluePretrainedNetwork
- Drop into existing `_localise_core.py` by replacing `make_extractor` / `match_count`.
- Expected top-1 improvement: 15–25 pp over SIFT in indoor settings (literature).

**Sequence-based matching (SeqSLAM / SeqNet)**
- Instead of matching a single query frame, match a short temporal window of frames (e.g. 5–10).
- Your corridor is linear — exactly the topology sequence methods were designed for.
- Zero changes to the index; only the query strategy changes.
- SeqNet paper: https://arxiv.org/abs/2102.08138

---

### Tier 2 — Two-stage retrieval (scalable)

**NetVLAD global descriptor**
- CNN trained end-to-end for place recognition. Produces a compact (~4096-dim) global descriptor per frame.
- Use as a fast first stage: retrieve top-20 candidate frames with NetVLAD, re-rank with local feature matching (SIFT or SuperPoint+SuperGlue).
- Dramatically improves speed vs. doing BFMatcher against the full index.
- Pre-trained weights available via nerfstudio / hloc toolbox.
- Reference: Arandjelovic et al., CVPR 2016.

---

### Tier 3 — Fusion (practical for deployment)

**Wi-Fi / BLE fingerprinting**
- Map RSSI values per node during index construction.
- At query time, narrow candidates to 2–3 nodes using radio, then verify with vision.
- Addresses low-confidence visual intervals (featureless straight corridor).
- Android: WifiManager API. iOS: CNCopyCurrentNetworkInfo (limited) or CoreBluetooth.

---

## 2. Recording — Recommended Methods

### Highest leverage: 360° camera
Use an **Insta360 X4** or **Ricoh Theta Z1** for new recordings.
- Captures every angle simultaneously → one walk covers all viewpoints.
- Eliminates the angle mismatch between training (eye level) and test (lower angle).
- Equirectangular frames can be cropped to any direction for free augmentation.
- Directly compatible with the existing SIFT pipeline (crop patches per node heading).

### Multi-condition passes
Record the same corridor at different times of day (morning / midday / late afternoon).
Indoor lighting varies significantly. These passes become separate augmentation buckets in `build_index.py`.
Zero extra hardware cost.

### LiDAR-assisted recording (iPhone 12 Pro+)
Use **Polycam** or **Record3D** (both free/cheap iOS apps).
Outputs: RGB video + per-frame depth map + camera trajectory.
The depth stream can be used to normalise descriptor scale and provide metric distances between nodes.
Also feeds directly into the 3D pipeline (see Section 3).

### Deliberate loop recordings
Walk each corridor segment twice with a 180° turn between passes.
Provides loop closure data for SLAM-style sequence matching.
Keeps per-node recording time under 2 minutes.

---

## 3. 3D Scan → Synthetic Training Data Pipeline

### Viability: YES — strong thesis contribution

The core idea: reconstruct the space as a neural scene representation, render unlimited synthetic training views from arbitrary poses, use them to augment the feature index. This directly solves the viewpoint and lighting scarcity problem.

### Pipeline

```
Phone recording (video + LiDAR)
        ↓
COLMAP — Structure from Motion → sparse point cloud + camera poses
        ↓
3D Gaussian Splatting (3DGS) or Instant-NGP — neural scene reconstruction
        ↓
Render synthetic views:
  - arbitrary heights (waist / chest / eye / above-head)
  - arbitrary lateral offsets
  - simulated lighting shifts (post-process rendered frames)
        ↓
Feed synthetic frames into build_index.py alongside real frames
        ↓
Evaluate: real-only baseline vs real+synthetic → thesis A/B result
```

### Tools (all open source)

| Tool | Purpose | Link |
|---|---|---|
| COLMAP | SfM/MVS — poses + sparse cloud | https://colmap.github.io |
| Nerfstudio | NeRF + 3DGS training, good API | https://nerf.studio |
| 3D Gaussian Splatting (INRIA) | Faster training than NeRF, real-time rendering | https://github.com/graphdeco-inria/gaussian-splatting |
| Instant-NGP | Fastest NeRF variant, trains in minutes | https://github.com/NVlabs/instant-ngp |
| Meshroom | Full photogrammetry (no GPU needed for SfM) | https://alicevision.org |
| Polycam (iOS) | LiDAR + RGB capture with COLMAP export | polycam.io |
| Record3D (iOS) | LiDAR stream + ARKit poses | record3d.app |

### Compute
All of the above run on a free **Google Colab** T4 GPU.
3DGS trains on a 10-minute corridor walk in ~30 minutes.
NeRF (Instant-NGP) trains in ~5 minutes.

### Thesis framing

This becomes a standalone contribution chapter:
> "We replace manual multi-angle recording with a single LiDAR-assisted scan, reconstruct the space using 3D Gaussian Splatting, and augment the visual place recognition index with pose-diverse synthetic renders. We show a +N pp improvement in top-1 localisation accuracy over the real-data-only baseline."

Clean A/B: `build_index.py --augment` (current geometric augmentation) vs `build_index.py --synthetic-renders` (3DGS renders).

### Main risk
COLMAP struggles with long repetitive corridors (insufficient parallax for feature matching between frames).
**Mitigation:** Walk with deliberate lateral weaving (±30 cm side to side), or use LiDAR depth directly to initialise the point cloud before SfM.

---

## 4. Prioritised Roadmap

| Priority | Item | Effort | Impact |
|---|---|---|---|
| 1 | Switch to SuperPoint + SuperGlue | 1–2 days | High — direct accuracy gain |
| 2 | 360° camera re-recording | 1 day | High — eliminates angle mismatch |
| 3 | Multi-lighting passes | 2 hours | Medium — free robustness |
| 4 | Sequence-based query (SeqNet) | 1–2 days | High on linear corridor |
| 5 | COLMAP + 3DGS synthetic renders | 3–5 days | Very high — novel contribution |
| 6 | Wi-Fi fingerprint fusion | 2–3 days | Medium — practical robustness |
