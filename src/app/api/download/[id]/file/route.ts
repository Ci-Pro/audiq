import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "fs";
import { db } from "@/lib/db";

export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const task = await db.downloadTask.findUnique({ where: { id } });
    if (!task || task.status !== "completed" || !task.filePath) {
      return NextResponse.json(
        { error: "File not found or not ready" },
        { status: 404 }
      );
    }

    // Check if file exists in /tmp
    if (!existsSync(task.filePath)) {
      return NextResponse.json(
        { error: "File expired. Please convert again." },
        { status: 410 }
      );
    }

    const stats = statSync(task.filePath);
    const ext =
      task.filePath.split(".").pop() ||
      (task.format === "audio" ? "m4a" : "mp4");
    const mimeType = task.format === "audio" ? "audio/mp4" : "video/mp4";
    const safeTitle = (task.title || "download").replace(/[^a-zA-Z0-9 ]/g, "");

    const fileStream = createReadStream(task.filePath);

    return new NextResponse(fileStream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": stats.size.toString(),
        "Content-Disposition": `attachment; filename="${safeTitle}.${ext}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("File serve error:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
