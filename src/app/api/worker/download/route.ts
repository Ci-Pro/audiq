import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { downloadVideo } from "@/lib/yt-dlp";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { id, url, format, quality } = await request.json();

    if (!id || !url || !format || !quality) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Update status to processing
    await db.downloadTask.update({
      where: { id },
      data: { status: "processing", progress: 0 },
    });

    // Download using local yt-dlp
    const outputDir = `/tmp/audiq-downloads/${id}`;
    const result = await downloadVideo({
      url,
      format,
      quality,
      outputDir,
      onProgress: async (percent) => {
        try {
          await db.downloadTask.update({
            where: { id },
            data: { progress: percent },
          });
        } catch {
          // Ignore DB update errors during progress
        }
      },
    });

    // Update as completed
    await db.downloadTask.update({
      where: { id },
      data: {
        status: "completed",
        progress: 100,
        fileSize: result.fileSize,
        filePath: result.filePath,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Download error:", error);

    const errMessage = error instanceof Error ? error.message : "Download failed";

    try {
      // Best-effort: read id from original body — if that fails, skip DB update
      const body = await request.json().catch(() => null);
      if (body?.id) {
        await db.downloadTask.update({
          where: { id: body.id },
          data: { status: "failed", error: errMessage },
        });
      }
    } catch {
      // Ignore — request body may have already been consumed
    }

    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
