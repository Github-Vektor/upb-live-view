# Interior Live View — Thesis Project

## Overview

A browser-based indoor navigation app using the phone camera and augmented reality to overlay directional arrows in the user's view — a Google Live View clone specialised for interior spaces (universities, malls, hospitals, etc.).

## Current Assets

| Asset | Description |
|---|---|
| `corridor_loop.mp4` | 4K 30fps. Full corridor walk: one way → turn → return → turn → stop. Used as the reference map. |
| `corridor_test.mp4` | 4K 30fps. Broken/incomplete recording from a lower angle. Used for localisation testing. |
| `room_*.mp4` | ~30 s 4K 30fps circular pan recordings of each room/intersection node. |

### Space Model

- The space is a **long corridor** with **rooms branching off sideways** at intervals.
- Each room is a **node** in the navigation graph.
- Rooms are currently recorded as 360°-style circular pans (~30 s each).
- The corridor recordings link the nodes.

---

## Tech Stack (planned)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + Vite (TypeScript) | Fast iteration, component model suits AR overlay |
| AR overlay | WebXR Device API + Three.js / `@ar-js-org/ar.js` | Browser-native, no app install |
| Camera access | `getUserMedia` (MediaDevices API) | Works in mobile Chrome/Safari |
| Visual localisation | Custom VPR pipeline or pre-computed feature index | See phases below |
| Graph / routing | Dijkstra on a hand-authored JSON node graph | Sufficient for thesis scope |
| Backend (optional) | Node.js / FastAPI for feature index serving | Offload heavy compute from phone |

---

## Implementation Phases

### Phase 0 — Project Scaffold & Tooling
**Goal:** Working browser shell with camera feed and AR canvas overlay.

- [ ] Vite + React + TypeScript project setup
- [ ] Camera feed via `getUserMedia`, rendered to `<video>` element
- [ ] `<canvas>` overlay (Three.js or plain 2D canvas) composited on top of video
- [ ] Toggle UI: camera view ↔ map/menu view
- [ ] Responsive layout for portrait mobile
- [ ] Dev tooling: ESLint, Prettier, Vitest

**Deliverable:** Phone browser shows live camera with a static test arrow rendered on top.

---

### Phase 1 — Space Model & Navigation Graph
**Goal:** Define the navigable space as a graph and implement routing.

- [ ] Define node schema (id, label, position hint, connected nodes, edge weights)
- [ ] Hand-author JSON graph from corridor + room recordings
- [ ] Dijkstra shortest-path implementation
- [ ] Route serialisation: ordered list of (node, heading, action) tuples
- [ ] Simple text turn-by-turn UI (no AR yet) for verification

**Deliverable:** Given start node + destination, app outputs correct step list.

---

### Phase 2 — Reference Map Construction (Offline)
**Goal:** Build a visual index from the corridor recording for later localisation.

- [ ] Extract frames from `corridor_loop.mp4` at ~1 fps (FFmpeg script)
- [ ] Compute local features per frame: **SuperPoint** (learned) or ORB (classical)
- [ ] Store feature descriptors + frame metadata (timestamp, corridor position estimate) in an index file (`.bin` or SQLite)
- [ ] Optionally generate a coarse VGG/NetVLAD global descriptor per frame for fast candidate retrieval
- [ ] Room circular recordings → same pipeline, tagged with node id

**Deliverable:** Offline index file representing the space visually.

---

### Phase 3 — Visual Place Recognition (Localisation)
**Goal:** Given a query camera frame, identify where the user is in the graph.

- [ ] Query pipeline: capture frame → compute descriptors → nearest-neighbour search in index
- [ ] Evaluate on `corridor_test.mp4` (lower angle, harder): measure top-1 / top-5 recall
- [ ] If recall < 80%: add pose-robust augmentations (brightness jitter, slight perspective warp) to index frames
- [ ] Return: (estimated node, confidence score)
- [ ] Smooth localisation over time with a simple Kalman or exponential filter (prevent flicker)

**Deliverable:** Localisation module with quantitative accuracy numbers for thesis.

---

### Phase 4 — AR Arrow Rendering
**Goal:** Project a navigation arrow into the camera view anchored to the real world.

- [ ] Estimate phone orientation via `DeviceOrientationEvent` (compass + gyro)
- [ ] Compute arrow heading from current node → next node in route
- [ ] Render arrow with Three.js: world-space direction → NDC projection via orientation matrix
- [ ] Arrow design: semi-transparent, pulsing, floor-projected style
- [ ] Handle uncertainty: dim arrow / show "scanning" state when confidence is low
- [ ] Test on corridor loop recording played back through a second phone screen (proxy for real walk)

**Deliverable:** Live AR arrow tracks correct direction as user moves.

---

### Phase 5 — Integration & UX
**Goal:** Full end-to-end flow: pick destination → walk → AR guidance.

- [ ] Destination picker UI (searchable node list or simple map schematic)
- [ ] Route computed on selection, first instruction shown immediately
- [ ] Automatic node advancement: when localisation transitions from node A → node B on the route, step forward
- [ ] Arrival detection and confirmation screen
- [ ] Edge cases: user goes off-route → re-route
- [ ] "Lower angle" robustness: validate with test recording

**Deliverable:** A user can complete a full simulated navigation session in the browser.

---

### Phase 6 — Evaluation & Thesis Write-up Prep
**Goal:** Gather the numbers and user-study artefacts needed for the thesis.

- [ ] Localisation accuracy table (top-1/top-5 recall, median positional error)
- [ ] Latency profiling: frame → localisation → arrow update (target < 150 ms)
- [ ] Small usability test (3-5 participants walking the real corridor with the app)
- [ ] Video demo of the full flow
- [ ] Comparison section vs Google Live View (feature table)

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WebXR not available on all mobile browsers | Fall back to `DeviceOrientation` + canvas 2D overlay |
| Localisation fails at different times of day / lighting | Add illumination-normalised descriptors; note as limitation |
| 4K video too heavy for on-device feature extraction | Resize query frames to 480p before feature computation |
| Safari `getUserMedia` restrictions | Test early; use HTTPS (required) and explicit permission prompts |
| Recording angle mismatch (test vs reference) | Augment reference index with synthetic viewpoint perturbations |

---

## Directory Structure (target)

```
interior-live-view/
├── public/
├── src/
│   ├── ar/          # Arrow rendering, Three.js scene
│   ├── localisation/ # Feature matching, VPR pipeline
│   ├── navigation/  # Graph, routing, node types
│   ├── ui/          # React components
│   └── main.tsx
├── scripts/         # Offline: frame extraction, index building
├── data/
│   ├── graph.json
│   └── feature_index/
├── recordings/      # corridor_loop.mp4, corridor_test.mp4, room_*.mp4
├── CONTEXT.md       # ← this file
└── package.json
```
