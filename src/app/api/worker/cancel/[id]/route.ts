import { NextRequest, NextResponse } from "next/server";
import { fetchWorker } from "@/lib/worker-manager";

// Proxy to download worker - cancel a download
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workerRes = await fetchWorker(`/api/cancel/${id}`, {
      method: "POST",
    });

    const data = await workerRes.json();
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
