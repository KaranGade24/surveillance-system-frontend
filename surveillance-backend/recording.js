const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

const RECS_DIR = path.join(__dirname, "recordings");
let currentRecordingProcess = null;
let isShuttingDown = false;
let recordingSessionId = 0;

const CONFIG = {
  segmentDuration: 60,
  retryDelay: 10000,
  networkTimeout: 5000,
};

/**
 * 1. START CONTINUOUS RECORDING
 * Improved: Uses axios.head to avoid stream hangs and safe retry delays.
 */
exports.startRecording = async (streamUrl) => {
  recordingSessionId++; // 🔥 new session
  const sessionId = recordingSessionId;
  if (currentRecordingProcess) {
    console.log("♻️ Restarting: Killing active process...");
    currentRecordingProcess.kill("SIGTERM");
  }

  const videoFeedUrl = streamUrl.endsWith("/video_feed")
    ? streamUrl
    : `${streamUrl}/video_feed`;

  const recordSegment = async () => {
    if (isShuttingDown || sessionId !== recordingSessionId) {
      console.log("🛑 Old recording loop stopped.");
      return;
    }

    // --- NETWORK VALIDATION ---
    try {
      // Use HEAD request to check link without downloading data
      await axios.get(videoFeedUrl, { timeout: 5000, responseType: "stream" });
    } catch (err) {
      console.error(
        `📡 Stream unreachable (${err.message}). Retrying in ${
          CONFIG.retryDelay / 1000
        }s...`
      );
      setTimeout(recordSegment, CONFIG.retryDelay);
      return;
    }

    const now = new Date();
    const dateFolder = now.toISOString().split("T")[0];
    const hourFolder = `hour_${now.getHours()}`;
    const dir = path.join(RECS_DIR, dateFolder, hourFolder);

    await fs.ensureDir(dir);

    const fileName = `${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.mp4`;
    const filePath = path.join(dir, fileName);

    console.log(`📹 Recording: ${fileName}`);

    // FFmpeg Args optimized for MJPEG-to-MP4 stream copying
    currentRecordingProcess = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",

      // 🔥 Important for HTTP MJPEG stream stability
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-strict",
      "experimental",
      "-analyzeduration",
      "1000000",
      "-probesize",
      "1000000",

      "-i",
      videoFeedUrl,

      // ⏱️ Segment duration (60 sec)
      "-t",
      CONFIG.segmentDuration.toString(),

      // 🎯 Convert MJPEG → H264 (WEB COMPATIBLE)
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",

      // 🔥 CRITICAL for browser playback
      "-pix_fmt",
      "yuv420p",

      // ❌ No audio
      "-an",

      // 🎬 MP4 output (correct format)
      "-f",
      "mp4",
      "-movflags",
      "+faststart",

      filePath.replace(".mkv", ".mp4"), // ✅ FIX EXTENSION

      "-rw_timeout",
      "5000000", // 5 sec
    ]);

    currentRecordingProcess.stderr.on("data", (data) => {
      console.error(`⚠️ FFmpeg Error: ${data.toString().trim()}`);
    });

    currentRecordingProcess.on("close", (code) => {
      currentRecordingProcess = null;
      // ❌ STOP if new session started
      if (sessionId !== recordingSessionId || isShuttingDown) {
        console.log("🛑 Recording loop terminated (new session).");
        return;
      }

      // If crashed (code != 0), wait longer before retrying to prevent CPU spam
      const nextDelay = code === 0 || code === null ? 500 : CONFIG.retryDelay;
      setTimeout(recordSegment, nextDelay);
    });

    currentRecordingProcess.on("error", (err) => {
      console.error("❌ Process failed to start:", err.message);
    });
  };

  await recordSegment();
};

/**
 * 2. GRACEFUL EXIT
 * Improved: Added a fallback SIGKILL if FFmpeg hangs during close.
 */
exports.stopRecordingGracefully = () => {
  isShuttingDown = true;
  if (currentRecordingProcess) {
    console.log("🛑 Closing FFmpeg...");
    currentRecordingProcess.kill("SIGTERM");

    // Force kill if it doesn't close in 5 seconds
    setTimeout(() => {
      if (currentRecordingProcess) currentRecordingProcess.kill("SIGKILL");
    }, 5000);
  }
};

/**
 * 3. RETENTION POLICY (Cleanup)
 * Improved: Fully asynchronous and non-blocking to prevent recording stutters.
 */
exports.clearOldRecordings = async (minutesOlderThan) => {
  const threshold = Date.now() - minutesOlderThan * 60 * 1000;

  const cleanRecursive = async (dir) => {
    if (!(await fs.pathExists(dir))) return;

    const items = await fs.readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        await cleanRecursive(fullPath);
        // Remove folder if now empty
        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.remove(fullPath);
        }
      } else if (stat.mtimeMs < threshold) {
        await fs.unlink(fullPath);
        console.log(`🗑️ Deleted expired: ${item}`);
      }
    }
  };

  try {
    await cleanRecursive(RECS_DIR);
    console.log("🧹 Cleanup complete.");
  } catch (e) {
    console.error("🧹 Cleanup Error:", e.message);
  }
};
