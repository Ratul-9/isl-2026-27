/** Which cv-service paths the DizPitch server forwards (everything else is refused). Pure. */

const JOB_ID = /^[0-9a-f]{32}$/;

export function cvTarget(method: string, path: readonly string[]): string | null {
  const [a, b, c, ...rest] = path;
  if (rest.length > 0) return null;
  if (method === 'GET' && a === 'health' && b === undefined) return '/health';
  if (method === 'POST' && a === 'analyze' && b === undefined) return '/api/analyze';
  if (method === 'POST' && a === 'scan' && b === undefined) return '/api/scan';
  if (a === 'jobs' && b && JOB_ID.test(b) && c === undefined && (method === 'GET' || method === 'DELETE')) return `/api/jobs/${b}`;
  if (method === 'GET' && a === 'results' && b && JOB_ID.test(b) && c === undefined) return `/api/results/${b}`;
  return null;
}

/** The service's base URL; only http(s) is accepted. */
export function cvServiceUrl(raw: string | undefined): URL {
  const fallback = new URL('http://127.0.0.1:8001');
  if (!raw?.trim()) return fallback;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : fallback;
  } catch {
    return fallback;
  }
}
