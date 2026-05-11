import { useEffect, useState } from "react";
import api from "../lib/api";

interface Incident {
  id: string;
  camera_id: string;
  zone_id: string;
  status: string;
  confidence: number;
  snapshot_path: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: "bg-red-500/15 text-red-400 border-red-500/20",
    ACKNOWLEDGED: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    RESOLVED: "bg-green-500/15 text-green-400 border-green-500/20",
    FALSE_POSITIVE: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${styles[status] ?? "bg-gray-700 text-gray-300"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function ActionBtn({ onClick, variant, children }: { onClick: () => void; variant: "warn" | "success" | "muted"; children: React.ReactNode }) {
  const styles = {
    warn: "bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border-yellow-500/20",
    success: "bg-green-500/10 hover:bg-green-500/20 text-green-400 border-green-500/20",
    muted: "bg-white/5 hover:bg-white/10 text-gray-400 border-white/10",
  }[variant];
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${styles}`}>
      {children}
    </button>
  );
}

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const load = async () => {
    const { data } = await api.get<Incident[]>("/incidents/");
    setIncidents(data);
  };

  useEffect(() => { load(); }, []);

  const acknowledge = async (id: string) => {
    await api.patch(`/incidents/${id}/acknowledge`);
    load();
  };

  const resolve = async (id: string, status: "RESOLVED" | "FALSE_POSITIVE") => {
    await api.patch(`/incidents/${id}/resolve`, null, { params: { status } });
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Incidents</h1>
        <p className="text-sm text-gray-500 mt-0.5">Review and action all detected violations</p>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["Time", "Camera", "Zone", "Confidence", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-widest text-gray-600 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(inc.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{inc.camera_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{inc.zone_id ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-orange-300 font-semibold text-xs">{(inc.confidence * 100).toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inc.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {inc.status === "OPEN" && (
                        <ActionBtn onClick={() => acknowledge(inc.id)} variant="warn">Acknowledge</ActionBtn>
                      )}
                      {(inc.status === "OPEN" || inc.status === "ACKNOWLEDGED") && (
                        <>
                          <ActionBtn onClick={() => resolve(inc.id, "RESOLVED")} variant="success">Resolve</ActionBtn>
                          <ActionBtn onClick={() => resolve(inc.id, "FALSE_POSITIVE")} variant="muted">False Positive</ActionBtn>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {incidents.length === 0 && (
          <div className="text-center py-16 text-gray-600 text-sm">No incidents recorded.</div>
        )}
      </div>
    </div>
  );
}
