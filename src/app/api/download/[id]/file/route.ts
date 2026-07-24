import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Always fetch from the remote worker
    const workerRes = await fetchWorker(`/api/file/${id}`);

    if (!workerRes.ok) {
      return NextResponse.json({ error: "File not found or expired" }, { status: 404 });
    }

    // Stream the response from worker to client
    const body = workerRes.body;
    const contentType = workerRes.headers.get("Content-Type") || "application/octet-stream";
    const contentLength = workerRes.headers.get("Content-Length");
    const disposition = workerRes.headers.get("Content-Disposition");

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition || `attachment; filename="${id}.mp4"`,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (error) {
    console.error("File download error:", error);
    return NextResponse.json(
      { error: "Failed to download file. It may have expired — try converting again." },
      { status: 500 }
    );
  }
}
