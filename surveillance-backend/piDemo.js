const { spawn } = require("child_process");

exports.getMockStream = (videoPath) => {
  return spawn("ffmpeg", [
    "-re", // Read at native speed
    "-stream_loop",
    "-1", // Loop forever
    "-i",
    videoPath,
    "-f",
    "mpjpeg", // Output as Motion JPEG
    "-r",
    "30", // Force 30 FPS for consistent segment timing
    "-boundary_tag",
    "frame",
    "-q:v",
    "4", // Balanced quality
    "pipe:1",
  ]);
};
