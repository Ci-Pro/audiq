import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const tasks = await db.downloadTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(tasks);
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json(
      { error: "Failed to fetch download history" },
      { status: 500 }
    );
  }
}
