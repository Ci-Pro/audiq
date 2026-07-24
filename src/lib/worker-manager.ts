/**
 * Worker Manager — connects to the remote Render worker service.
 *
 * LOCAL DEV: Uses WORKER_URL=http://localhost:3003, no auth needed.
 * PRODUCTION (Vercel): Uses WORKER_URL=https://vortextube-worker.onrender.com,
 *                     sends WORKER_SECRET in x-worker-secret header.
 */

const WORKER_URL = process.env.WORKER_URL || "http://localhost:3003";
const WORKER_SECRET = process.env.WORKER_SECRET || "";

export async function fetchWorker(path: string, options?: RequestInit): Promise<Response> {
  const url = `${WORKER_URL}${path}`;

  const headers = new Headers(options?.headers || {});

  // Add worker secret header for production auth
  if (WORKER_SECRET) {
    headers.set("x-worker-secret", WORKER_SECRET);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options?.signal || AbortSignal.timeout(70000),
  });

  return response;
}
