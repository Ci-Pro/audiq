import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchWorker } from "@/lib/worker-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try to get real-time status from the worker first
    try {
      const workerRes = await fetchWorker(`/api/status/${id}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (workerRes.ok) {
        const workerStatus = await workerRes.json();

        // Sync worker status back to DB for history persistence
        if (workerStatus.status === "completed" && workerStatus.fileSize) {
          await db.downloadTask.update({
            where: { id },
            data: {
              status: "completed",
              progress: 100,
              fileSize: workerStatus.fileSize,
            },
          }).catch(() => {});
        } else if (workerStatus.status === "failed") {
          await db.downloadTask.update({
            where: { id },
            data: {
              status: "failed",
              error: workerStatus.error || workerStatus.message || "Download failed",
            },
          }).catch(() => {});
        } else if (workerStatus.status === "processing") {
          await db.downloadTask.update({
            where: { id },
            data: {
              status: "processing",
              progress: Math.round(workerStatus.progress || 0),
            },
          }).catch(() => {});
        }

        // Return worker status (most up-to-date)
        return NextResponse.json({
          id,
          status: workerStatus.status,
          progress: Math.round(workerStatus.progress || 0),
          message: workerStatus.message || "",
          fileSize: workerStatus.fileSize || null,
          format: workerStatus.format || null,
          error: workerStatus.error || null,
        });
      }
    } catch {
      // Worker unreachable — fall back to DB
    }

    // Fallback: get from database
    const task = await db.downloadTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Download task not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error("Get download error:", error);
    return NextResponse.json(
      { error: "Failed to get download status" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const task = await db.downloadTask.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.progress !== undefined && { progress: body.progress }),
        ...(body.fileSize && { fileSize: body.fileSize }),
        ...(body.error && { error: body.error }),
        ...(body.status === "completed" && { completedAt: new Date() }),
      },
    });

    return NextResponse.json(task);
  } catch (error) {
    console.error("Update download error:", error);
    return NextResponse.json(
      { error: "Failed to update download status" },
      { status: 500 }
    );
  }
}
