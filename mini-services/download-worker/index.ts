import { createServer } from "http";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execFile, spawn } from "child_process";

const PORT = 3003;
const DOWNLOAD_DIR = join(process.cwd(), "..", "..", "download");
const YT_DLP_PATH = "/home/z/.local/bin/yt-dlp";
const STATUS_DIR = join(process.cwd(), "status");

// Player clients to try in order — mediaconnect usually works best
const PLAYER_CLIENTS = ["mediaconnect", "web", "tv", "ios"];

// Ensure directories exist
if (!existsSync(DOWNLOAD_DIR)) mkdirSync(DOWNLOAD_DIR, { recursive: true });
if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true });

// Active jobs for cancellation
const activeJobs = new Map<string, any>();

function getStatus(id: string) {
  try {
    const path = join(STATUS_DIR, `${id}.json`);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {}
  return null;
}

function setStatus(id: string, status: Record<string, any>) {
  try {
    writeFileSync(join(STATUS_DIR, `${id}.json`), JSON.stringify(status));
  } catch {}
}

function updateDB(id: string, data: Record<string, any>) {
  setStatus(id, { ...getStatus(id), ...data });
}

// Extract video info with retry across multiple player clients
function extractVideoInfo(videoUrl: string, callback: (result: { ok: boolean; data?: any; error?: string; code?: string }) => void) {
  let attempt = 0;

  function tryClient() {
    const client = PLAYER_CLIENTS[attempt];
    console.log(`[video-info] Trying player_client=${client} for ${videoUrl}`);

    execFile(
      YT_DLP_PATH,
      [
        "--no-download", "--no-playlist", "--no-warnings", "--no-check-formats",
        "--extractor-args", `youtube:player_client=${client}`,
        "--print", "%(id)s|%(title)s|%(thumbnail)s|%(duration)s|%(channel)s|%(duration_string)s",
        videoUrl,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        // Check for "bot" or "sign in" errors in stderr
        const stderrStr = stderr || "";
        const isBotBlock = stderrStr.toLowerCase().includes("sign in to confirm") ||
                           stderrStr.toLowerCase().includes("bot");
        const isNotFound = stderrStr.toLowerCase().includes("video is unavailable") ||
                          stderrStr.toLowerCase().includes("not found") ||
                          stderrStr.toLowerCase().includes("private video");

        if (isNotFound) {
          callback({ ok: false, error: "Video not found. It may be private, deleted, or region-restricted.", code: "NOT_FOUND" });
          return;
        }

        // Parse stdout even if there was an error (yt-dlp sometimes outputs data before failing)
        if (stdout && stdout.trim().length > 0) {
          const lines = stdout.trim().split("\n").filter((l: string) => l.includes("|"));
          const lastLine = lines[lines.length - 1] || "";
          const parts = lastLine.split("|");
          if (parts.length >= 4) {
            const duration = parseInt(parts[3] || "0", 10);
            callback({
              ok: true,
              data: {
                videoId: parts[0] || "unknown",
                title: parts[1] || "Unknown Video",
                thumbnail: parts[2] || "",
                duration: isNaN(duration) ? 0 : duration,
                channel: parts[4] || "",
                durationString: parts[5] || "",
              },
            });
            return;
          }
        }

        // If bot blocked and we have more clients to try
        if (isBotBlock && attempt < PLAYER_CLIENTS.length - 1) {
          attempt++;
          tryClient();
          return;
        }

        // All attempts failed
        if (isBotBlock) {
          callback({ ok: false, error: "YouTube is temporarily blocking requests. Please wait a moment and try again.", code: "BOT_BLOCKED" });
        } else if (err) {
          callback({ ok: false, error: "Failed to extract video info. Please check the URL and try again.", code: "FETCH_FAILED" });
        } else {
          callback({ ok: false, error: "Could not parse video information.", code: "PARSE_ERROR" });
        }
      }
    );
  }

  tryClient();
}

const server = createServer((_req, res) => {
  const url = new URL(_req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", jobs: activeJobs.size }));
    return;
  }

  // GET /api/video-info?url=xxx
  if (pathname === "/api/video-info") {
    const videoUrl = url.searchParams.get("url");
    if (!videoUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing URL parameter", code: "MISSING_URL" }));
      return;
    }

    extractVideoInfo(videoUrl, (result) => {
      if (result.ok && result.data) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.data));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error || "Unknown error", code: result.code || "UNKNOWN" }));
      }
    });
    return;
  }

  // POST /api/download - Start a download
  if (pathname === "/api/download" && _req.method === "POST") {
    let body = "";
    _req.on("data", (chunk: Buffer) => body += chunk.toString());
    _req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const { id, url: videoUrl, format, quality } = data;
        if (!id || !videoUrl || !format || !quality) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields" }));
          return;
        }

        const outputFile = join(DOWNLOAD_DIR, `${id}.${format}`);
        const job = { id, url: videoUrl, format, quality, outputPath: outputFile, cancelled: false };
        activeJobs.set(id, job);

        // Start async processing
        processDownload(job).catch((err: Error) => {
          console.error(`Download ${id} failed:`, err.message);
          setStatus(id, { id, status: "failed", progress: 0, error: err.message });
          updateDB(id, { status: "failed", error: err.message });
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, status: "processing" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
    return;
  }

  // GET /api/status/:id
  if (pathname.startsWith("/api/status/")) {
    const id = pathname.split("/api/status/")[1];
    const status = getStatus(id);
    if (status) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Status not found" }));
    }
    return;
  }

  // GET /api/file/:id
  if (pathname.startsWith("/api/file/")) {
    const fileId = pathname.split("/api/file/")[1];
    const status = getStatus(fileId);
    const format = status?.format || "mp4";
    const filePath = join(DOWNLOAD_DIR, `${fileId}.${format}`);

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("File not found");
      return;
    }

    const stat = statSync(filePath);
    const ext = format === "mp3" ? "audio/mpeg" : "video/mp4";
    res.writeHead(200, {
      "Content-Type": ext,
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${fileId}.${format}"`,
    });

    const stream = createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  // POST /api/cancel/:id
  if (pathname.startsWith("/api/cancel/") && _req.method === "POST") {
    const id = pathname.split("/api/cancel/")[1];
    const job = activeJobs.get(id);
    if (job) {
      job.cancelled = true;
      setStatus(id, { id, status: "failed", progress: 0, error: "Cancelled by user" });
      updateDB(id, { status: "failed", error: "Cancelled by user" });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// Download with retry across player clients
async function processDownload(job: { id: string; url: string; format: string; quality: string; outputPath: string; cancelled: boolean }) {
  setStatus(job.id, { id: job.id, status: "processing", progress: 0, message: "Starting download..." });
  updateDB(job.id, { status: "processing", progress: 0 });

  for (const client of PLAYER_CLIENTS) {
    if (job.cancelled) break;

    console.log(`[download] Trying player_client=${client} for ${job.url}`);
    try {
      await downloadWithClient(job, client);
      return; // Success!
    } catch (err: any) {
      const msg = err.message || "";
      const isBotBlock = msg.toLowerCase().includes("sign in") || msg.toLowerCase().includes("bot");

      if (isBotBlock && !job.cancelled) {
        console.log(`[download] ${client} blocked, trying next client...`);
        continue; // Try next client
      }
      throw err; // Re-throw non-recoverable errors
    }
  }

  // All clients failed
  throw new Error("YouTube is temporarily blocking downloads. Please try again in a moment.");
}

function downloadWithClient(job: { id: string; url: string; format: string; quality: string; outputPath: string; cancelled: boolean }, playerClient: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args: string[] = [
      "--newline", "--no-playlist",
      "--no-warnings", "--progress", "--progress-delta", "1",
      "--extractor-args", `youtube:player_client=${playerClient}`,
    ];

    if (job.format === "mp3") {
      args.push("-x", "--audio-format", "mp3");
      const bitrate = job.quality || "192";
      args.push("--audio-quality", "0");
      args.push("--postprocessor-args", `-ab ${bitrate}k`);
    } else {
      const formatMap: Record<string, string> = {
        "360": "worst[ext=mp4]",
        "480": "480p[ext=mp4]",
        "720": "best[height<=720][ext=mp4]",
        "1080": "best[height<=1080][ext=mp4]",
      };
      const fmt = formatMap[job.quality] || "best[height<=720][ext=mp4]";
      args.push("-f", fmt, "--merge-output-format", "mp4");
    }

    args.push("-o", job.outputPath);
    args.push(job.url);

    const proc = spawn(YT_DLP_PATH, args);
    let stderrOutput = "";

    proc.stdout.on("data", (data: Buffer) => {
      if (job.cancelled) { proc.kill("SIGKILL"); return; }
      const output = data.toString();
      const progressMatch = output.match(/(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        const status = { id: job.id, status: "processing", progress, message: `Downloading... ${progress.toFixed(1)}%` };
        setStatus(job.id, status);
        updateDB(job.id, { progress });
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (job.cancelled) { proc.kill("SIGKILL"); return; }
      const errStr = data.toString();
      stderrOutput += errStr;
      const progressMatch = errStr.match(/(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        setStatus(job.id, { id: job.id, status: "processing", progress });
        updateDB(job.id, { progress });
      }
    });

    proc.on("close", (code) => {
      if (job.cancelled) {
        reject(new Error("Cancelled"));
        return;
      }

      const isBotBlock = stderrOutput.toLowerCase().includes("sign in to confirm") ||
                          stderrOutput.toLowerCase().includes("bot");

      if (code === 0 && existsSync(job.outputPath)) {
        try {
          const stat = statSync(job.outputPath);
          setStatus(job.id, { id: job.id, status: "completed", progress: 100, fileSize: stat.size, format: job.format, message: "Download complete!" });
          updateDB(job.id, { status: "completed", progress: 100, fileSize: stat.size });
          resolve();
        } catch (err) {
          reject(new Error("Failed to verify downloaded file"));
        }
      } else if (isBotBlock) {
        // Clean up partial file
        if (existsSync(job.outputPath)) {
          try { unlinkSync(job.outputPath); } catch {}
        }
        reject(new Error("YouTube bot block — retry with different client"));
      } else {
        reject(new Error(`Download failed (exit code ${code})`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start download: ${err.message}`));
    });
  });
}

server.listen(PORT, () => {
  console.log(`Download worker running on port ${PORT}`);
});
