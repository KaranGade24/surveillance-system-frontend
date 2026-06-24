import { useEffect, useState } from "react";
import "../App.css";

export default function LiveFeed() {
  const streamUrl = "http://192.168.43.222:5000";
  const backendUrl =
    "https://5000-firebase-survillancesystem-1762004374655.cluster-cd3bsnf6r5bemwki2bxljme5as.cloudworkstations.dev";
  const [refreshKey, setRefreshKey] = useState(Date.now());

  const pauseAlert = async () => {
    try {
      const response = await fetch(`${backendUrl}/pause-alert`, {
        method: "POST",
      });

      if (response.ok) {
        console.log("Alert paused successfully");
      } else {
        console.error("Failed to pause alert");
      }
    } catch (error) {
      console.error("Error pausing alert:", error);
    }
  };

  return (
    <div className="live-container">
      <div className="live-header">
        <h2>📡 Live Detection Feed</h2>
        <span className="status-dot"></span>
        <span className="status-text">LIVE</span>

        <button
          onClick={() => setRefreshKey(Date.now())}
          className="bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded-lg cursor-pointer"
        >
          Refresh
        </button>

        <button
          onClick={() => pauseAlert()}
          className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg cursor-pointer"
        >
          Pause Alert
        </button>
      </div>

      <div className="live-frame">
        <img
          key={refreshKey} // 👈 forces re-render
          src={`${streamUrl}/video_feed?t=${refreshKey}`} // 👈 avoids cache
          alt="Live Feed"
          className="live-video"
          crossOrigin="anonymous"
        />
      </div>
    </div>
  );
}
