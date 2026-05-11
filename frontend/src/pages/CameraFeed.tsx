import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import api from "../lib/api";
import DeviceCamera from "./DeviceCamera";

interface Camera {
  id: string;
  name: string;
  location: string;
  stream_url: string;
  is_active: boolean;
}

export default function CameraFeed() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [camera, setCamera] = useState<Camera | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<Camera>(`/cameras/${id}`)
      .then(({ data }) => setCamera(data))
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <p>Camera not found.</p>
        <button onClick={() => navigate("/cameras")} className="text-sm text-red-400 hover:underline">
          Back to Cameras
        </button>
      </div>
    );
  }

  if (!camera) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <button
        onClick={() => navigate("/cameras")}
        className="self-start flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
      >
        <ArrowLeft size={13} /> Back to Cameras
      </button>
      <DeviceCamera fixedCameraId={camera.id} fixedCameraName={`${camera.name} — ${camera.location}`} />
    </div>
  );
}
