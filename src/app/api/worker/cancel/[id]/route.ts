import { NextRequest, NextResponse } from "next/server";

// Proxy to download worker - cancel a download
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workerRes = await fetch(`http://localhost:3003/api/cancel/${id}`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });

    const data = await workerRes.json();
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
