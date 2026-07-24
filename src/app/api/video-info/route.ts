import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate YouTube URL
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)/;
    if (!ytRegex.test(url)) {
      return NextResponse.json(
        { error: "Please enter a valid YouTube URL" },
        { status: 400 }
      );
    }

    // Forward to download worker
    const workerUrl = `${url}`;
    const workerResponse = await fetch(
      `http://localhost:3003/api/video-info?url=${encodeURIComponent(workerUrl)}`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!workerResponse.ok) {
      const errorData = await workerResponse.json();
      return NextResponse.json(
        { error: errorData.error || "Failed to extract video info" },
        { status: workerResponse.status }
      );
    }

    const videoInfo = await workerResponse.json();
    return NextResponse.json(videoInfo);
  } catch (error: any) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out. Please try again." },
        { status: 504 }
      );
    }
    console.error("Video info error:", error);
    return NextResponse.json(
      { error: "Failed to extract video information" },
      { status: 500 }
    );
  }
}
