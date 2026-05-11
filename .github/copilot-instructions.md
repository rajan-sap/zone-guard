# ZoneGuard — Copilot Instructions

## What This Project Is
Safety-first MVP: detect humans entering red zones via RTSP cameras using YOLOv10, trigger real-time alerts over WebSocket, and let operators review/resolve incidents through a React UI.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, SQLModel, aiosqlite (async SQLite), Uvicorn |
| Detection | YOLOv10 (ultralytics), OpenCV |
| Frontend | React 18, Vite, Tailwind CSS, Zustand, Axios, Lucide |
| Infra | Docker Compose (prod), `.venv` (dev) |

---

## Dev Commands

```bash
# Backend (from workspace root, venv activated)
cd backend
uvicorn app.main:app --reload          # http://localhost:8000
                                        # Swagger: http://localhost:8000/docs

# Frontend
cd frontend
npm install
npm run dev                             # http://localhost:5173

# Docker (prod)
docker-compose up --build               # UI: :80  API: :8000
```

---

## Backend Structure

```
backend/app/
├── main.py               # App factory, lifespan, CORS, route registration, seed cameras
├── core/config.py        # All settings via pydantic-settings / .env
├── db/
│   ├── models.py         # SQLModel entities: Camera, Zone, Incident
│   └── session.py        # AsyncSessionLocal, get_session dep, create_db_and_tables
├── api/routes/
│   ├── cameras.py        # CRUD + /snapshot endpoint
│   ├── zones.py          # CRUD for polygon zones per camera
│   ├── incidents.py      # List, acknowledge, resolve incidents
│   ├── alerts.py         # WebSocket /api/alerts/ws — push-only from server
│   └── detect.py         # Manual detection trigger endpoint
└── services/
    ├── detector.py        # ZoneGuardDetector — Stage A (YOLO) + Stage B (motion)
    ├── motion_analyzer.py # Stage B: LK optical flow → motion vector analysis
    ├── zone_evaluator.py  # point_in_zone() — polygon hit-test (normalized coords)
    ├── camera_worker.py   # Per-camera asyncio task, runs at DETECTION_FPS, 10s cooldown
    └── websocket_manager.py  # ConnectionManager — broadcast to all connected clients
```

## Detection Pipeline

```
frame
 │
 ├─ A. YOLOv10 (detector.py)
 │      → person class bboxes above YOLO_CONFIDENCE_THRESHOLD
 │
 └─ B. Motion-vector analysis (motion_analyzer.py)  per bbox
        1. Detect Shi-Tomasi corners inside the bbox (prev frame)
        2. Track with Lucas-Kanade optical flow (curr frame)
        3. Subtract median background flow (egomotion compensation)
        4. Analyze compensated vectors:
             magnitude          — mean ||v_i||   (is anything moving?)
             magnitude variance — var(||v_i||)  (body parts at different speeds?)
             direction diversity — 1−|mean unit| (organic vs uniform motion?)
        → True   magnitude ≥ threshold AND (variance OR diversity above threshold)
        → False  magnitude ≈ 0  (static photo / screen / mannequin)
        → None   first frame or too few tracked points (no verdict → skip)

 Only True detections proceed to zone evaluation and incident creation.
```

---

## DB Models

### Camera
`id` (str UUID) · `name` · `stream_url` (RTSP/HLS) · `location` · `is_active` · `created_at`
Relations: → many Zones, → many Incidents

### Zone
`id` · `camera_id` (FK) · `name` · `polygon_points` (JSON string of `[[x,y],…]`, normalized 0–1) · `is_active` · `created_at`

### Incident
`id` · `camera_id` (FK) · `zone_id` (FK, nullable) · `status` (`OPEN|ACKNOWLEDGED|RESOLVED|FALSE_POSITIVE`) · `confidence` · `snapshot_path` · `bbox_x/y/w/h` (normalized) · `acknowledged_by` · `acknowledged_at` · `resolved_at` · `created_at`

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cameras/` | List all cameras |
| POST | `/api/cameras/` | Create camera |
| PATCH | `/api/cameras/{id}` | Update camera fields |
| DELETE | `/api/cameras/{id}` | Delete camera |
| GET | `/api/cameras/{id}/snapshot` | JPEG frame from stream |
| GET/POST/DELETE | `/api/zones/` | Zone CRUD |
| GET | `/api/incidents/?status=OPEN` | List incidents, optional status filter |
| PATCH | `/api/incidents/{id}/acknowledge` | Set ACKNOWLEDGED + operator |
| PATCH | `/api/incidents/{id}/resolve` | Set RESOLVED or FALSE_POSITIVE |
| WS | `/api/alerts/ws` | Live alert push (JSON: `AlertEvent`) |
| POST | `/api/detect` | Manual single-frame detection |
| GET | `/health` | Health check |

---

## Alert WebSocket Payload

```json
{
  "event": "PERSON_DETECTED",
  "incident_id": "uuid",
  "camera_id": "cam-001",
  "zone_id": "uuid",
  "confidence": 0.87,
  "snapshot_path": "snapshots/cam-001/xyz.jpg",
  "created_at": "2026-05-11T10:00:00"
}
```

---

## Frontend Structure

```
frontend/src/
├── App.tsx               # Router, nav shell, WebSocket connect on mount
├── store/alertStore.ts   # Zustand store — WS connect, auto-reconnect, last 100 alerts
├── lib/api.ts            # Axios instance with baseURL="/api"
└── pages/
    ├── Dashboard.tsx     # Live alert feed from alertStore
    ├── Incidents.tsx     # Paginated incident table, acknowledge/resolve actions
    ├── Cameras.tsx       # Camera list, add/edit/delete
    ├── CameraFeed.tsx    # Live feed + zone overlay for a single camera
    └── DeviceCamera.tsx  # Browser device camera → manual detect endpoint
└── components/
    └── ZoneEditor.tsx    # Canvas polygon editor for zone creation (normalized coords)
```

---

## Key Config (`.env` or defaults)

| Key | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./safety_first.db` | Switch to `postgresql+asyncpg://…` for prod |
| `ALLOWED_ORIGINS` | `["http://localhost:3000","http://localhost:5173"]` | Add prod domain |
| `YOLO_MODEL_PATH` | `weights/yolov10m.pt` | Must exist before starting |
| `YOLO_CONFIDENCE_THRESHOLD` | `0.65` | Raise to reduce false positives |
| `DETECTION_FPS` | `5` | Frames per second per camera worker |
| `MOTION_MAGNITUDE_THRESHOLD` | `1.5` | Min mean LK flow magnitude (px/frame) to be live |
| `MOTION_VARIANCE_THRESHOLD` | `0.8` | Min variance of per-vector magnitudes |
| `MOTION_DIVERSITY_THRESHOLD` | `0.3` | Min direction diversity (0=coherent, 1=random) |
| `MOTION_MIN_VECTORS` | `6` | Min tracked LK points to issue a verdict |
| `SNAPSHOT_DIR` | `snapshots` | Created automatically |
| `TWILIO_*` | `""` | Optional SMS alerts |

---

## Conventions & Rules

- All DB access is **async** — always use `await session.execute(...)`, never sync SQLModel
- Zone polygon coords are **normalized 0–1** — convert to/from pixel coords at the edge only
- Incident cooldown is **10 seconds per camera** (`COOLDOWN_SECONDS` in `camera_worker.py`)
- YOLO model is **lazy-loaded** — call `detector.load()` once at startup if needed
- WebSocket is **server-push only** — clients send pings only to keep alive
- Frontend API calls go through `src/lib/api.ts` — never use raw `fetch` or hardcode base URL
- Seed cameras (`cam-001/002/003`) are inserted at startup if not present — safe to re-run
