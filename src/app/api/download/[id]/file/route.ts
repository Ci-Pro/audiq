import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

export const maxDuration = 60;

// Proxy file download from the remote worker
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // First check status from worker
    try {
      const statusRes = await fetchWorker(`/api/status/${id}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (statusRes.ok) {
        const status = await statusRes.json();
        if (status.status !== "completed") {
          return NextResponse.json(
            { error: "File not ready yet", status: status.status },
            { status: 404 }
          );
        }
      }
    } catch {
      // Continue anyway
    }

    // Stream file from worker
    const fileRes = await fetchWorker(`/api/file/${id}`, {
      signal: AbortSignal.timeout(120000),
    });

    if (!fileRes.ok) {
      return NextResponse.json(
        { error: "File not found or expired. Please convert again." },
        { status: fileRes.status }
      );
    }

    const contentType = fileRes.headers.get("Content-Type") || "application/octet-stream";
    const contentLength = fileRes.headers.get("Content-Length");
    const disposition = fileRes.headers.get("Content-Disposition");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    };

    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }
    if (disposition) {
      headers["Content-Disposition"] = disposition;
    }

    // Stream the response body directly
    const body = fileRes.body;
    if (!body) {
      return NextResponse.json({ error: "Empty file" }, { status: 500 });
    }

    return new NextResponse(body, { headers });
  } catch (error) {
    console.error("File serve error:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
