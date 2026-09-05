import { authedHeaders } from './apiClient';

/**
 * Account export and deletion — Amendment N.
 *
 * The export is downloaded rather than returned as an object: it can be large,
 * and the point of the feature is that the user ends up holding a file, not
 * that the app renders one.
 */

/**
 * Downloads the account archive.
 *
 * Uses a blob URL rather than pointing the browser at the endpoint, because
 * the route needs an Authorization header and a plain navigation cannot carry
 * one. Putting a token in a query string to work around that is how
 * credentials end up in browser history and server logs.
 */
export async function downloadAccountExport(): Promise<void> {
  const res = await fetch('/api/account/export', { headers: await authedHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Could not build your export.');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `perimeter-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Released on the next tick: revoking synchronously can cancel the
    // download in some browsers before it has started reading.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface DeletionResult {
  ok: boolean;
  /** False when the data went but the sign-in record survived. */
  authUserDeleted: boolean;
  revoked: string[];
}

/**
 * Deletes the account. Irreversible.
 *
 * The confirmation word is sent and checked again on the server: a guard that
 * lives only in this file is a suggestion to anyone holding a token.
 */
export async function deleteAccount(): Promise<DeletionResult> {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ confirm: 'DELETE' }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Deletion did not complete.');
  return body as DeletionResult;
}
