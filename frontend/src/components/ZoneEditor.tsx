import { useRef, useState, useEffect, useCallback } from "react";
import api from "../lib/api";
import { X, Trash2, Undo2, Check, ImagePlus, AlertOctagon } from "lucide-react";

const CW = 800;
const CH = 450;
const CLOSE_RADIUS = 13;
const ZONE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

interface Point { x: number; y: number; }

interface SavedZone {
  id: string;
  name: string;
  polygon_points: string;
  is_active: boolean;
}

interface Props {
  cameraId: string;
  cameraName: string;
  onClose: () => void;
}

export default function ZoneEditor({ cameraId, cameraName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [points, setPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [closed, setClosed] = useState(false);
  const [zoneName, setZoneName] = useState("Red Zone 1");
  const [savedZones, setSavedZones] = useState<SavedZone[]>([]);
  const [saving, setSaving] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [loadingBg, setLoadingBg] = useState(true);

  // Try to load camera snapshot as background
  useEffect(() => {
    setLoadingBg(true);
    api.get<{ data_url: string }>(`/cameras/${cameraId}/snapshot`)
      .then(({ data }) => {
        const img = new Image();
        img.src = data.data_url;
        img.onload = () => { setBgImage(img); setLoadingBg(false); };
        img.onerror = () => setLoadingBg(false);
      })
      .catch(() => setLoadingBg(false));
  }, [cameraId]);

  const loadZones = useCallback(async () => {
    try {
      const { data } = await api.get<SavedZone[]>(`/zones/?camera_id=${cameraId}`);
      setSavedZones(data);
    } catch { /* ignore */ }
  }, [cameraId]);

  useEffect(() => { loadZones(); }, [loadZones]);

  const toCanvas = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CW / rect.width),
      y: (e.clientY - rect.top) * (CH / rect.height),
    };
  };

  const nearFirst = (p: Point) =>
    points.length >= 3 &&
    Math.hypot(p.x - points[0].x, p.y - points[0].y) < CLOSE_RADIUS;

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (closed) return;
    const p = toCanvas(e);
    if (nearFirst(p)) {
      setClosed(true);
    } else {
      setPoints((prev) => [...prev, p]);
    }
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => setMousePos(toCanvas(e));

  const handleUndo = () => {
    if (closed) { setClosed(false); return; }
    setPoints((p) => p.slice(0, -1));
  };

  const handleClear = () => { setPoints([]); setClosed(false); setMousePos(null); };

  const handleSave = async () => {
    if (!closed || points.length < 3) return;
    setSaving(true);
    try {
      const normalized = points.map((p) => [
        parseFloat((p.x / CW).toFixed(4)),
        parseFloat((p.y / CH).toFixed(4)),
      ]);
      await api.post("/zones/", {
        camera_id: cameraId,
        name: zoneName.trim() || "Zone",
        polygon_points: JSON.stringify(normalized),
        is_active: true,
      });
      handleClear();
      await loadZones();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteZone = async (id: string) => {
    await api.delete(`/zones/${id}`);
    loadZones();
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => setBgImage(img);
    };
    reader.readAsDataURL(file);
  };

  // ── Canvas draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, CW, CH);

    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, CW, CH);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, CW, CH);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, CH);
      grad.addColorStop(0, "#0c0f18");
      grad.addColorStop(1, "#111520");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CW, CH);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= CW; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke();
      }
      for (let y = 0; y <= CH; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
      }
    }

    // Saved zones
    savedZones.forEach((z, i) => {
      try {
        const pts: number[][] = JSON.parse(z.polygon_points);
        const color = ZONE_COLORS[i % ZONE_COLORS.length];
        ctx.beginPath();
        pts.forEach(([nx, ny], j) => {
          const px = nx * CW, py = ny * CH;
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = color + "28";
        ctx.fill();
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        // Label with shadow
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length * CW;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length * CH;
        ctx.font = "bold 12px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(z.name, cx + 1, cy + 1);
        ctx.fillStyle = color;
        ctx.fillText(z.name, cx, cy);
        ctx.textAlign = "left";
      } catch { /* malformed JSON */ }
    });

    if (points.length === 0) return;

    // Current polygon path
    ctx.beginPath();
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });

    if (closed) {
      ctx.closePath();
      ctx.fillStyle = "rgba(239,68,68,0.2)";
      ctx.fill();
      ctx.setLineDash([]);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Rubber-band line to cursor
      if (mousePos) {
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = "rgba(239,68,68,0.45)";
        ctx.stroke();
        ctx.setLineDash([]);

        // Closing hint line when near first point
        if (nearFirst(mousePos) && points.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(mousePos.x, mousePos.y);
          ctx.lineTo(points[0].x, points[0].y);
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = "rgba(251,191,36,0.7)";
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Vertex dots
    points.forEach((p, i) => {
      const isFirst = i === 0;
      const isHover = isFirst && mousePos && !closed &&
        Math.hypot(mousePos.x - p.x, mousePos.y - p.y) < CLOSE_RADIUS;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isHover ? 9 : (isFirst ? 6 : 4), 0, Math.PI * 2);
      ctx.fillStyle = isHover ? "#fbbf24" : (isFirst ? "#ef4444" : "#ffffff");
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }, [points, mousePos, closed, savedZones, bgImage]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[#0c0f18] border border-white/[0.08] rounded-2xl w-full flex flex-col shadow-2xl overflow-hidden"
        style={{ maxWidth: 1100, maxHeight: "calc(100vh - 32px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 border border-red-500/20 flex items-center justify-center shrink-0">
              <AlertOctagon size={15} className="text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Zone Editor</p>
              <p className="text-xs text-gray-600">{cameraName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-600 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 p-5 flex flex-col gap-3 min-w-0 overflow-hidden">
            <p className="text-xs text-gray-600 shrink-0">
              {!closed
                ? points.length === 0
                  ? "Click to place vertices. Hover back over the first point (glows yellow) to close the zone."
                  : `${points.length} point${points.length !== 1 ? "s" : ""} — click the first point to close the polygon`
                : "Polygon closed. Name the zone and click Save."
              }
            </p>
            <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-white/[0.08]">
              {loadingBg && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0c0f18] z-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-gray-700">Loading camera snapshot…</p>
                  </div>
                </div>
              )}
              <canvas
                ref={canvasRef}
                width={CW}
                height={CH}
                onClick={handleClick}
                onMouseMove={handleMove}
                onMouseLeave={() => setMousePos(null)}
                className="w-full h-full cursor-crosshair block"
                style={{ objectFit: "contain" }}
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-60 shrink-0 border-l border-white/[0.06] flex flex-col overflow-y-auto">

            {/* Drawing controls */}
            <div className="p-4 border-b border-white/[0.06]">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-3">
                Drawing Tools
              </p>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleUndo}
                  disabled={points.length === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Undo2 size={11} /> Undo
                </button>
                <button
                  onClick={handleClear}
                  disabled={points.length === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 size={11} /> Clear
                </button>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-gray-400 transition-colors"
              >
                <ImagePlus size={11} /> Upload reference image
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
            </div>

            {/* Save zone */}
            <div className="p-4 border-b border-white/[0.06]">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-3">
                New Zone
              </p>
              <input
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-700 outline-none focus:border-red-500/40 transition-colors mb-3"
                placeholder="Zone name"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
              />
              <button
                onClick={handleSave}
                disabled={!closed || points.length < 3 || saving}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Check size={14} /> {saving ? "Saving…" : "Save Zone"}
              </button>
              {points.length >= 3 && !closed && (
                <p className="text-[10px] text-amber-600 text-center mt-2">
                  Close the polygon to save
                </p>
              )}
            </div>

            {/* Saved zones */}
            <div className="p-4 flex-1">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-3">
                Zones ({savedZones.length})
              </p>
              {savedZones.length === 0 ? (
                <p className="text-xs text-gray-700">No zones yet for this camera.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {savedZones.map((z, i) => (
                    <div
                      key={z.id}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02]"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                      />
                      <span className="text-xs text-gray-300 flex-1 truncate">{z.name}</span>
                      <button
                        onClick={() => handleDeleteZone(z.id)}
                        className="text-gray-700 hover:text-red-400 shrink-0 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
