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

/**
 * Every secret this process has resolved, by logical name.
 *
 * A map rather than one variable because a second secret arrived (Maps,
 * Amendment D) and the alternative was a copy of this whole file with the
 * identifiers changed — two places to get pinning, redaction and failure
 * posture right instead of one.
 */
const cache = new Map<string, { value: string; via: 'secret-manager' | 'environment' }>();

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
  if (!text || cache.size === 0) return text;
  let out = text;
  for (const { value } of cache.values()) {
    if (value) out = out.split(value).join('[REDACTED]');
  }
  return out;
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
/**
 * Resolves one secret and caches it in module memory.
 *
 * Resolution order, unchanged from the original single-secret version:
 *   1. `<pathEnv>` — a full pinned resource path. Preferred.
 *      projects/PROJECT/secrets/NAME/versions/3
 *   2. `<valueEnv>` — the value, injected by Cloud Run or a local .env.
 *
 * Never throws with the secret in the message. Never returns a partial value.
 * A Secret Manager failure falls through to the environment path rather than
 * hard-failing a running deployment mid-migration.
 */
async function resolveSecret(
  name: string,
  pathEnv: string,
  valueEnv: string,
  label: string,
): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit.value;

  const secretPath = process.env[pathEnv]?.trim();

  if (secretPath) {
    if (secretPath.endsWith('/versions/latest')) {
      // Not fatal, but a pinned version is the point of using a path at all.
      console.warn(
        `[secrets] ${pathEnv} points at /versions/latest. ` +
          'Pin a numbered version so rotation is a deliberate deploy.',
      );
    }
    try {
      const [version] = await getClient().accessSecretVersion({ name: secretPath });
      const payload = version.payload?.data?.toString().trim();
      if (!payload) throw new Error('secret_empty');
      cache.set(name, { value: payload, via: 'secret-manager' });
      console.log(`[secrets] ${label} loaded from Secret Manager (${secretPath})`);
      return payload;
    } catch (err: any) {
      // Log the failure, not the secret, and not the caller's stack.
      console.error(`[secrets] Secret Manager access failed: ${err?.message ?? 'unknown'}`);
    }
  }

  const fromEnv = process.env[valueEnv]?.trim();
  if (fromEnv) {
    cache.set(name, { value: fromEnv, via: 'environment' });
    console.log(`[secrets] ${label} loaded from environment injection`);
    return fromEnv;
  }

  throw new Error(`config_missing:${pathEnv}_or_${valueEnv}`);
}

export async function getGeminiKey(): Promise<string> {
  return resolveSecret('gemini', 'GEMINI_KEY_SECRET', 'GEMINI_API_KEY', 'Gemini key');
}

/**
 * Maps Platform key — Amendment D, INV-12.
 *
 * Server-side only. It is never returned to a client, never embedded in the
 * bundle, and never placed in a URL the browser requests; map imagery is
 * proxied through this server precisely so this value stays here.
 */
export async function getMapsKey(): Promise<string> {
  return resolveSecret('maps', 'MAPS_KEY_SECRET', 'MAPS_API_KEY', 'Maps key');
}

/** Diagnostics for /api/health. Reports the path taken, never the value. */
export function secretStatus(): { configured: boolean; via: string | null } {
  const gemini = cache.get('gemini');
  return { configured: !!gemini, via: gemini?.via ?? null };
}

/** Test seam. Not used in production paths. */
export function __resetSecretCache(): void {
  cache.clear();
}
