import { NextRequest, NextResponse } from "next/server";
import { getVideoInfo } from "@/lib/yt-dlp";

export const maxDuration = 60;

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

    // Extract video info using local yt-dlp
    const info = await getVideoInfo(cleanUrl);
    return NextResponse.json({
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      channel: info.channel,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    const errorMap: Record<string, { error: string; code: string; status: number }> = {
      NOT_FOUND: {
        error: "Video not found. It may be private, deleted, or region-restricted.",
        code: "NOT_FOUND",
        status: 400,
      },
      BOT_BLOCKED: {
        error: "YouTube is blocking requests. This is usually temporary — wait a moment and try again.",
        code: "BOT_BLOCKED",
        status: 503,
      },
      ACCESS_DENIED: {
        error: "This video is age-restricted or requires sign-in.",
        code: "ACCESS_DENIED",
        status: 403,
      },
    };

    const mapped = errorMap[msg];
    if (mapped) {
      return NextResponse.json(
        { error: mapped.error, code: mapped.code, videoId: null },
        { status: mapped.status }
      );
    }

    console.error("Video info error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
