import { createServer } from "http";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execFile, spawn } from "child_process";

const PORT = 3003;
const DOWNLOAD_DIR = join(process.cwd(), "..", "..", "download");
const YT_DLP_PATH = "/home/z/.local/bin/yt-dlp";
const STATUS_DIR = join(process.cwd(), "status");

// Strategy: try impersonation first (most reliable), then fallback to player clients
const INFO_STRATEGIES = [
  { args: ["--impersonate", "Chrome-136", "--no-check-formats"], name: "Chrome-136 impersonation" },
  { args: ["--impersonate", "Safari-18.4:Ios-18.4", "--no-check-formats"], name: "Safari-iOS impersonation" },
  { args: ["--impersonate", "Firefox-147", "--no-check-formats"], name: "Firefox impersonation" },
  { args: ["--extractor-args", "youtube:player_client=mediaconnect", "--no-check-formats"], name: "mediaconnect client" },
  { args: ["--extractor-args", "youtube:player_client=web", "--no-check-formats"], name: "web client" },
  { args: ["--extractor-args", "youtube:player_client=tv", "--no-check-formats"], name: "tv client" },
];

const DOWNLOAD_STRATEGIES = [
  { args: ["--impersonate", "Chrome-136"], name: "Chrome-136 impersonation" },
  { args: ["--impersonate", "Safari-18.4:Ios-18.4"], name: "Safari-iOS impersonation" },
  { args: ["--extractor-args", "youtube:player_client=mediaconnect"], name: "mediaconnect client" },
  { args: ["--extractor-args", "youtube:player_client=web"], name: "web client" },
  { args: ["--extractor-args", "youtube:player_client=tv"], name: "tv client" },
];

// Ensure directories exist
if (!existsSync(DOWNLOAD_DIR)) mkdirSync(DOWNLOAD_DIR, { recursive: true });
if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true });

const activeJobs = new Map<string, any>();

function getStatus(id: string) {
  try {
    const p = join(STATUS_DIR, `${id}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  } catch {}
  return null;
}

function setStatus(id: string, status: Record<string, any>) {
  try { writeFileSync(join(STATUS_DIR, `${id}.json`), JSON.stringify(status)); } catch {}
}

// Sleep helper
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Detect if error is a YouTube bot block
function isBotBlock(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("sign in to confirm") ||
         lower.includes("bot") ||
         lower.includes("too many requests");
}

function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("video is unavailable") ||
         lower.includes("not found") ||
         lower.includes("private video") ||
         lower.includes("members-only");
}

// Extract video info with retry across multiple strategies
function extractVideoInfo(videoUrl: string, callback: (result: { ok: boolean; data?: any; error?: string; code?: string }) => void) {
  let attempt = 0;

  function tryNext() {
    if (attempt >= INFO_STRATEGIES.length) {
      callback({ ok: false, error: "YouTube is blocking requests from this server. Try refreshing the page and attempting again. Some videos may work better than others.", code: "BOT_BLOCKED" });
      return;
    }

    const strategy = INFO_STRATEGIES[attempt];
    console.log(`[video-info] Attempt ${attempt + 1}/${INFO_STRATEGIES.length}: ${strategy.name} for ${videoUrl}`);

    execFile(
      YT_DLP_PATH,
      [
        "--no-download", "--no-playlist", "--no-warnings",
        ...strategy.args,
        "--print", "%(id)s|%(title)s|%(thumbnail)s|%(duration)s|%(channel)s|%(duration_string)s",
        videoUrl,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const stderrStr = stderr || "";

        if (isNotFoundError(stderrStr)) {
          callback({ ok: false, error: "Video not found. It may be private, deleted, or region-restricted.", code: "NOT_FOUND" });
          return;
        }

        // Check if we got valid stdout data
        if (stdout && stdout.trim().length > 0) {
          const lines = stdout.trim().split("\n").filter((l: string) => l.includes("|"));
          const lastLine = lines[lines.length - 1] || "";
          const parts = lastLine.split("|");
          if (parts.length >= 4 && parts[0] && parts[0].length > 5) {
            const duration = parseInt(parts[3] || "0", 10);
            console.log(`[video-info] Success with ${strategy.name}`);
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

        // Bot block — try next strategy
        if (isBotBlock(stderrStr)) {
          attempt++;
          // Small delay between retries to avoid rate limiting
          setTimeout(tryNext, 1000);
          return;
        }

        // Other error — try next strategy
        attempt++;
        tryNext();
      }
    );
  }

  tryNext();
}

const server = createServer((_req, res) => {
  const url = new URL(_req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

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
        const code = result.code || "FETCH_FAILED";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error || "Unknown error", code }));
      }
    });
    return;
  }

  // POST /api/download
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

        processDownload(job).catch((err: Error) => {
          console.error(`Download ${id} failed:`, err.message);
          setStatus(id, { id, status: "failed", progress: 0, error: err.message });
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
    createReadStream(filePath).pipe(res);
    return;
  }

  // POST /api/cancel/:id
  if (pathname.startsWith("/api/cancel/") && _req.method === "POST") {
    const id = pathname.split("/api/cancel/")[1];
    const job = activeJobs.get(id);
    if (job) {
      job.cancelled = true;
      setStatus(id, { id, status: "failed", progress: 0, error: "Cancelled by user" });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// Download with retry across strategies
async function processDownload(job: { id: string; url: string; format: string; quality: string; outputPath: string; cancelled: boolean }) {
  setStatus(job.id, { id: job.id, status: "processing", progress: 0, message: "Starting download..." });

  for (let i = 0; i < DOWNLOAD_STRATEGIES.length; i++) {
    if (job.cancelled) break;

    const strategy = DOWNLOAD_STRATEGIES[i];
    console.log(`[download] Attempt ${i + 1}/${DOWNLOAD_STRATEGIES.length}: ${strategy.name} for ${job.url}`);

    try {
      await downloadWithStrategy(job, strategy.args);
      return; // Success!
    } catch (err: any) {
      const msg = err.message || "";
      if (isBotBlock(msg) && !job.cancelled) {
        console.log(`[download] ${strategy.name} blocked, trying next...`);
        // Brief cooldown between retries
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }

  throw new Error("YouTube is temporarily blocking downloads from this server. Please try again in a few minutes.");
}

function downloadWithStrategy(job: { id: string; url: string; format: string; quality: string; outputPath: string; cancelled: boolean }, extraArgs: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args: string[] = [
      "--newline", "--no-playlist", "--no-warnings", "--progress", "--progress-delta", "1",
      ...extraArgs,
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
        setStatus(job.id, { id: job.id, status: "processing", progress, message: `Downloading... ${progress.toFixed(1)}%` });
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (job.cancelled) { proc.kill("SIGKILL"); return; }
      stderrOutput += data.toString();
      const progressMatch = data.toString().match(/(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        setStatus(job.id, { id: job.id, status: "processing", progress });
      }
    });

    proc.on("close", (code) => {
      if (job.cancelled) { reject(new Error("Cancelled")); return; }

      if (code === 0 && existsSync(job.outputPath)) {
        try {
          const stat = statSync(job.outputPath);
          setStatus(job.id, { id: job.id, status: "completed", progress: 100, fileSize: stat.size, format: job.format, message: "Download complete!" });
          resolve();
        } catch { reject(new Error("Failed to verify file")); }
      } else if (isBotBlock(stderrOutput)) {
        if (existsSync(job.outputPath)) try { unlinkSync(job.outputPath); } catch {}
        reject(new Error("YouTube bot block"));
      } else {
        reject(new Error(`Download failed (exit code ${code})`));
      }
    });

    proc.on("error", (err) => reject(new Error(`Failed to start: ${err.message}`)));
  });
}

server.listen(PORT, () => {
  console.log(`Download worker running on port ${PORT}`);
});
