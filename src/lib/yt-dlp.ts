import { execFile } from "child_process";
import { existsSync, chmodSync, createWriteStream, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import https from "https";
import http from "http";

const YTDLP_PATH = "/tmp/yt-dlp";
const YTDLP_DOWNLOAD_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp-linux";

let ytdlpReady: Promise<string> | null = null;

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (res: http.IncomingMessage) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          downloadFile(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          chmodSync(dest, 0o755);
          resolve();
        });
      })
      .on("error", reject);
  });
}

export async function ensureYtDlp(): Promise<string> {
  if (existsSync(YTDLP_PATH)) return YTDLP_PATH;

  if (!ytdlpReady) {
    ytdlpReady = downloadFile(YTDLP_DOWNLOAD_URL, YTDLP_PATH).then(
      () => YTDLP_PATH
    );
  }

  return ytdlpReady;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  channel: string;
  formats: Array<{
    format_id: string;
    ext: string;
    resolution?: string;
    fps?: number;
    vcodec?: string;
    acodec?: string;
    filesize?: number;
    filesize_approx?: number;
    tbr?: number;
  }>;
}

export async function getVideoInfo(videoUrl: string): Promise<VideoInfo> {
  const ytdlp = await ensureYtDlp();

  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-download",
      "--no-playlist",
      "--no-cache-dir",
      videoUrl,
    ];

    execFile(
      ytdlp,
      args,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.toString() || error.message;

          if (
            msg.includes("Video unavailable") ||
            msg.includes("not found")
          ) {
            reject(new Error("NOT_FOUND"));
          } else if (
            msg.includes("bot") ||
            msg.includes("blocked") ||
            msg.includes("Sign in")
          ) {
            reject(new Error("BOT_BLOCKED"));
          } else if (
            msg.includes("Private") ||
            msg.includes("age-restricted")
          ) {
            reject(new Error("ACCESS_DENIED"));
          } else {
            reject(new Error(msg || "Failed to extract video info"));
          }
          return;
        }

        try {
          const data = JSON.parse(stdout);
          resolve({
            id: data.id,
            title: data.title,
            thumbnail: data.thumbnail || "",
            duration: data.duration || 0,
            channel: data.channel || data.uploader || "",
            formats: (data.formats || []).map((f: Record<string, unknown>) => ({
              format_id: f.format_id as string,
              ext: f.ext as string,
              resolution: f.resolution as string | undefined,
              fps: f.fps as number | undefined,
              vcodec: f.vcodec as string | undefined,
              acodec: f.acodec as string | undefined,
              filesize: f.filesize as number | undefined,
              filesize_approx: f.filesize_approx as number | undefined,
              tbr: f.tbr as number | undefined,
            })),
          });
        } catch {
          reject(new Error("Failed to parse video info"));
        }
      }
    );
  });
}

export interface DownloadOptions {
  url: string;
  format: "mp4" | "audio";
  quality: string; // "360", "480", "720", "1080" for mp4; "128", "192", "320" for audio
  outputDir: string;
  onProgress?: (percent: number) => void;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const ytdlp = await ensureYtDlp();

  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  const outputTemplate = join(options.outputDir, "%(id)s.%(ext)s");

  let formatFilter: string;
  let extraArgs: string[] = [];

  if (options.format === "mp4") {
    const resMap: Record<string, string> = {
      "360": "[height<=360]",
      "480": "[height<=480]",
      "720": "[height<=720]",
      "1080": "[height<=1080]",
    };
    const heightFilter = resMap[options.quality] || "[height<=720]";
    formatFilter = `bestvideo[ext=mp4]${heightFilter}+bestaudio[ext=m4a]/best[ext=mp4]${heightFilter}/best${heightFilter}`;
    extraArgs.push("--merge-output-format", "mp4");
  } else {
    // Audio — download best quality m4a (no ffmpeg needed)
    const bitrateMap: Record<string, string> = {
      "128": "[abr<=128]",
      "192": "[abr<=192]",
      "320": "[abr<=320]",
    };
    const brFilter = bitrateMap[options.quality] || "";
    formatFilter = `bestaudio[ext=m4a]${brFilter}/bestaudio${brFilter}`;
    extraArgs.push("--extract-audio");
  }

  const args = [
    "--no-playlist",
    "--no-cache-dir",
    "-f",
    formatFilter,
    "-o",
    outputTemplate,
    ...extraArgs,
    "--newline",
    options.url,
  ];

  return new Promise((resolve, reject) => {
    const proc = execFile(
      ytdlp,
      args,
      { timeout: 240000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const errMsg =
            stderr?.toString() || error.message || "Download failed";
          reject(new Error(errMsg));
          return;
        }

        try {
          const files = readdirSync(options.outputDir);
          if (files.length === 0) {
            reject(new Error("Download completed but no file found"));
            return;
          }

          const filePath = join(options.outputDir, files[0]);
          const stats = statSync(filePath);
          const ext = files[0].split(".").pop() || "mp4";

          const mimeType =
            options.format === "audio" ? "audio/mp4" : "video/mp4";

          resolve({
            filePath,
            fileName: files[0],
            fileSize: stats.size,
            mimeType,
          });
        } catch {
          reject(new Error("Failed to read downloaded file"));
        }
      }
    );

    // Parse progress from stderr
    if (options.onProgress && proc.stderr) {
      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          options.onProgress!(parseFloat(match[1]));
        }
      });
    }
  });
}
