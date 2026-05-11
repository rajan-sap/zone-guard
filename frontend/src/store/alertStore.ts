import { create } from "zustand";

export interface AlertEvent {
  event: string;
  incident_id: string;
  camera_id: string;
  zone_id: string;
  confidence: number;
  snapshot_path: string;
  created_at: string;
}

interface AlertStore {
  alerts: AlertEvent[];
  connected: boolean;
  connect: () => void;
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  alerts: [],
  connected: false,

  connect() {
    const ws = new WebSocket(`ws://localhost:8000/api/alerts/ws`);

    ws.onopen = () => set({ connected: true });

    ws.onmessage = (e) => {
      const payload: AlertEvent = JSON.parse(e.data);
      set((state) => ({ alerts: [payload, ...state.alerts].slice(0, 100) }));
    };

    ws.onclose = () => {
      set({ connected: false });
      // Reconnect after 3s
      setTimeout(() => get().connect(), 3000);
    };
  },
}));
