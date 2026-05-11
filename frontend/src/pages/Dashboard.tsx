import { useAlertStore, AlertEvent } from "../store/alertStore";
import { AlertTriangle, ShieldCheck, Activity } from "lucide-react";

export default function Dashboard() {
  const { alerts, connected } = useAlertStore();
  const openCount = alerts.length;

  return (
    <div className="flex flex-col h-full gap-8">

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-5">
        <StatCard
          icon={<AlertTriangle size={22} className="text-red-400" />}
          label="Active Alerts"
          value={openCount}
          accent="red"
        />
        <StatCard
          icon={<Activity size={22} className="text-blue-400" />}
          label="Detections (session)"
          value={openCount}
          accent="blue"
        />
        <StatCard
          icon={<ShieldCheck size={22} className="text-green-400" />}
          label="System Status"
          value={connected ? "Online" : "Offline"}
          accent="green"
        />
      </div>

      {/* Alert feed — grows to fill remaining space */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-600">Alert Feed</h2>
          {alerts.length > 0 && (
            <span className="text-xs text-gray-600">{alerts.length} event{alerts.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 rounded-2xl border border-white/5 bg-white/[0.015]">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/15 flex items-center justify-center mb-4">
              <ShieldCheck size={28} className="text-green-500/60" />
            </div>
            <p className="text-gray-400 text-sm font-medium">All clear</p>
            <p className="text-gray-600 text-xs mt-1">No red zone violations detected</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 overflow-y-auto flex-1 pr-1">
            {alerts.map((a) => <AlertCard key={a.incident_id} alert={a} />)}
          </div>
        )}
      </div>

    </div>
  );
}

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent: "red" | "blue" | "green";
}) {
  const ring = {
    red: "border-red-500/15 bg-red-500/5",
    blue: "border-blue-500/15 bg-blue-500/5",
    green: "border-green-500/15 bg-green-500/5",
  }[accent];
  return (
    <div className={`rounded-2xl border p-6 flex items-start gap-4 ${ring}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">{label}</p>
        <p className="text-3xl font-bold text-white mt-2 leading-none">{value}</p>
      </div>
    </div>
  );
}

function AlertCard({ alert: a }: { alert: AlertEvent }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 hover:bg-red-500/10 transition-colors">
      <div className="mt-0.5 w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
        <AlertTriangle size={16} className="text-red-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-300">Person detected in red zone</p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
          <span className="text-xs text-gray-500">Camera: <span className="text-gray-300 font-mono">{a.camera_id}</span></span>
          <span className="text-xs text-gray-500">Zone: <span className="text-gray-300 font-mono">{a.zone_id}</span></span>
          <span className="text-xs text-gray-500">Confidence: <span className="text-orange-300 font-semibold">{(a.confidence * 100).toFixed(1)}%</span></span>
        </div>
        <p className="text-[11px] text-gray-600 mt-1">{new Date(a.created_at).toLocaleString()}</p>
      </div>
      {a.snapshot_path && (
        <img
          src={`/snapshots/${a.snapshot_path.split("/").pop()}`}
          alt="snapshot"
          className="w-24 h-16 object-cover rounded-lg border border-white/10 shrink-0"
        />
      )}
    </div>
  );
}
