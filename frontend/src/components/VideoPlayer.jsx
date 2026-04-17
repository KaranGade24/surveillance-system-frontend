import React, { useEffect, useRef, useState } from "react";
import "./VideoGallery.css";

const VideoGallery = () => {
  const [videos, setVideos] = useState([]);
  const [structured, setStructured] = useState({});
  const [path, setPath] = useState([]); // navigation path
  const [selectedVideo, setSelectedVideo] = useState(null);
  const videoRef = useRef(null);

  // 🎥 Set playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.5;
    }
  }, [selectedVideo]);

  // 📦 Fetch + Structure
  // useEffect(() => {
  //   fetch("http://localhost:5000/all-videos")
  //     .then((res) => res.json())
  //     .then((data) => {
  //       if (!data.success) return;

  //       const vids = data.videos;

  //       const grouped = {};

  //       vids.forEach((vid) => {
  //         const d = new Date(vid.date);

  //         const year = d.getFullYear();
  //         const month = d.toLocaleString("default", { month: "long" });
  //         const day = d.getDate();

  //         if (!grouped[year]) grouped[year] = {};
  //         if (!grouped[year][month]) grouped[year][month] = {};
  //         if (!grouped[year][month][day]) grouped[year][month][day] = [];

  //         grouped[year][month][day].push(vid);
  //       });

  //       setStructured(grouped);
  //     });
  // }, []);

  const [loading, setLoading] = useState(false);
  function fetchVideos() {
    setLoading(true);
    fetch("http://localhost:5000/all-videos")
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;

        // ✅ 1. Filter only rec_ videos
        const vids = data.videos.filter((vid) => vid.name.startsWith("rec_"));

        // ✅ 2. Sort latest first
        vids.sort((a, b) => new Date(b.date) - new Date(a.date));

        const grouped = {};

        vids.forEach((vid) => {
          const d = new Date(vid.date);

          const year = d.getFullYear();
          const month = d.toLocaleString("default", { month: "long" });
          const day = d.getDate();

          if (!grouped[year]) grouped[year] = {};
          if (!grouped[year][month]) grouped[year][month] = {};
          if (!grouped[year][month][day]) grouped[year][month][day] = [];

          grouped[year][month][day].push(vid);
        });

        setStructured(grouped);
      })
      .finally(() => {
        setLoading(false);
      });
  }
  useEffect(() => {
    fetchVideos();
  }, []);

  // 📂 Navigate structure
  const getCurrentLevel = () => {
    let current = structured;
    for (let p of path) {
      current = current[p];
    }
    return current;
  };

  const currentLevel = getCurrentLevel();

  return (
    <div className="gallery-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexDirection: "row",
        }}
      >
        <h1 className="title">📁 Surveillance Archive</h1>
        <button
          style={{
            backgroundColor: "#007bff",
            color: "#fff",
            padding: "8px 16px",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          onClick={fetchVideos}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span onClick={() => setPath([])}>Home</span>
        {path.map((p, i) => (
          <span key={i} onClick={() => setPath(path.slice(0, i + 1))}>
            {" / " + p}
          </span>
        ))}
      </div>

      {/* 🎥 Player */}
      {selectedVideo && (
        <div className="modal-overlay">
          <div className="modal-content">
            <video controls autoPlay ref={videoRef}>
              <source
                src={`http://localhost:5000/stream/${selectedVideo.id}`}
              />
            </video>

            <div className="video-info">
              <h3>{selectedVideo.name}</h3>
              <p>{new Date(selectedVideo.date).toLocaleString()}</p>
              <p>Size: {selectedVideo.size}</p>
            </div>

            <button
              className="close-btn"
              onClick={() => setSelectedVideo(null)}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {/* 📂 Folder / Files View */}
      <div className="grid">
        {Array.isArray(currentLevel)
          ? // 🎥 Show videos
            currentLevel.map((vid) => (
              <div
                key={vid.id}
                className="card"
                onClick={() => setSelectedVideo(vid)}
              >
                <div className="thumbnail-wrapper">
                  <img src={vid.thumbnail} alt="preview" />
                  <div className="play-icon">▶</div>
                </div>

                <div className="card-body">
                  <h4>{vid.name}</h4>
                  <p>{new Date(vid.date).toLocaleString()}</p>
                </div>
              </div>
            ))
          : // 📁 Show folders
            Object.keys(currentLevel || {}).map((key) => (
              <div
                key={key}
                className="folder-card"
                onClick={() => setPath([...path, key])}
              >
                <div className="folder-icon">📁</div>
                <h4>{key}</h4>
              </div>
            ))}
      </div>
    </div>
  );
};

export default VideoGallery;
