import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { join } from "path";
import { fetchWorker } from "@/lib/worker-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check worker's local file
    const filePath = join(process.cwd(), "download", `${id}.mp4`);
    const filePathMp3 = join(process.cwd(), "download", `${id}.mp3`);

    const actualPath = existsSync(filePath) ? filePath : existsSync(filePathMp3) ? filePathMp3 : null;

    if (!actualPath) {
      // Try fetching from worker service
      try {
        const workerRes = await fetchWorker(`/api/file/${id}`);
        if (workerRes.ok) {
          // Stream the response
          const body = workerRes.body;
          const contentType = workerRes.headers.get("Content-Type") || "application/octet-stream";
          const contentLength = workerRes.headers.get("Content-Length");

          return new NextResponse(body, {
            headers: {
              "Content-Type": contentType,
              "Content-Disposition": `attachment; filename="${id}.mp4"`,
              ...(contentLength ? { "Content-Length": contentLength } : {}),
            },
          });
        }
      } catch {
        // Worker not available
      }

      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = statSync(actualPath);
    const ext = actualPath.endsWith(".mp3") ? "mp3" : "mp4";
    const contentType = ext === "mp3" ? "audio/mpeg" : "video/mp4";

    const stream = createReadStream(actualPath);
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": stat.size.toString(),
        "Content-Disposition": `attachment; filename="download.${ext}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("File download error:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
