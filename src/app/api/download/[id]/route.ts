import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get database record directly — no remote worker needed
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
