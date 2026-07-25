import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const { url, format, quality, title, thumbnail, duration, channel } = await request.json();

    if (!url || !format || !quality) {
      return NextResponse.json(
        { error: "URL, format, and quality are required" },
        { status: 400 }
      );
    }

    // Extract video ID from URL
    const videoIdMatch = url.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    const videoId = videoIdMatch ? videoIdMatch[1] : "unknown";

    // Create download task in database
    const task = await db.downloadTask.create({
      data: {
        url,
        videoId,
        title: title || "Unknown Video",
        thumbnail: thumbnail || null,
        duration: duration ? parseInt(duration, 10) : null,
        channel: channel || null,
        format,
        quality,
        status: "pending",
        progress: 0,
      },
    });

    return NextResponse.json({
      id: task.id,
      status: "pending",
      message: "Download task created",
    });
  } catch (error) {
    console.error("Create download error:", error);
    return NextResponse.json(
      { error: "Failed to create download task" },
      { status: 500 }
    );
  }
}
