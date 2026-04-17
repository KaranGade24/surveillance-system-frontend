const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ override: true });
const { google } = require("googleapis");
const { spawn } = require("child_process");
// const { startMockPiStream } = require("./piDemo");
const app = express();
app.use(cors());
app.use(express.json());
const chokidar = require("chokidar");
const { getMockStream } = require("./piDemo");
const DB_FILE = path.join(__dirname, "database.json");

// 1. Auth Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});
const drive = google.drive({ version: "v3", auth: oauth2Client });

// ─────────────────────────────────────────────
// JSON DATABASE UTILS
// ─────────────────────────────────────────────
const initDB = () => {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      systemState: {
        id: "pi_station_1",
        public_url: "",
        last_updated: null,
        is_fire_active: false,
        last_alert_conf: 0,
      },
      alerts: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
};

const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const writeDB = (data) =>
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

initDB();

// 2. Helper: Dynamic Folder Creation
async function getOrCreateFolder(name, parentId = null) {
  const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' ${
    parentId ? `and '${parentId}' in parents` : ""
  } and trashed=false`;
  const res = await drive.files.list({ q: query, fields: "files(id)" });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: parentId ? [parentId] : [],
  };
  const folder = await drive.files.create({ resource: metadata, fields: "id" });
  return folder.data.id;
}

let folderCache = { date: null, id: null };
async function getTimestampFolderId() {
  const today = new Date().toISOString().split("T")[0];
  if (folderCache.date === today) return folderCache.id;

  const now = new Date();
  const year = await getOrCreateFolder(now.getFullYear().toString());
  const month = await getOrCreateFolder(
    now.toLocaleString("default", { month: "long" }),
    year
  );
  const day = await getOrCreateFolder(now.getDate().toString(), month);
  const time = await getOrCreateFolder(
    `${now.getHours()}-${now.getMinutes()}`,
    day
  );
  folderCache = { date: today, id: time };
  return time;
}

function convertToStreamable(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(".mp4", "_stream.mp4");

    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,

      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",

      "-c:a",
      "aac",
      "-b:a",
      "128k",

      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart", // ⭐ REQUIRED

      outputPath,
    ]);

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error("FFmpeg conversion failed"));
    });
  });
}

// 3. Main Streaming Logic

let globalWatcher = null; // Prevent multiple watchers from being created

async function startStreaming(streamUrl) {
  const folderId = await getTimestampFolderId();
  const tempDir = path.join(__dirname, "temp_segments");

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const ffmpeg = spawn("ffmpeg", [
    "-f",
    "mjpeg",
    "-i",
    streamUrl,

    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-g",
    "30",

    "-pix_fmt",
    "yuv420p",

    // "-movflags", "+faststart", // ⭐ added (for browser playback)

    "-f",
    "segment",
    "-segment_time",
    "20",
    "-reset_timestamps",
    "1",
    "-strftime",
    "1",

    path.join(tempDir, "rec_%Y-%m-%d_%H-%M-%S.mp4"),
  ]);

  // Only initialize the watcher once
  if (!globalWatcher) {
    globalWatcher = chokidar.watch(tempDir, {
      persistent: true,
      ignoreInitial: true, // Don't upload old files on startup
      awaitWriteFinish: {
        stabilityThreshold: 3000, // Wait 3s after FFmpeg is done with a segment
        pollInterval: 500,
      },
    });

    let lastFile = null;

    globalWatcher.on("add", async (filePath) => {
      if (lastFile && fs.existsSync(lastFile)) {
        const fileToUpload = lastFile;
        const fileNameToUpload = path.basename(fileToUpload);
        const thumbPath = fileToUpload.replace(".mp4", ".jpg"); // Temp thumb name

        (async (targetFile, targetName, targetThumb) => {
          try {
            const stats = fs.statSync(targetFile);

            if (stats.size > 600000) {
              // 1. Generate thumbnail from the 1st second of the video
              await new Promise((resolve, reject) => {
                const extract = spawn("ffmpeg", [
                  "-i",
                  targetFile,
                  "-ss",
                  "00:00:01", // Capture at 1 second
                  "-vframes",
                  "1", // Only 1 frame
                  "-q:v",
                  "2", // High quality
                  targetThumb,
                ]);
                extract.on("close", resolve);
                extract.on("error", reject);
              });

              // 2. Read thumb as Base64 for Google Drive contentHints
              // Note: Base64 must be URL-safe (replace + with -, / with _)
              const thumbBase64 = fs
                .readFileSync(targetThumb)
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_");

              const streamableFile = await convertToStreamable(targetFile);

              const uploadedFile = await drive.files.create({
                requestBody: {
                  name: targetName,
                  parents: [folderId],
                },
                media: {
                  mimeType: "video/mp4",
                  body: fs.createReadStream(streamableFile), // ✅ upload converted file
                },
              });

              // 3. Set public permissions
              await drive.permissions.create({
                fileId: uploadedFile.data.id,
                requestBody: { role: "reader", type: "anyone" },
              });

              // 4. Cleanup
              try {
                if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
                if (fs.existsSync(targetThumb)) fs.unlinkSync(targetThumb);
                if (fs.existsSync(streamableFile))
                  fs.unlinkSync(streamableFile);
              } catch (err) {
                console.error("❌ Error in cleanup", err);
              }
            }
          } catch (err) {
            console.error(`❌ Upload failed for ${targetName}:`, err.message);
          }
        })(fileToUpload, fileNameToUpload, thumbPath);
      }

      lastFile = filePath;
    });
  }

  ffmpeg.stderr.on("data", (data) => {
    if (data.toString().includes("frame=")) {
      // process.stdout.write(
      //   `\r📹 Recording Status: ${data.toString().split("Lsize")[0]}`
      // );
    }
  });
}
// 4. POST Endpoint
const driveStreamingHandler = async (url) => {
  try {
    if (!url) return;

    startStreaming(url);
  } catch (err) {
    console.error("Streaming error:", err);
  } // Runs in background}
};

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

/**
 * 1. Update Tunnel Link from Raspberry Pi
 */
var streamPath = "";
app.post("/update-link", async (req, res) => {
  const url = req.body.url;
  if (!url) return res.status(400).send({ error: "URL is required" }); // Ensure the URL has the specific stream path for FFmpeg to grab

  streamPath = url.endsWith("/video_feed") ? url : `${url}/video_feed`; // // 1. Update DB to point to self // const db = readDB(); // db.systemState.public_url = selfUrl; // writeDB(db);

  console.info("Starting stream from:", streamPath); // 2. Start the Recording logic (for Google Drive) // We wait 3 seconds to ensure the server is fully "listening"
  setTimeout(() => {
    console.info("📂 Recording started: Directing recorder to /live-stream...");
    driveStreamingHandler(streamPath);
  }, 3000); // await driveStreamingHandler(streamPath);

  res.send({ status: "Stream update initiated" });
});

app.get("/live-stream", (req, res) => {
  res.json({ url: streamPath });
});

/**
 * 2. Receive Fire Alert from Pi
 */
app.post("/fire-alert", (req, res) => {
  const { confidence, stream_url } = req.body;
  const db = readDB();

  const newAlert = {
    id: Date.now(),
    event: "FIRE_DETECTED",
    confidence: confidence || 0,
    stream_url: stream_url || db.systemState.public_url,
    timestamp: new Date(),
  };

  db.alerts.unshift(newAlert); // Add to beginning
  db.alerts = db.alerts.slice(0, 50); // Keep last 50 alerts
  db.systemState.is_fire_active = true;
  db.systemState.last_alert_conf = confidence;

  writeDB(db);
  // function to sent twillio message
  sendSMS(
    "+918446726903",
    `🚨 ALERT: Fire detected!\nConfidence: ${confidence}%\nTake immediate action!`
  );
  console.info(`🔥 Fire Alert Saved! Conf: ${confidence}%`);
  res.status(200).send({ message: "Alert logged" });
});

app.get("/live-stream", (req, res) => {
  res.json({ url: streamPath });
});

/**
 * 4. Get System Status & Alerts (For Frontend)
 */
app.get("/status", (req, res) => {
  const db = readDB();
  res.json({
    ...db.systemState,
    recent_alerts: db.alerts.slice(0, 5),
  });
});

/**
 * GET /all-videos
 * Returns a list of all uploaded recordings for a gallery view
 */
app.get("/all-videos", async (req, res) => {
  try {
    const response = await drive.files.list({
      // Search for all mp4 files that aren't deleted
      q: "mimeType='video/mp4' and trashed=false",
      fields: "files(id, name, webViewLink, thumbnailLink, createdTime, size)",
      orderBy: "createdTime desc", // Newest videos at the top
    });

    if (response.data.files.length === 0) {
      return res.json({
        success: true,
        videos: [],
        message: "No recordings found.",
      });
    } // Map the data to a clean format for React

    const videos = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      // This is the direct link that works in Iframes:
      embedLink: `https://drive.google.com/file/d/${file.id}/preview`,
      url: file.webViewLink,
      thumbnail:
        file.thumbnailLink ??
        `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`,
      streamUrl: file.webViewLink,
      date: file.createdTime,
      size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
    }));

    res.json({
      success: true,
      count: videos.length,
      videos: videos,
    });
  } catch (err) {
    console.error("❌ Error fetching video list:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to retrieve gallery" });
  }
});

// import { Readable } from "stream";
const { Readable } = require("stream");
const { sendSMS } = require("./utils/sendSMS");

app.get("/stream/:id", async (req, res) => {
  try {
    const fileId = req.params.id;

    // ✅ Get fresh access token
    const accessToken = await oauth2Client.getAccessToken();

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          Range: req.headers.range || "",
        },
      }
    );

    if (!driveRes.ok) {
      console.error("Drive error:", await driveRes.text());
      return res.status(500).send("Drive fetch failed");
    }

    // ✅ Convert WebStream → Node stream
    const stream = Readable.fromWeb(driveRes.body);

    // ✅ VERY IMPORTANT
    res.status(driveRes.status); // 200 or 206

    res.set({
      "Content-Type": driveRes.headers.get("content-type") || "video/mp4",
      "Content-Length": driveRes.headers.get("content-length"),
      "Accept-Ranges": "bytes",
      "Content-Range": driveRes.headers.get("content-range"),
    });

    stream.pipe(res);
  } catch (err) {
    console.error("Streaming error:", err);
    res.status(500).send("Streaming failed");
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.info(`
🚀 Backend running on http://localhost:${PORT}
📂 Data stored in: ${DB_FILE}
🎥 Stream Proxy: http://localhost:${PORT}/live-stream`);
});

// app.listen(PORT, ()
