import { createServer } from "http";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execFile, spawn } from "child_process";

// --- Deployment-ready configuration ---
const PORT = parseInt(process.env.PORT || "3003", 10);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || join(process.cwd(), "downloads");
const YT_DLP_PATH = process.env.YT_DLP_PATH || "/usr/local/bin/yt-dlp";
const STATUS_DIR = join(process.cwd(), "status");
const WORKER_SECRET = process.env.WORKER_SECRET || "";

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  "https://vortextube.vercel.app",
  "https://vortextube-git-*.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

// INFO_STRATEGIES: ordered from simplest → most aggressive
const INFO_STRATEGIES = [
  { args: [], name: "basic extraction" },
  { args: ["--no-cache-dir"], name: "basic (no cache)" },
  { args: ["--impersonate", "Chrome-136", "--no-check-formats"], name: "Chrome-136 impersonation" },
  { args: ["--impersonate", "Safari-18.4:Ios-18.4", "--no-check-formats"], name: "Safari-iOS impersonation" },
  { args: ["--extractor-args", "youtube:player_client=mediaconnect", "--no-check-formats"], name: "mediaconnect client" },
  { args: ["--extractor-args", "youtube:player_client=web", "--no-check-formats"], name: "web client" },
  { args: ["--extractor-args", "youtube:player_client=tv", "--no-check-formats"], name: "tv client" },
  { args: ["--extractor-args", "youtube:player_client=ios", "--no-check-formats"], name: "ios client" },
  { args: ["--extractor-args", "youtube:player_client=android", "--no-check-formats"], name: "android client" },
];

// DOWNLOAD_STRATEGIES: same ordering principle
const DOWNLOAD_STRATEGIES = [
  { args: [], name: "basic extraction" },
  { args: ["--impersonate", "Chrome-136"], name: "Chrome-136 impersonation" },
  { args: ["--impersonate", "Safari-18.4:Ios-18.4"], name: "Safari-iOS impersonation" },
  { args: ["--extractor-args", "youtube:player_client=mediaconnect"], name: "mediaconnect client" },
  { args: ["--extractor-args", "youtube:player_client=web"], name: "web client" },
  { args: ["--extractor-args", "youtube:player_client=tv"], name: "tv client" },
  { args: ["--extractor-args", "youtube:player_client=ios"], name: "ios client" },
];

// Ensure directories exist
if (!existsSync(DOWNLOAD_DIR)) mkdirSync(DOWNLOAD_DIR, { recursive: true });
if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true });

const activeJobs = new Map<string, any>();

// --- CORS helpers ---
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Match wildcard patterns like vortextube-git-*.vercel.app
  for (const pattern of ALLOWED_ORIGINS) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\./g, "\\.") + "$");
      if (regex.test(origin)) return true;
    }
  }
  return false;
}

function setCorsHeaders(req: any, res: any) {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-worker-secret");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// --- Auth middleware ---
function isAuthenticated(req: any, res: any): boolean {
  // If no WORKER_SECRET is configured, skip auth (local dev)
  if (!WORKER_SECRET) return true;
  const secret = req.headers["x-worker-secret"];
  if (secret === WORKER_SECRET) return true;
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }));
  return false;
}

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

// Detect if error is a YouTube bot block (specific patterns only)
function isBotBlock(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("sign in to confirm") ||
         lower.includes("sign in to confirm you're not a bot") ||
         lower.includes("our systems have detected unusual traffic") ||
         lower.includes("too many requests") ||
         lower.includes("http error 429") ||
         (lower.includes("bot") && lower.includes("traffic"));
}

// Check if the error is an HTTP 403 / access denied
function isAccessDenied(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("http error 403") ||
         lower.includes("forbidden") ||
         lower.includes("age-restricted");
}

function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("video is unavailable") ||
         lower.includes("not found") ||
         lower.includes("private video") ||
         lower.includes("members-only") ||
         lower.includes("this video is private") ||
         lower.includes("this live event has ended");
}

// Extract video info with retry across multiple strategies
function extractVideoInfo(
  videoUrl: string,
  callback: (result: { ok: boolean; data?: any; error?: string; code?: string; attempts?: number }) => void
) {
  let attempt = 0;
  const startTime = Date.now();
  const MAX_TOTAL_TIME = 55000; // 55s max total for info extraction

  function tryNext() {
    // Check overall timeout
    if (Date.now() - startTime > MAX_TOTAL_TIME) {
      callback({
        ok: false,
        error: "YouTube is taking too long to respond. Please try again in a moment.",
        code: "TIMEOUT",
        attempts: attempt,
      });
      return;
    }

    if (attempt >= INFO_STRATEGIES.length) {
      callback({
        ok: false,
        error: "YouTube is temporarily blocking requests from this server. Please try a different video or wait a minute and retry.",
        code: "BOT_BLOCKED",
        attempts: attempt,
      });
      return;
    }

    const strategy = INFO_STRATEGIES[attempt];
    console.log(`[video-info] Attempt ${attempt + 1}/${INFO_STRATEGIES.length}: ${strategy.name} for ${videoUrl}`);

    const baseArgs = [
      "--no-download", "--no-playlist", "--no-warnings",
      ...strategy.args,
      "--print", "%(id)s|%(title)s|%(thumbnail)s|%(duration)s|%(channel)s|%(duration_string)s",
    ];

    execFile(
      YT_DLP_PATH,
      [...baseArgs, videoUrl],
      { timeout: 12000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const stderrStr = stderr || "";

        // If process errored but we still got valid stdout data, use it
        if (stdout && stdout.trim().length > 0) {
          const lines = stdout.trim().split("\n").filter((l: string) => l.includes("|"));
          const lastLine = lines[lines.length - 1] || "";
          const parts = lastLine.split("|");
          if (parts.length >= 4 && parts[0] && parts[0].length > 5) {
            const duration = parseInt(parts[3] || "0", 10);
            console.log(`[video-info] ✓ Success with strategy: ${strategy.name} (attempt ${attempt + 1})`);
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
              attempts: attempt + 1,
            });
            return;
          }
        }

        // Not found — don't retry, fail immediately
        if (isNotFoundError(stderrStr)) {
          callback({ ok: false, error: "Video not found. It may be private, deleted, or region-restricted.", code: "NOT_FOUND", attempts: attempt + 1 });
          return;
        }

        // Access denied — don't retry, fail immediately
        if (isAccessDenied(stderrStr)) {
          callback({ ok: false, error: "This video is age-restricted or requires sign-in. Try a different video.", code: "ACCESS_DENIED", attempts: attempt + 1 });
          return;
        }

        // Bot block — try next strategy with increasing delay
        if (isBotBlock(stderrStr) || (err && err.code === 1)) {
          console.log(`[video-info] ✗ Strategy "${strategy.name}" blocked or failed (attempt ${attempt + 1}/${INFO_STRATEGIES.length})`);
          attempt++;
          const delay = Math.min(1500 + attempt * 500, 5000);
          setTimeout(tryNext, delay);
          return;
        }

        // Any other failure — try next strategy
        console.log(`[video-info] ✗ Strategy "${strategy.name}" returned no data (attempt ${attempt + 1}/${INFO_STRATEGIES.length})`);
        attempt++;
        setTimeout(tryNext, 800);
      }
    );
  }

  tryNext();
}

const server = createServer((_req, res) => {
  const url = new URL(_req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Set CORS headers on all responses
  setCorsHeaders(_req, res);

  // Handle preflight OPTIONS requests
  if (_req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health endpoint — no auth required
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", jobs: activeJobs.size }));
    return;
  }

  // Auth check for all API routes
  if (!isAuthenticated(_req, res)) return;

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
        res.writeHead(code === "NOT_FOUND" || code === "ACCESS_DENIED" ? 404 : 500, { "Content-Type": "application/json" });
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
    setStatus(job.id, { id: job.id, status: "processing", progress: 0, message: `Trying ${strategy.name}...` });

    try {
      await downloadWithStrategy(job, strategy.args);
      return; // Success!
    } catch (err: any) {
      const msg = err.message || "";
      if (isBotBlock(msg) && !job.cancelled) {
        console.log(`[download] ${strategy.name} blocked, trying next...`);
        await sleep(2000 + i * 1000);
        continue;
      }
      throw err;
    }
  }

  throw new Error("YouTube is temporarily blocking downloads. Please try again in a few minutes or try a different video.");
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
      } else if (stderrOutput.includes("Requested format is not available")) {
        if (existsSync(job.outputPath)) try { unlinkSync(job.outputPath); } catch {}
        reject(new Error(`The requested quality (${job.format === "mp4" ? job.quality + "p" : job.quality + "kbps"}) is not available for this video. Please try a different quality.`));
      } else {
        reject(new Error(`Download failed: ${stderrOutput.slice(-200) || `exit code ${code}`}`));
      }
    });

    proc.on("error", (err) => reject(new Error(`Failed to start download: ${err.message}`)));
  });
}

server.listen(PORT, () => {
  console.log(`Download worker running on port ${PORT}`);
  console.log(`  Download dir: ${DOWNLOAD_DIR}`);
  console.log(`  yt-dlp path:  ${YT_DLP_PATH}`);
  console.log(`  Worker secret: ${WORKER_SECRET ? "***configured***" : "***not set (auth disabled)***"}`);
});
