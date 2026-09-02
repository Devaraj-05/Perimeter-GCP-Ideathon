import { auth } from './firebase';

/**
 * Every /api route that spends Gemini quota, reads user data, or causes a side
 * effect is authenticated server-side with the Firebase Admin SDK. This is the
 * single place the client attaches its ID token, so no call site can forget.
 */
export async function authedHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/** Turns a failed response into a message a person can act on. */
export async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({} as any));
  if (data?.error) return data.error;
  if (res.status === 401) return 'Your session expired. Please sign in again.';
  if (res.status === 429) return 'Rate limit reached. Please wait a moment and retry.';
  if (res.status === 503) return 'Service temporarily unavailable. Please retry.';
  return `Request failed (${res.status}).`;
}

/**
 * Every request carries a timeout.
 *
 * Without one, a stalled request presents as a spinner that never stops, which
 * is the worst failure mode available: the user cannot tell whether it is slow,
 * broken, or waiting on them. An error they can retry is strictly better than
 * a wait they cannot end.
 *
 * 30s because a link fetch runs a server-side download plus two model calls;
 * anything shorter would abort work that was going to succeed.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: await authedHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error('That took too long and was stopped. Please try again.');
    }
    if (err?.message === 'You must be signed in.') throw err;
    throw new Error('Could not reach the server. Check your connection and retry.');
  }

  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<T>;
}
