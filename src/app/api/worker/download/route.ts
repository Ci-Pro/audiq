import { NextRequest, NextResponse } from "next/server";

// Proxy to download worker - starts a download
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const workerRes = await fetch("http://localhost:3003/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const data = await workerRes.json();
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error("Worker proxy error:", error);
    return NextResponse.json(
      { error: "Failed to start download" },
      { status: 500 }
    );
  }
}
