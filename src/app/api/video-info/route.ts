import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

// Normalize YouTube URL — strip tracking params, handle all formats
function normalizeYouTubeUrl(rawUrl: string): { valid: boolean; cleanUrl: string; videoId: string | null } {
  try {
    const parsed = new URL(rawUrl);

    // Extract video ID from various YouTube URL formats
    const patterns = [
      // youtube.com/watch?v=...
      /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      // youtube.com/shorts/...
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      // youtu.be/...
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      // youtube.com/live/...
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

    // Rebuild a clean URL: youtube.com/watch?v=VIDEO_ID
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return { valid: true, cleanUrl, videoId };
  } catch {
    // Try regex fallback for non-standard URLs
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

    // Validate and normalize YouTube URL
    const { valid, cleanUrl, videoId } = normalizeYouTubeUrl(trimmed);

    if (!valid) {
      return NextResponse.json(
        {
          error: "Invalid YouTube URL. Supported formats:\n• youtube.com/watch?v=...\n• youtu.be/...\n• youtube.com/shorts/...\n• youtube.com/live/...",
          code: "INVALID_URL",
        },
        { status: 400 }
      );
    }

    // Forward to download worker with clean URL (auto-starts worker if needed)
    const workerResponse = await fetchWorker(
      `/api/video-info?url=${encodeURIComponent(cleanUrl)}`,
      { signal: AbortSignal.timeout(70000) }
    );

    if (!workerResponse.ok) {
      const errorData = await workerResponse.json().catch(() => ({}));
      const errorCode = errorData.code || "FETCH_FAILED";

      // Map error codes to user-friendly messages
      const errorMessages: Record<string, string> = {
        FETCH_FAILED: "Failed to extract video info. The video may be private, age-restricted, or unavailable in this region.",
        BOT_BLOCKED: "YouTube is blocking requests. This is usually temporary — wait a moment and try again, or try a different video.",
        RATE_LIMITED: "Too many requests. Please wait a few seconds and try again.",
        NOT_FOUND: "Video not found. It may be private, deleted, or region-restricted.",
        ACCESS_DENIED: "This video is age-restricted or requires sign-in. Try a different video.",
        TIMEOUT: "YouTube took too long to respond. Please try again.",
      };

      return NextResponse.json(
        {
          error: errorMessages[errorCode] || errorData.error || "Failed to extract video info. Please try again.",
          code: errorCode,
          videoId,
        },
        { status: workerResponse.status === 400 ? 400 : 500 }
      );
    }

    const videoInfo = await workerResponse.json();
    return NextResponse.json(videoInfo);
  } catch (error: any) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out. YouTube may be slow right now — please try again.", code: "TIMEOUT" },
        { status: 504 }
      );
    }
    console.error("Video info error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
