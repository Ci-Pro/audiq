import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchWorker } from "@/lib/worker-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get database record
    const task = await db.downloadTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: "Download task not found" }, { status: 404 });
    }

    // Get latest status from remote worker
    let workerStatus: Record<string, any> | null = null;
    try {
      const res = await fetchWorker(`/api/status/${id}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        workerStatus = await res.json();
      }
    } catch {
      // Worker may be down — use DB data only
    }

    // Merge: worker status takes priority for real-time fields
    const merged = {
      ...task,
      ...(workerStatus?.status ? { status: workerStatus.status } : {}),
      ...(workerStatus?.progress !== undefined ? { progress: workerStatus.progress } : {}),
      ...(workerStatus?.fileSize ? { fileSize: workerStatus.fileSize } : {}),
      ...(workerStatus?.error ? { error: workerStatus.error } : {}),
      ...(workerStatus?.format ? { format: workerStatus.format } : {}),
    };

    return NextResponse.json(merged);
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
