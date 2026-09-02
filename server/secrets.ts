import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

/**
 * INV-8 — secrets come from Secret Manager at runtime, pinned by version,
 * never logged, never returned to a client, never committed.
 *
 * A note on accuracy, because it is easy to overclaim here:
 *
 * Cloud Run's `--set-secrets` does NOT embed a secret in the container image.
 * It fetches from Secret Manager at instance start and injects into the
 * process environment, and the image stays clean. That is a supported,
 * recommended pattern and it is not insecure.
 *
 * This module exists for three different reasons:
 *
 *  1. The Production Directives demonstrate the SDK access pattern explicitly.
 *  2. It makes Secret Manager usage visible in source a reviewer actually
 *     reads, rather than in a deploy flag they never see.
 *  3. It permits pinning a specific version, so rotation is a deliberate
 *     deploy rather than a silent behaviour change under a running service.
 *
 * The env-var path is retained as a fallback so local development and the
 * existing deployment keep working during the migration.
 */

let client: SecretManagerServiceClient | null = null;
let cachedKey: string | null = null;
let resolvedVia: 'secret-manager' | 'environment' | null = null;

function getClient(): SecretManagerServiceClient {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

/**
 * Redacts the live secret from any string before it is logged.
 *
 * Belt and braces. Nothing in this codebase deliberately logs the key, but a
 * stack trace or a serialised config object can carry one accidentally, and
 * the cost of this is five lines.
 */
export function redact(text: string): string {
  if (!cachedKey || !text) return text;
  return text.split(cachedKey).join('[REDACTED]');
}

/**
 * Fetches the Gemini API key once and caches it in module memory.
 *
 * Resolution order:
 *   1. GEMINI_KEY_SECRET — a full pinned resource path. Preferred.
 *      projects/PROJECT/secrets/NAME/versions/3
 *   2. GEMINI_API_KEY — the value, injected by Cloud Run or a local .env.
 *
 * Never throws with the secret in the message. Never returns a partial value.
 */
export async function getGeminiKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const secretPath = process.env.GEMINI_KEY_SECRET?.trim();

  if (secretPath) {
    if (secretPath.endsWith('/versions/latest')) {
      // Not fatal, but a pinned version is the point of using a path at all.
      console.warn(
        '[secrets] GEMINI_KEY_SECRET points at /versions/latest. ' +
          'Pin a numbered version so rotation is a deliberate deploy.',
      );
    }
    try {
      const [version] = await getClient().accessSecretVersion({ name: secretPath });
      const payload = version.payload?.data?.toString().trim();
      if (!payload) throw new Error('secret_empty');
      cachedKey = payload;
      resolvedVia = 'secret-manager';
      console.log(`[secrets] Gemini key loaded from Secret Manager (${secretPath})`);
      return cachedKey;
    } catch (err: any) {
      // Log the failure, not the secret, and not the caller's stack.
      console.error(`[secrets] Secret Manager access failed: ${err?.message ?? 'unknown'}`);
      // Fall through to the environment path rather than hard-failing a
      // running deployment mid-migration.
    }
  }

  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) {
    cachedKey = fromEnv;
    resolvedVia = 'environment';
    console.log('[secrets] Gemini key loaded from environment injection');
    return cachedKey;
  }

  throw new Error('config_missing:GEMINI_KEY_SECRET_or_GEMINI_API_KEY');
}

/** Diagnostics for /api/health. Reports the path taken, never the value. */
export function secretStatus(): { configured: boolean; via: string | null } {
  return { configured: cachedKey !== null, via: resolvedVia };
}

/** Test seam. Not used in production paths. */
export function __resetSecretCache(): void {
  cachedKey = null;
  resolvedVia = null;
}
