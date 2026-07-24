import { createServer } from "http";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execFile, spawn } from "child_process";

const PORT = 3003;
const DOWNLOAD_DIR = join(process.cwd(), "..", "..", "download");
const YT_DLP_PATH = "/home/z/.local/bin/yt-dlp";
const STATUS_DIR = join(process.cwd(), "status");

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
  // Status is updated via files, the Next.js API reads these files
  // to get the latest progress from the worker
  setStatus(id, { ...getStatus(id), ...data });
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
      res.end(JSON.stringify({ error: "Missing URL parameter" }));
      return;
    }

    execFile(
      YT_DLP_PATH,
      [
        "--no-download", "--no-playlist", "--no-warnings", "--no-check-formats",
        "--print", "%(id)s|%(title)s|%(thumbnail)s|%(duration)s|%(channel)s|%(duration_string)s",
        videoUrl,
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to extract video info. Check the URL and try again." }));
          return;
        }
        try {
          const lines = stdout.trim().split("\n").filter((l: string) => l.includes("|"));
          const lastLine = lines[lines.length - 1] || "";
          const parts = lastLine.split("|");
          const duration = parseInt(parts[3] || "0", 10);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            videoId: parts[0] || "unknown",
            title: parts[1] || "Unknown Video",
            thumbnail: parts[2] || "",
            duration: isNaN(duration) ? 0 : duration,
            channel: parts[4] || "",
            durationString: parts[5] || "",
          }));
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to parse video info" }));
        }
      }
    );
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

  // GET /api/status/:id - Get download status
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

  // GET /api/file/:id - Serve downloaded file
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

  // POST /api/cancel/:id - Cancel download
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

async function processDownload(job: { id: string; url: string; format: string; quality: string; outputPath: string; cancelled: boolean }) {
  setStatus(job.id, { id: job.id, status: "processing", progress: 0, message: "Starting download..." });
  updateDB(job.id, { status: "processing", progress: 0 });

  return new Promise<void>((resolve, reject) => {
    const args: string[] = [
      "--newline", "--no-playlist",
      "--no-warnings", "--progress", "--progress-delta", "1",
      "--extractor-args", "youtube:player_client=mediaconnect",
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
      if (code === 0 && existsSync(job.outputPath)) {
        try {
          const stat = statSync(job.outputPath);
          const status = { id: job.id, status: "completed", progress: 100, fileSize: stat.size, format: job.format, message: "Download complete!" };
          setStatus(job.id, status);
          updateDB(job.id, { status: "completed", progress: 100, fileSize: stat.size });
          resolve();
        } catch (err) {
          reject(new Error("Failed to verify downloaded file"));
        }
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
