import { useEffect, useRef, useState, useCallback } from "react";
import api from "../lib/api";
import {
  Camera, CameraOff, AlertTriangle, CheckCircle, Activity,
  User, Volume2, VolumeX, Pencil, X, Trash2, Undo2, Check,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BBox {
  cx: number; cy: number; w: number; h: number;
  confidence: number; in_zone: boolean; zone_id: string | null;
}
interface CameraOption { id: string; name: string; location: string; }
interface Zone { id: string; name: string; polygon_points: string; is_active: boolean; }
type NPoint = [number, number]; // normalized [0-1, 0-1]

const DETECTION_MS = 300;
const ZONE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];
const CLOSE_R = 14; // px to snap-close polygon

// ── Coordinate helpers ────────────────────────────────────────────────────────

/** Compute the letterbox-corrected video rect inside the canvas element */
function videoRect(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
  const va = vw / vh, ca = cw / ch;
  if (va > ca) {
    const h = cw / va;
    return { x: 0, y: (ch - h) / 2, w: cw, h };
  } else {
    const w = ch * va;
    return { x: (cw - w) / 2, y: 0, w, h: ch };
  }
}

function cssToNorm(cx: number, cy: number, r: ReturnType<typeof videoRect>): NPoint {
  return [(cx - r.x) / r.w, (cy - r.y) / r.h];
}
function normToPx(n: NPoint, r: ReturnType<typeof videoRect>) {
  return { x: r.x + n[0] * r.w, y: r.y + n[1] * r.h };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  fixedCameraId?: string;
  fixedCameraName?: string;
}

export default function DeviceCamera({ fixedCameraId, fixedCameraName }: Props = {}) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const detectRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef     = useRef<number>(0);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // camera / stream
  const [active, setActive]       = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [cameras, setCameras]     = useState<CameraOption[]>([]);
  const [cameraId, setCameraId]   = useState(fixedCameraId ?? "");

  // detection
  const [detections, setDetections] = useState<BBox[]>([]);
  const [violation, setViolation]   = useState(false);
  const detectionsRef = useRef<BBox[]>([]);   // always-fresh ref for render loop
  useEffect(() => { detectionsRef.current = detections; }, [detections]);

  // zones
  const [zones, setZones]       = useState<Zone[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft]       = useState<NPoint[]>([]);
  const [draftClosed, setDraftClosed] = useState(false);
  const [zoneName, setZoneName] = useState("Red Zone 1");
  const [savingZone, setSavingZone] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // mouse for rubber-band (CSS coords relative to canvas)
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  // audio
  const [muted, setMuted] = useState(false);

  // ── Load cameras (only when no fixed camera) ──────────────────────────────────────
  useEffect(() => {
    if (fixedCameraId) return; // fixed mode — no need to list cameras
    api.get<CameraOption[]>("/cameras/").then(({ data }) => {
      setCameras(data);
      if (data.length > 0) setCameraId((prev) => prev || data[0].id);
      else setCameraId((prev) => prev || "device");
    }).catch(() => { setCameraId((prev) => prev || "device"); });
  }, [fixedCameraId]);

  // ── Load zones for selected camera ───────────────────────────────────────────
  const loadZones = useCallback(async (id: string) => {
    const effectiveId = id || "device";
    try {
      const { data } = await api.get<Zone[]>(`/zones/?camera_id=${effectiveId}`);
      setZones(data);
    } catch { setZones([]); }
  }, []);

  useEffect(() => { loadZones(cameraId); }, [cameraId, loadZones]);

  // ── Alarm ─────────────────────────────────────────────────────────────────────
  const playBeep = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "square"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.start(); osc.stop(ctx.currentTime + 0.22);
  }, []);

  useEffect(() => {
    if (violation && !muted) {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed")
        audioCtxRef.current = new AudioContext();
      audioCtxRef.current.resume().then(() => {
        playBeep();
        alarmTimerRef.current = setInterval(playBeep, 800);
      });
    } else {
      clearInterval(alarmTimerRef.current!); alarmTimerRef.current = null;
    }
    return () => { clearInterval(alarmTimerRef.current!); };
  }, [violation, muted, playBeep]);

  useEffect(() => () => { clearInterval(alarmTimerRef.current!); audioCtxRef.current?.close(); }, []);

  // ── Camera start / stop ───────────────────────────────────────────────────────
  const startCamera = async () => {
    setError(null);
    if (!window.isSecureContext) { setError("Camera requires a secure context (localhost or HTTPS)."); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError("getUserMedia not supported in this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setActive(true);
    } catch (e: unknown) {
      const n = e instanceof DOMException ? e.name : "";
      setError(
        n === "NotAllowedError" ? "Permission denied — allow camera in address bar then refresh." :
        n === "NotFoundError"   ? "No camera device found." :
        n === "NotReadableError"? "Camera already in use by another app." :
        e instanceof Error ? `${e.name}: ${e.message}` : "Unknown camera error."
      );
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    clearInterval(detectRef.current!); detectRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setActive(false); setDetections([]); setViolation(false);
    setVideoReady(false); setDraft([]); setDraftClosed(false);
    const ov = overlayRef.current;
    if (ov) ov.getContext("2d")?.clearRect(0, 0, ov.width, ov.height);
  };

  // ── Detection loop ────────────────────────────────────────────────────────────
  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current, cap = captureRef.current;
    if (!video || !cap || video.readyState < 2) return;
    const w = video.videoWidth, h = video.videoHeight;
    cap.width = w; cap.height = h;
    cap.getContext("2d")!.drawImage(video, 0, 0, w, h);
    const base64 = cap.toDataURL("image/jpeg", 0.8).split(",")[1];
    const effectiveCamId = cameraId || "device";
    try {
      const { data } = await api.post<{ detections: BBox[]; violation: boolean }>(
        "/detect/frame", { frame: base64, camera_id: effectiveCamId }
      );
      setDetections(data.detections);
      setViolation(data.violation);
    } catch { /* skip frame */ }
  }, [cameraId]);

  useEffect(() => {
    if (active && videoReady) {
      detectRef.current = setInterval(captureAndDetect, DETECTION_MS);
    }
    return () => { clearInterval(detectRef.current!); };
  }, [active, videoReady, captureAndDetect]);

  // ── Render loop (canvas) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !videoReady) return;
    const render = () => {
      const canvas = overlayRef.current, video = videoRef.current;
      if (!canvas || !video) { rafRef.current = requestAnimationFrame(render); return; }

      // Sync canvas resolution to its CSS display size
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(canvas.clientWidth * dpr);
      const ch = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, cw, ch);
      const vr = videoRect(canvas, video);

      // ── Saved zones ──
      zones.forEach((z, i) => {
        const color = ZONE_COLORS[i % ZONE_COLORS.length];
        try {
          const pts: NPoint[] = JSON.parse(z.polygon_points);
          ctx.beginPath();
          pts.forEach((p, j) => {
            const { x, y } = normToPx(p, vr);
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fillStyle = color + "22";
          ctx.fill();
          ctx.setLineDash([8, 5]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 * dpr;
          ctx.stroke();
          ctx.setLineDash([]);

          // zone name label
          const cx2 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
          const cy2 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          const { x: lx, y: ly } = normToPx([cx2, cy2], vr);
          ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(z.name, lx + dpr, ly + dpr);
          ctx.fillStyle = color;
          ctx.fillText(z.name, lx, ly);
          ctx.textAlign = "left";
        } catch { /* skip */ }
      });

      // ── Draft polygon ──
      if (draft.length > 0) {
        const mouse = mouseRef.current;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([]);

        if (draftClosed) {
          ctx.beginPath();
          draft.forEach((p, j) => {
            const { x, y } = normToPx(p, vr);
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fillStyle = "rgba(239,68,68,0.18)";
          ctx.fill();
          ctx.stroke();
        } else {
          // edges
          ctx.beginPath();
          draft.forEach((p, j) => {
            const { x, y } = normToPx(p, vr);
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();

          // rubber-band to cursor
          if (mouse) {
            const last = normToPx(draft[draft.length - 1], vr);
            const first = normToPx(draft[0], vr);
            const nearFirst = draft.length >= 3 && dist(mouse, first) < CLOSE_R;

            ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(mouse.x, mouse.y);
            ctx.setLineDash([7, 5]); ctx.strokeStyle = "rgba(239,68,68,0.5)"; ctx.stroke();

            if (nearFirst) {
              ctx.beginPath(); ctx.moveTo(mouse.x, mouse.y); ctx.lineTo(first.x, first.y);
              ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(251,191,36,0.8)"; ctx.stroke();
            }
            ctx.setLineDash([]);
          }
        }

        // vertex dots
        draft.forEach((p, i) => {
          const { x, y } = normToPx(p, vr);
          const mouse2 = mouseRef.current;
          const isFirst = i === 0;
          const hover = isFirst && !draftClosed && mouse2 && dist(mouse2, { x, y }) < CLOSE_R;
          ctx.beginPath();
          ctx.arc(x, y, (hover ? 9 : isFirst ? 6 : 4) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = hover ? "#fbbf24" : isFirst ? "#ef4444" : "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        });
      }

      // ── Detection bboxes ──
      const dets = detectionsRef.current;
      for (const d of dets) {
        const tl = normToPx([d.cx - d.w / 2, d.cy - d.h / 2], vr);
        const bw = d.w * vr.w, bh = d.h * vr.h;
        const color = d.in_zone ? "#ef4444" : "#22c55e";
        const arm = Math.min(bw, bh) * 0.18;

        ctx.strokeStyle = color; ctx.lineWidth = 2.5 * dpr; ctx.lineCap = "round";
        const corners: [number, number, number, number, number, number][] = [
          [tl.x, tl.y + arm, tl.x, tl.y, tl.x + arm, tl.y],
          [tl.x + bw - arm, tl.y, tl.x + bw, tl.y, tl.x + bw, tl.y + arm],
          [tl.x + bw, tl.y + bh - arm, tl.x + bw, tl.y + bh, tl.x + bw - arm, tl.y + bh],
          [tl.x + arm, tl.y + bh, tl.x, tl.y + bh, tl.x, tl.y + bh - arm],
        ];
        for (const [x1, y1, x2, y2, x3, y3] of corners) {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
        }
        ctx.fillStyle = d.in_zone ? "rgba(239,68,68,0.07)" : "rgba(34,197,94,0.05)";
        ctx.fillRect(tl.x, tl.y, bw, bh);

        const label = `${(d.confidence * 100).toFixed(0)}%${d.in_zone ? "  ⚠ ZONE" : ""}`;
        ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
        const tw = ctx.measureText(label).width + 10 * dpr;
        const ly = tl.y > 24 * dpr ? tl.y - 6 * dpr : tl.y + bh + 20 * dpr;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(tl.x, ly - 16 * dpr, tw, 18 * dpr, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, tl.x + 5 * dpr, ly - 3 * dpr);
      }

      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, videoReady, zones, draft, draftClosed]);

  // ── Zone drawing mouse handlers ───────────────────────────────────────────────
  // Sync canvas pixel dimensions (same logic as RAF loop) and compute video rect
  const syncedVideoRect = (canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    return videoRect(canvas, video);
  };

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawMode || draftClosed) return;
    const canvas = overlayRef.current!, video = videoRef.current!;
    const pos = getCanvasPos(e);
    const vr = syncedVideoRect(canvas, video);

    // Reject clicks outside the video content area
    if (pos.x < vr.x || pos.x > vr.x + vr.w || pos.y < vr.y || pos.y > vr.y + vr.h) return;

    if (draft.length >= 3) {
      const firstPx = normToPx(draft[0], vr);
      if (dist(pos, firstPx) < CLOSE_R) { setDraftClosed(true); return; }
    }
    setDraft((prev) => [...prev, cssToNorm(pos.x, pos.y, vr)]);
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawMode) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cx = (e.clientX - r.left) * dpr;
    const cy = (e.clientY - r.top) * dpr;
    mouseRef.current = { x: cx, y: cy };

    // Update cursor: crosshair inside video area, not-allowed outside
    const canvas = overlayRef.current!, video = videoRef.current!;
    if (canvas && video) {
      const vr = syncedVideoRect(canvas, video);
      const inside = cx >= vr.x && cx <= vr.x + vr.w && cy >= vr.y && cy <= vr.y + vr.h;
      e.currentTarget.style.cursor = inside ? "crosshair" : "not-allowed";
    }
  };

  const handleCanvasLeave = () => { mouseRef.current = null; };

  const handleUndo = () => {
    if (draftClosed) { setDraftClosed(false); return; }
    setDraft((p) => p.slice(0, -1));
  };

  const handleClearDraft = () => { setDraft([]); setDraftClosed(false); };

  const handleSaveZone = async () => {
    if (!draftClosed || draft.length < 3) return;
    setSaveError(null);
    setSaveSuccess(false);
    setSavingZone(true);
    const effectiveCameraId = cameraId || "device";
    try {
      await api.post("/zones/", {
        camera_id: effectiveCameraId,
        name: zoneName.trim() || "Zone",
        polygon_points: JSON.stringify(draft.map(([x, y]) => [
          parseFloat(x.toFixed(4)), parseFloat(y.toFixed(4)),
        ])),
        is_active: true,
      });
      setDraft([]); setDraftClosed(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadZones(effectiveCameraId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message :
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Save failed";
      setSaveError(msg);
    } finally { setSavingZone(false); }
  };

  const handleDeleteZone = async (id: string) => {
    await api.delete(`/zones/${id}`);
    loadZones(cameraId);
  };

  const inZoneCount = detections.filter((d) => d.in_zone).length;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 h-full">

      {/* Video viewport */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {error && (
          <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm shrink-0">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />{error}
          </div>
        )}

        <div
          className={`relative flex-1 rounded-2xl overflow-hidden bg-black border transition-colors ${
            violation ? "border-red-500/60 shadow-lg shadow-red-900/30"
            : active   ? "border-white/10"
            : "border-white/[0.06]"
          }`}
          style={{ minHeight: 320 }}
        >
          {violation && <div className="absolute inset-0 rounded-2xl border-2 border-red-500 animate-pulse pointer-events-none z-20" />}

          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            autoPlay muted playsInline
            onCanPlay={() => setVideoReady(true)}
          />

          {/* Single overlay canvas — interactive in draw mode */}
          <canvas
            ref={overlayRef}
            className={`absolute inset-0 w-full h-full ${drawMode ? "" : "pointer-events-none"}`}
            style={drawMode ? { cursor: "crosshair" } : undefined}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseEnter={(e) => { if (drawMode) e.currentTarget.style.cursor = "crosshair"; }}
            onMouseLeave={handleCanvasLeave}
          />

          {!active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
              <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <Camera size={32} className="text-gray-600" />
              </div>
              <p className="text-sm text-gray-400">Start the camera to begin monitoring</p>
            </div>
          )}
          {active && !videoReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 z-10">
              <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-500">Initializing camera…</p>
            </div>
          )}
          {active && videoReady && (
            <div className="absolute top-4 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-xs text-white font-medium backdrop-blur-sm z-10">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
              LIVE
            </div>
          )}

          {/* Draw mode hint bar */}
          {drawMode && active && videoReady && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/70 border border-amber-500/30 text-xs text-amber-300 backdrop-blur-sm z-10 whitespace-nowrap">
              {draft.length === 0
                ? "Click to place first vertex"
                : draftClosed
                ? "Polygon closed — save or clear"
                : draft.length >= 3
                ? `${draft.length} points — hover first point to close`
                : `${draft.length} point${draft.length > 1 ? "s" : ""} — keep clicking`}
            </div>
          )}

          {active && videoReady && violation && !drawMode && (
            <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/90 backdrop-blur-sm text-white text-sm font-semibold z-10">
              <AlertTriangle size={15} />
              PERSON DETECTED IN RED ZONE
              {inZoneCount > 1 && <span className="ml-auto text-red-100 font-normal">{inZoneCount} persons</span>}
            </div>
          )}
        </div>
        <canvas ref={captureRef} className="hidden" />
      </div>

      {/* Right panel */}
      <div className="w-72 shrink-0 flex flex-col gap-4 overflow-y-auto">

        {/* Camera + controls */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Camera</p>

          {/* Fixed camera name (when opened from camera card) */}
          {fixedCameraId ? (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08]">
              <Camera size={13} className="text-gray-500 shrink-0" />
              <span className="text-sm text-gray-200 font-medium truncate">{fixedCameraName ?? fixedCameraId}</span>
            </div>
          ) : cameras.length > 0 ? (
            <select
              className="bg-white/[0.05] border border-white/[0.08] text-sm text-white px-3 py-2 rounded-xl outline-none focus:border-red-500/40 transition-colors disabled:opacity-50"
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              disabled={active}
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0c0f18]">{c.name} — {c.location}</option>
              ))}
            </select>
          ) : (
            <input
              className="bg-white/[0.05] border border-white/[0.08] text-sm text-white px-3 py-2 rounded-xl outline-none focus:border-red-500/40 transition-colors placeholder:text-gray-700"
              placeholder="Camera ID"
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              disabled={active}
            />
          )}
          <div className="flex gap-2">
            {!active ? (
              <button onClick={startCamera}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-medium text-white transition-colors">
                <Camera size={15} /> Start
              </button>
            ) : (
              <button onClick={stopCamera}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/[0.07] hover:bg-white/[0.10] rounded-xl text-sm font-medium text-gray-300 border border-white/[0.08] transition-colors">
                <CameraOff size={15} /> Stop
              </button>
            )}
            <button onClick={() => setMuted((m) => !m)}
              className={`px-3 rounded-xl border text-xs transition-colors ${
                muted ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                : "bg-white/[0.04] border-white/[0.06] text-gray-500 hover:text-gray-300"
              }`}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>

        {/* Zone status */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Zone Status</p>
          {!active ? (
            <div className="flex items-center gap-2 text-gray-700 text-sm"><Activity size={14} /><span>Not monitoring</span></div>
          ) : !videoReady ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" /><span>Starting…</span>
            </div>
          ) : violation ? (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={15} className="text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-300">Violation Detected</p>
                <p className="text-[10px] text-red-500 mt-0.5">{inZoneCount} person{inZoneCount !== 1 ? "s" : ""} in red zone</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
              <CheckCircle size={15} className="text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-300">All Clear</p>
                <p className="text-[10px] text-green-600 mt-0.5">No violations detected</p>
              </div>
            </div>
          )}
        </div>

        {/* Zone editor */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Zones</p>
            <button
              onClick={() => { setDrawMode((d) => !d); setDraft([]); setDraftClosed(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                drawMode
                  ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                  : "bg-white/[0.05] border-white/[0.08] text-gray-400 hover:text-white"
              }`}
            >
              {drawMode ? <><X size={10} /> Done</> : <><Pencil size={10} /> Draw</>}
            </button>
          </div>

          {/* Drawing controls (only in draw mode) */}
          {drawMode && (
            <div className="flex flex-col gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
              <p className="text-[10px] text-amber-500 font-medium">
                {!active
                  ? "⚠ Start the camera first, then click on the video to draw"
                  : draft.length === 0
                  ? "Click on the live video to place vertices"
                  : draftClosed
                  ? "Polygon closed — name it and save"
                  : draft.length >= 3
                  ? `${draft.length} points — hover the first point to close`
                  : `${draft.length} point${draft.length > 1 ? "s" : ""} — keep clicking`}
              </p>
              <input
                className="bg-white/[0.05] border border-white/[0.08] text-xs text-white px-2.5 py-1.5 rounded-lg outline-none focus:border-red-500/40 transition-colors placeholder:text-gray-700"
                placeholder="Zone name…"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
              />
              <div className="flex gap-1.5">
                <button onClick={handleUndo} disabled={draft.length === 0}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg bg-white/[0.05] hover:bg-white/[0.10] text-gray-400 disabled:opacity-30 transition-colors">
                  <Undo2 size={10} /> Undo
                </button>
                <button onClick={handleClearDraft} disabled={draft.length === 0}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg bg-white/[0.05] hover:bg-white/[0.10] text-gray-400 disabled:opacity-30 transition-colors">
                  <Trash2 size={10} /> Clear
                </button>
                <button onClick={handleSaveZone} disabled={!draftClosed || savingZone}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-30 transition-colors">
                  <Check size={10} /> {savingZone ? "…" : "Save"}
                </button>
              </div>
              {saveError && (
                <p className="text-[10px] text-red-400 mt-0.5">⚠ {saveError}</p>
              )}
              {saveSuccess && (
                <p className="text-[10px] text-green-400 mt-0.5">✓ Zone saved successfully</p>
              )}
            </div>
          )}

          {/* Saved zones list */}
          {zones.length === 0 ? (
            <p className="text-xs text-gray-700">No zones for this camera yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {zones.map((z, i) => (
                <div key={z.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                  <span className="text-xs text-gray-300 flex-1 truncate">{z.name}</span>
                  <button onClick={() => handleDeleteZone(z.id)} className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detections list */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Detections</p>
            {detections.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">{detections.length}</span>
            )}
          </div>
          {detections.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-gray-700 gap-2">
              <User size={22} /><p className="text-xs">No persons detected</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {detections.map((d, i) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs ${
                  d.in_zone ? "bg-red-500/10 border-red-500/20 text-red-300" : "bg-white/[0.03] border-white/[0.06] text-gray-400"
                }`}>
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${d.in_zone ? "bg-red-500/20" : "bg-white/[0.07]"}`}>
                    <User size={11} className={d.in_zone ? "text-red-400" : "text-gray-500"} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium">Person #{i + 1}</span>
                    <span className={`text-[10px] ${d.in_zone ? "text-red-500" : "text-gray-600"}`}>
                      {(d.confidence * 100).toFixed(1)}%{d.in_zone ? " · IN ZONE" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
