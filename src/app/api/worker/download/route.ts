import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

export const maxDuration = 300;

// Proxy download request to the remote worker
export async function POST(request: NextRequest) {
  try {
    const { id, url, format, quality } = await request.json();

    if (!id || !url || !format || !quality) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Proxy to worker's download endpoint
    const workerRes = await fetchWorker("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, url, format, quality }),
    });

    const data = await workerRes.json();
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error: unknown) {
    console.error("Worker download error:", error);
    const msg = error instanceof Error ? error.message : "Failed to start download";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
