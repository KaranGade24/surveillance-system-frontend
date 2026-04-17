import { useEffect, useState } from "react";
import "../App.css";

export default function LiveFeed({ backendUrl }) {
  const streamUrl = "http://192.168.43.90:5000";

  return (
    <div className="live-container">
      <div className="live-header">
        <h2>📡 Live Detection Feed</h2>
        <span className="status-dot"></span>
        <span className="status-text">LIVE</span>
      </div>

      <div className="live-frame">
        {streamUrl ? (
          <img
            src={`${streamUrl}/video_feed`}
            alt="Live Feed"
            className="live-video"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="loading">Connecting to camera...</div>
        )}
      </div>
    </div>
  );
}
