import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

export const maxDuration = 120;

function isHtmlResponse(text: string): boolean {
  return text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html");
}

// Normalize YouTube URL — strip tracking params, handle all formats
function normalizeYouTubeUrl(rawUrl: string): { valid: boolean; cleanUrl: string; videoId: string | null } {
  try {
    const parsed = new URL(rawUrl);

    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    ];

    let videoId: string | null = null;
    for (const pattern of patterns) {
      const match = rawUrl.match(pattern);
      if (match) {
        videoId = match[1];
        break;
      }
    }

    if (!videoId) {
      return { valid: false, cleanUrl: rawUrl, videoId: null };
    }

    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return { valid: true, cleanUrl, videoId };
  } catch {
    const simpleMatch = rawUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (simpleMatch) {
      return { valid: true, cleanUrl: `https://www.youtube.com/watch?v=${simpleMatch[1]}`, videoId: simpleMatch[1] };
    }
    return { valid: false, cleanUrl: rawUrl, videoId: null };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Please enter a YouTube URL", code: "EMPTY_URL" },
        { status: 400 }
      );
    }

    const trimmed = url.trim();
    const { valid, cleanUrl } = normalizeYouTubeUrl(trimmed);

    if (!valid) {
      return NextResponse.json(
        {
          error: "Invalid YouTube URL. Supported formats:\n• youtube.com/watch?v=...\n• youtu.be/...\n• youtube.com/shorts/...\n• youtube.com/live/...",
          code: "INVALID_URL",
        },
        { status: 400 }
      );
    }

    // Proxy to worker's video-info endpoint
    const workerRes = await fetchWorker(`/api/video-info?url=${encodeURIComponent(cleanUrl)}`);

    if (!workerRes.ok) {
      // Read response as text first to handle both JSON and plain text responses
      const responseText = await workerRes.text().catch(() => "");
      console.error(`[video-info] Worker error: status=${workerRes.status}, body=${responseText.slice(0, 500)}`);

      let errorData: { error?: string; code?: string };
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { error: responseText || `Worker returned status ${workerRes.status}`, code: "WORKER_ERROR" };
      }

      const errorMap: Record<string, { error: string; code: string; status: number }> = {
        NOT_FOUND: {
          error: "Video not found. It may be private, deleted, or region-restricted.",
          code: "NOT_FOUND",
          status: 400,
        },
        ACCESS_DENIED: {
          error: "This video is age-restricted or requires sign-in.",
          code: "ACCESS_DENIED",
          status: 403,
        },
        BOT_BLOCKED: {
          error: "YouTube is blocking requests. This is usually temporary — wait a moment and try again.",
          code: "BOT_BLOCKED",
          status: 503,
        },
        TIMEOUT: {
          error: "YouTube is taking too long to respond. Please try again in a moment.",
          code: "TIMEOUT",
          status: 504,
        },
      };

      // Handle worker auth failure
      if (workerRes.status === 401 || responseText.includes("Unauthorized")) {
        console.error("[video-info] Worker authentication failed — check WORKER_SECRET");
        return NextResponse.json(
          { error: "Worker authentication error. Please try again.", code: "SERVER_ERROR" },
          { status: 500 }
        );
      }

      // Handle container still waking (HTML page returned)
      if (isHtmlResponse(responseText)) {
        console.error("[video-info] Container still sleeping");
        return NextResponse.json(
          { error: "Server is starting up. Please wait a moment and try again.", code: "WARMING_UP" },
          { status: 503 }
        );
      }

      const mapped = errorMap[errorData.code];
      if (mapped) {
        return NextResponse.json(
          { error: mapped.error, code: mapped.code, videoId: null },
          { status: mapped.status }
        );
      }

      return NextResponse.json(
        { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
        { status: workerRes.status || 500 }
      );
    }

    const data = await workerRes.json();
    return NextResponse.json({
      id: data.videoId,
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      channel: data.channel,
    });
  } catch (error: unknown) {
    console.error("Video info error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
