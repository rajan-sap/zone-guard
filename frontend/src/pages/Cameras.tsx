import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Plus, Trash2, Video, Pencil, Check, X, MapPin, Wifi, WifiOff, PlayCircle } from "lucide-react";

interface Camera {
  id: string;
  name: string;
  stream_url: string;
  location: string;
  is_active: boolean;
}

// ── Inline-editable area label ────────────────────────────────────────────────
function EditableArea({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); };
  const cancel = () => setEditing(false);
  const save = async () => {
    if (!draft.trim() || draft.trim() === value) { cancel(); return; }
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className="bg-white/[0.07] border border-red-500/40 rounded-md px-2 py-0.5 text-xs text-white outline-none w-36"
          disabled={saving}
        />
        <button onClick={save} disabled={saving} className="p-0.5 text-green-400 hover:text-green-300 transition-colors disabled:opacity-40">
          <Check size={12} />
        </button>
        <button onClick={cancel} className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={open}
      className="flex items-center gap-1 mt-1 group text-left"
    >
      <MapPin size={10} className="text-gray-600 group-hover:text-red-400 transition-colors shrink-0" />
      <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">{value}</span>
      <Pencil size={9} className="text-gray-700 group-hover:text-red-400 transition-colors ml-0.5" />
    </button>
  );
}

// ── Camera card ───────────────────────────────────────────────────────────────
function CameraCard({
  camera,
  index,
  onUpdate,
  onDelete,
  onViewFeed,
}: {
  camera: Camera;
  index: number;
  onUpdate: (id: string, patch: Partial<Camera>) => Promise<void>;
  onDelete: (id: string) => void;
  onViewFeed: (id: string) => void;
}) {
  const palettes = [
    { accent: "from-blue-900/60 to-blue-950/80",   badge: "bg-blue-500/20 text-blue-300 border-blue-500/25",   dot: "bg-blue-400" },
    { accent: "from-violet-900/60 to-violet-950/80", badge: "bg-violet-500/20 text-violet-300 border-violet-500/25", dot: "bg-violet-400" },
    { accent: "from-teal-900/60 to-teal-950/80",   badge: "bg-teal-500/20 text-teal-300 border-teal-500/25",   dot: "bg-teal-400" },
  ];
  const p = palettes[index % palettes.length];

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden flex flex-col hover:border-white/[0.12] transition-colors group">

      {/* ── Thumbnail area ── */}
      <div className={`relative w-full aspect-video bg-gradient-to-br ${p.accent} flex items-center justify-center`}>
        {/* grid lines to mimic a camera feed placeholder */}
        <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={`grid-${index}`} width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#grid-${index})`} />
        </svg>

        {/* Camera icon centred */}
        <div className="relative flex flex-col items-center gap-2 opacity-40">
          <Video size={36} className="text-white" />
          <span className="text-[10px] text-white font-medium tracking-widest uppercase">No feed</span>
        </div>

        {/* Status pill top-left */}
        <div className="absolute top-3 left-3">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${p.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${camera.is_active ? p.dot : "bg-gray-500"}`} />
            {camera.is_active ? "Active" : "Inactive"}
          </span>
        </div>

        {/* Delete button top-right */}
        <button
          onClick={() => onDelete(camera.id)}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-black/40 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* ── Info area ── */}
      <div className="flex flex-col gap-3 p-4">
        {/* Name + editable area */}
        <div>
          <p className="text-sm font-semibold text-gray-100 leading-tight">{camera.name}</p>
          <EditableArea
            value={camera.location}
            onSave={(v) => onUpdate(camera.id, { location: v })}
          />
        </div>

        {/* Stream URL */}
        <div className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.05] px-2.5 py-1.5">
          {camera.is_active
            ? <Wifi size={10} className="text-green-500 shrink-0" />
            : <WifiOff size={10} className="text-gray-600 shrink-0" />}
          <span className="text-[10px] font-mono text-gray-600 truncate">{camera.stream_url}</span>
        </div>

        {/* Draw zones / view feed button */}
        <button
          onClick={() => onViewFeed(camera.id)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] transition-colors"
        >
          <PlayCircle size={11} /> View Feed &amp; Zones
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Cameras() {
  const navigate = useNavigate();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [form, setForm] = useState({ name: "", stream_url: "", location: "" });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const { data } = await api.get<Camera[]>("/cameras/");
    setCameras(data);
  };

  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/cameras/", form);
    setForm({ name: "", stream_url: "", location: "" });
    setAdding(false);
    load();
  };

  const update = async (id: string, patch: Partial<Camera>) => {
    await api.patch(`/cameras/${id}`, patch);
    setCameras((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const remove = async (id: string) => {
    await api.delete(`/cameras/${id}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Cameras</h1>
          <p className="text-sm text-gray-500 mt-0.5">{cameras.length} camera{cameras.length !== 1 ? "s" : ""} configured</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={15} /> Add Camera
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3">
          <p className="text-sm font-semibold text-gray-300 mb-1">New Camera</p>
          {[
            { key: "name",       label: "Camera name",      ph: "e.g. Camera 4" },
            { key: "stream_url", label: "Stream URL",        ph: "rtsp://…" },
            { key: "location",   label: "Area / Deck name",  ph: "e.g. Drill Floor" },
          ].map(({ key, label, ph }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                required
                placeholder={ph}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-red-500/50 transition-colors"
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors">
              Save Camera
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-400 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-3 gap-5">
        {cameras.map((cam, i) => (
          <CameraCard
            key={cam.id}
            camera={cam}
            index={i}
            onUpdate={update}
            onDelete={remove}
            onViewFeed={(id) => navigate(`/cameras/${id}`)}
          />
        ))}
        {cameras.length === 0 && (
          <div className="col-span-3 text-center py-16 text-gray-600 text-sm rounded-xl border border-white/5">
            No cameras configured.
          </div>
        )}
      </div>
    </div>
  );
}
