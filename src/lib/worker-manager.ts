/**
 * Worker Manager — connects to the remote worker service.
 *
 * Handles SnapDeploy container sleep/wake cycles:
 * 1. Checks /health first to see if container is awake
 * 2. If sleeping (HTML response or non-JSON), hits a wake endpoint
 * 3. Polls until container is ready (max ~45s for SnapDeploy wake)
 * 4. Then proceeds with the actual request
 *
 * LOCAL DEV: Uses WORKER_URL=http://localhost:3003, no auth needed.
 * PRODUCTION: Uses WORKER_URL env var, sends WORKER_SECRET header.
 */

const WORKER_URL = process.env.WORKER_URL || "http://localhost:3003";
const WORKER_SECRET = process.env.WORKER_SECRET || "";
const IS_PRODUCTION = !!process.env.WORKER_URL;

console.log(`[worker-manager] WORKER_URL=${WORKER_URL}`);
console.log(`[worker-manager] WORKER_SECRET=${WORKER_SECRET ? "***set***" : "***NOT SET***"}`);
console.log(`[worker-manager] Mode=${IS_PRODUCTION ? "production" : "local"}`);

// Track wake state to avoid parallel wake attempts
let wakingPromise: Promise<void> | null = null;
let lastHealthCheck = 0;
let isWorkerAwake = false;
const HEALTH_CHECK_INTERVAL = 25_000; // Re-check health every 25s

function isHtmlResponse(text: string): boolean {
  return text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html");
}

async function checkHealth(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;

    const res = await fetch(`${WORKER_URL}/health`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // SnapDeploy returns 503 with HTML when sleeping
      const text = await res.text().catch(() => "");
      if (isHtmlResponse(text)) {
        console.log("[worker-manager] Container is sleeping (503 HTML page)");
        return false;
      }
      return false;
    }

    const body = await res.json().catch(() => null);
    if (body && body.status === "ok") {
      return true;
    }
    return false;
  } catch (err) {
    console.error("[worker-manager] Health check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function wakeWorker(): Promise<void> {
  console.log("[worker-manager] Waking container...");

  // Hit the root URL to trigger SnapDeploy wake
  try {
    const headers: Record<string, string> = {};
    if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;

    await fetch(WORKER_URL + "/", {
      headers,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch {
    // Ignore — the wake request itself may fail until container is up
  }

  // Poll /health until container is awake (max ~45s)
  const maxAttempts = 18;
  const pollInterval = 2500;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const healthy = await checkHealth();
    if (healthy) {
      console.log(`[worker-manager] Container woke up after ${(i + 1) * pollInterval / 1000}s`);
      isWorkerAwake = true;
      lastHealthCheck = Date.now();
      return;
    }
    console.log(`[worker-manager] Still waking... attempt ${i + 1}/${maxAttempts}`);
  }

  throw new Error("Worker container failed to wake up within 45 seconds. Please try again.");
}

async function ensureWorkerReady(): Promise<void> {
  const now = Date.now();

  // If recently confirmed awake, skip
  if (isWorkerAwake && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return;
  }

  // If already waking, wait for that
  if (wakingPromise) {
    await wakingPromise;
    return;
  }

  // Check health
  const healthy = await checkHealth();
  if (healthy) {
    isWorkerAwake = true;
    lastHealthCheck = now;
    return;
  }

  // Container is sleeping — wake it
  if (!IS_PRODUCTION) {
    // Don't auto-wake in local dev (just fail fast)
    throw new Error("Local worker not running. Start it with: cd mini-services/download-worker && bun run dev");
  }

  wakingPromise = wakeWorker();
  try {
    await wakingPromise;
  } finally {
    wakingPromise = null;
  }
}

export async function fetchWorker(path: string, options?: RequestInit): Promise<Response> {
  // Ensure container is awake before making the actual request
  if (IS_PRODUCTION) {
    await ensureWorkerReady();
  }

  const url = `${WORKER_URL}${path}`;
  console.log(`[worker-manager] → ${options?.method || "GET"} ${url}`);

  const headers = new Headers(options?.headers || {});

  // Add worker secret header for production auth
  if (WORKER_SECRET) {
    headers.set("x-worker-secret", WORKER_SECRET);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: options?.signal || AbortSignal.timeout(70000),
    });

    console.log(`[worker-manager] ← ${response.status} ${response.statusText} from ${path}`);

    // If we got HTML back, the container may have gone to sleep mid-request
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      console.warn("[worker-manager] Got HTML response — container may have slept again");
      isWorkerAwake = false;
    }

    return response;
  } catch (err) {
    console.error(`[worker-manager] ✗ Fetch failed for ${path}:`, err instanceof Error ? err.message : err);
    isWorkerAwake = false;
    throw err;
  }
}
