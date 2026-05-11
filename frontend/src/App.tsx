import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Incidents from "./pages/Incidents";
import Cameras from "./pages/Cameras";
import DeviceCamera from "./pages/DeviceCamera";
import CameraFeed from "./pages/CameraFeed";
import { useAlertStore } from "./store/alertStore";
import { useEffect } from "react";
import { LayoutDashboard, ShieldAlert, Video, Cpu, Radio } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, desc: "Live alert feed" },
  { to: "/incidents", label: "Incidents", icon: ShieldAlert, desc: "Review violations" },
  { to: "/cameras", label: "Site Cameras", icon: Video, desc: "Manage streams & zones" },
  { to: "/device-camera", label: "Test Camera", icon: Cpu, desc: "On-device detection" },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Live Dashboard", subtitle: "Real-time red zone alert feed" },
  "/incidents": { title: "Incidents", subtitle: "Review and action all detected violations" },
  "/cameras": { title: "Site Cameras", subtitle: "Manage camera streams and locations" },
  "/device-camera": { title: "Test Camera", subtitle: "Use your device camera for on-site detection" },
};

function pageTitle(pathname: string) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (/^\/cameras\/[^/]+$/.test(pathname))
    return { title: "Camera Feed", subtitle: "Live feed with zone monitoring" };
  return { title: "ZoneGuard", subtitle: "" };
}

export default function App() {
  const connect = useAlertStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const location = useLocation();
  const { connected, alerts } = useAlertStore();
  const page = pageTitle(location.pathname);
  const openAlerts = alerts.length;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-64 bg-[#0c0f18] border-r border-white/[0.06] flex flex-col shrink-0 h-full">

        {/* Logo */}
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0 shadow-lg shadow-red-900/40">
              <ShieldAlert size={17} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight tracking-wide">ZoneGuard</div>
              <div className="text-[10px] text-gray-600 leading-tight mt-0.5">Red Zone Monitor</div>
            </div>
          </div>
        </div>

        {/* Live status pill */}
        <div className="px-4 mb-4">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${
            connected
              ? "bg-green-500/8 border-green-500/15 text-green-400"
              : "bg-red-500/8 border-red-500/15 text-red-400 animate-pulse"
          }`}>
            <Radio size={11} className={connected ? "text-green-400" : "text-red-400"} />
            <span>{connected ? "System Online" : "Reconnecting…"}</span>
            {openAlerts > 0 && (
              <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {openAlerts}
              </span>
            )}
          </div>
        </div>

        <div className="px-4 mb-2">
          <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-widest px-1">Menu</p>
        </div>

        {/* Nav links */}
        <div className="flex flex-col gap-1 px-3 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end, desc }) => (
            <NavLink key={to} to={to} end={end} className={navClass}>
              {({ isActive }) => (
                <>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? "bg-red-500/20" : "bg-white/5 group-hover:bg-white/10"
                  }`}>
                    <Icon size={15} className={isActive ? "text-red-400" : "text-gray-500"} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm font-medium leading-tight ${isActive ? "text-white" : "text-gray-400"}`}>
                      {label}
                    </span>
                    <span className="text-[10px] text-gray-700 leading-tight truncate">{desc}</span>
                  </div>
                  {to === "/" && openAlerts > 0 && !isActive && (
                    <span className="ml-auto bg-red-500/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">
                      {openAlerts}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-5 border-t border-white/[0.05] mt-4">
          <p className="text-[10px] text-gray-700 font-mono">v0.1.0 · Offshore Safety Systems</p>
        </div>
      </nav>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden h-full bg-[#0a0d14]">
        {/* Top bar */}
        <header className="shrink-0 px-8 py-4 border-b border-white/[0.05] flex items-center justify-between bg-[#0c0f18]">
          <div>
            <h1 className="text-base font-semibold text-white leading-tight">{page.title}</h1>
            <p className="text-xs text-gray-600 mt-0.5">{page.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </header>

        <main className="flex-1 p-8 overflow-auto h-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/cameras/:id" element={<CameraFeed />} />
            <Route path="/device-camera" element={<DeviceCamera fixedCameraId="device" fixedCameraName="Device Camera" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

const navClass = "group flex items-center gap-3 px-2 py-2 rounded-xl transition-all hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]";

