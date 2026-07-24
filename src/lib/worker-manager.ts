import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const WORKER_PORT = 3003;
const WORKER_DIR = "/home/z/my-project/mini-services/download-worker";
const WORKER_LOG = "/home/z/my-project/worker.log";
const WORKER_PID_FILE = "/home/z/my-project/mini-services/download-worker/.worker.pid";

let isStarting = false;

async function isWorkerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${WORKER_PORT}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startWorker(): Promise<void> {
  if (isStarting) return;
  isStarting = true;

  try {
    // Check if already running
    if (await isWorkerRunning()) {
      isStarting = false;
      return;
    }

    console.log("[worker-manager] Starting download worker...");

    // Use setsid to create a new session so the worker survives
    const { execSync } = await import("child_process");
    execSync(
      `cd ${WORKER_DIR} && setsid bash -c "bun index.ts >> ${WORKER_LOG} 2>&1" &`,
      { stdio: "ignore" }
    );

    // Wait for the worker to be ready (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isWorkerRunning()) {
        console.log("[worker-manager] Download worker is ready!");
        isStarting = false;
        return;
      }
    }

    console.error("[worker-manager] Failed to start download worker within timeout");
  } catch (err) {
    console.error("[worker-manager] Error starting worker:", err);
  } finally {
    isStarting = false;
  }
}

export async function ensureWorker(): Promise<void> {
  const running = await isWorkerRunning();
  if (!running) {
    await startWorker();
  }
}

export async function fetchWorker(path: string, options?: RequestInit): Promise<Response> {
  await ensureWorker();

  const url = `http://localhost:${WORKER_PORT}${path}`;
  const response = await fetch(url, {
    ...options,
    signal: options?.signal || AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    // If worker seems dead, try to restart once
    if (response.status === 0 || (response.status >= 500 && !(await isWorkerRunning()))) {
      console.log("[worker-manager] Worker appears dead, restarting...");
      await startWorker();
      // Retry once
      return fetch(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(60000),
      });
    }
  }

  return response;
}
