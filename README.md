# ZoneGuard — Red Zone Monitoring & Alert System

## Quick Start (Development)

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API available at http://localhost:8000  
Swagger docs at http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
UI available at http://localhost:5173

### Download YOLOv10 weights
```bash
mkdir weights
python -c "from ultralytics import YOLO; YOLO('yolov10m.pt')"
mv yolov10m.pt weights/
```

---

## Docker (Production)
```bash
docker-compose up --build
```
UI at http://localhost:80

---

## Project Structure
```
safety-first/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app + lifespan
│   │   ├── core/config.py        # Settings (env vars)
│   │   ├── db/
│   │   │   ├── models.py         # SQLModel entities
│   │   │   └── session.py        # Async DB session
│   │   ├── api/routes/
│   │   │   ├── cameras.py        # CRUD cameras
│   │   │   ├── incidents.py      # Incident workflow
│   │   │   ├── zones.py          # Red zone config
│   │   │   └── alerts.py         # WebSocket feed
│   │   └── services/
│   │       ├── detector.py       # ZoneGuardDetector — Stage A (YOLO) + Stage B (motion)
│   │       ├── motion_analyzer.py # LK optical flow → motion vector analysis
│   │       ├── zone_evaluator.py # Point-in-polygon check (normalized coords)
│   │       ├── camera_worker.py  # Per-camera detection loop, 10s cooldown
│   │       └── websocket_manager.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Live alert feed
│   │   │   ├── Incidents.tsx     # Incident management
│   │   │   ├── Cameras.tsx       # Camera config
│   │   │   ├── CameraFeed.tsx    # Live feed + zone overlay
│   │   │   └── DeviceCamera.tsx  # Browser camera → manual detect
│   │   ├── components/
│   │   │   └── ZoneEditor.tsx    # Canvas polygon editor
│   │   ├── store/alertStore.ts   # Zustand + WebSocket
│   │   └── lib/api.ts            # Axios client
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── weights/                      # YOLOv10 .pt files (gitignored)
├── docker-compose.yml
└── README.md
```

---

## Detection Pipeline

```
frame
 │
 ├─ A. YOLOv10  →  person bboxes above confidence threshold
 │
 └─ B. Motion-vector analysis (per bbox)
        1. Shi-Tomasi corners detected inside bbox (prev frame)
        2. Lucas-Kanade optical flow tracks them to current frame
        3. Subtract median background flow (egomotion compensation)
        4. Analyze compensated vectors:
             magnitude          — mean ||v||   (is anything moving?)
             magnitude variance — var(||v||)  (body parts at different speeds?)
             direction diversity — 1−|mean(ê)| (organic vs uniform motion?)
        → True   mag ≥ threshold AND (variance OR diversity above threshold)
        → False  mag ≈ 0  →  static photo / screen / mannequin  →  skipped
        → None   first frame or < MOTION_MIN_VECTORS points     →  skipped
```

Only `True` detections proceed to red-zone evaluation and incident creation.

---

## Environment Variables (backend/.env)

| Variable | Default | Description | Tuning range | stricter toward |
|--|---|---|---|---|
| DATABASE_URL | `sqlite+aiosqlite:///./…` | Async DB connection string | — | — |
| YOLO_MODEL_PATH | `weights/yolov10m.pt` | Path to YOLO weights file | — | — |
| YOLO_CONFIDENCE_THRESHOLD | `0.65` | Min YOLO detection score | 0.5 – 0.95 | higher |
| DETECTION_FPS | `5` | Frames analysed per second per camera | 1 – 30 | — |
| MOTION_MAGNITUDE_THRESHOLD | `1.5` | Min mean LK flow (px/frame) to count as live. Lower catches slow/subtle movement; higher ignores small vibrations. | 0.5 – 5.0 | `2.5 – 4.0` |
| MOTION_VARIANCE_THRESHOLD | `0.8` | Min variance of per-vector magnitudes. Rigid objects and flat video produce low variance; a live body has parts moving at different speeds. | 0.2 – 3.0 | `1.5 – 2.5` |
| MOTION_DIVERSITY_THRESHOLD | `0.3` | Min direction diversity (`0` = uniform, `1` = random). Uniform camera pans and screen playback score near 0; organic human motion scores higher. | 0.1 – 0.7 | `0.4 – 0.6` |
| MOTION_MIN_VECTORS | `6` | Min LK-tracked feature points before a verdict is issued. Higher reduces noisy verdicts on blurry/small bboxes. | 4 – 20 | `10 – 15` |
| SNAPSHOT_DIR | `snapshots` | Directory for saved alert images | — | — |
