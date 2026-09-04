import { Request, Response, NextFunction } from 'express';
import { initializeApp, applicationDefault, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import appletConfig from '../firebase-applet-config.json';

/**
 * Directive 3 (Auth State Integrity): JWT tokens are verified on the backend
 * using the Firebase Admin SDK. Directive 2 (OWASP A01): authorization is
 * validated at every API boundary, not only in the client.
 *
 * Failure posture: if the Admin SDK cannot initialise, requireAuth denies.
 * The safe failure is the server refusing to act.
 */

const RAW_DATABASE_ID = (
  process.env.FIRESTORE_DATABASE_ID ||
  appletConfig.firestoreDatabaseId ||
  ''
).trim();

/**
 * A project's first Firestore database is "(default)"; the SDK expects it to be
 * addressed by omission, not by name. A project provisioned by AI Studio gets a
 * NAMED database instead, which must be passed explicitly or the SDK silently
 * reads and writes the wrong database.
 */
const IS_DEFAULT_DB = RAW_DATABASE_ID === '' || RAW_DATABASE_ID === '(default)';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || appletConfig.projectId;

let adminApp: App | null = null;
let initError: Error | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  if (initError) throw initError;

  try {
    adminApp = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: applicationDefault(),
          projectId: PROJECT_ID,
        });
    return adminApp;
  } catch (err: any) {
    initError = err instanceof Error ? err : new Error(String(err));
    console.error('[auth] Firebase Admin initialisation failed:', initError.message);
    throw initError;
  }
}

export function adminDb(): Firestore {
  const app = getAdminApp();
  return IS_DEFAULT_DB ? getFirestore(app) : getFirestore(app, RAW_DATABASE_ID);
}

export interface AuthedRequest extends Request {
  uid?: string;
  email?: string | null;
  /** From the verified token's custom claim only. Never from a document. */
  role?: string | null;
}

function bearerToken(req: Request): string | null {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Verifies the caller's Firebase ID token and attaches the uid to the request.
 * Every route that reads user data, spends Gemini quota, or causes a side
 * effect must sit behind this.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email ?? null;
    // INV-13: the role travels in the signed token. Reading it here, from the
    // already-verified claims, is the only place a role is ever sourced.
    req.role = typeof (decoded as any).role === 'string' ? (decoded as any).role : null;
    next();
  } catch (err: any) {
    const code = err?.errorInfo?.code || err?.code || '';
    if (String(code).includes('id-token-expired')) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }
    if (initError) {
      // Admin SDK unavailable — deny rather than fall open.
      console.error('[auth] denying request: admin SDK unavailable');
      res.status(503).json({ error: 'Authentication service unavailable. Please retry.' });
      return;
    }
    console.warn('[auth] token verification failed:', err?.message);
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

/**
 * Administrative gate — Amendment E, INV-13.
 *
 * Layered AFTER requireAuth and reading the role it already extracted from the
 * verified token. It deliberately does not decode a second time and it never
 * consults Firestore: `users/{uid}` is owner-writable so the profile can sync,
 * which means a role stored there would be self-grantable.
 *
 * Fails closed. A missing claim, an empty claim, or anything other than the
 * exact string is denied, and the response says nothing about whether an admin
 * role exists at all.
 */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin') {
    res.status(403).json({ error: 'Not available for this account.' });
    return;
  }
  next();
}
