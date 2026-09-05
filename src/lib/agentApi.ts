import { apiFetch } from './apiClient';
import { postChatStream, type ChatStreamHandlers } from './chatStream';

export type Decision = 'ALLOW' | 'CONFIRM' | 'DENY';
export type CallStatus = 'pending' | 'executed' | 'denied' | 'rejected' | 'expired' | 'failed';

export interface ThreatEvent {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  sideEffect: 'read' | 'write' | null;
  decision: Decision;
  reason: string;
  turnTaint: boolean;
  originSourceIds: string[];
  result: unknown;
}

export interface ChatResponse {
  reply: string;
  modelUsed: string;
  turnTaint: boolean;
  threatEvents: ThreatEvent[];
  contextIds: string[];
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  sideEffect: 'read' | 'write' | null;
  turnTaint: boolean;
  decision: Decision;
  reason: string;
  originSourceIds: string[];
  status: CallStatus;
  createdAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  error?: string | null;
}

export interface AuditEvent {
  id: string;
  type: string;
  tool: string | null;
  args: Record<string, unknown>;
  decision: Decision | null;
  reason: string | null;
  sideEffect: 'read' | 'write' | null;
  turnTaint: boolean;
  originSourceIds: string[];
  detail: string | null;
  at: string;
}

export async function agentChat(message: string, artifactIds: string[]): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ message, artifactIds }),
  });
}

/**
 * The streaming chat call — Amendment L, INV-20.
 *
 * The wire parsing lives in ./chatStream so both streaming routes share one
 * implementation of the verdict-before-text rule.
 */
export async function agentChatStream(
  message: string,
  artifactIds: string[],
  handlers: ChatStreamHandlers = {},
): Promise<ChatResponse> {
  const r = await postChatStream(
    '/api/agent/chat',
    { message, artifactIds, stream: true },
    handlers,
  );
  return {
    reply: r.reply,
    modelUsed: r.modelUsed,
    turnTaint: r.turnTaint,
    threatEvents: r.threatEvents,
    contextIds: r.contextIds,
  };
}

export async function listToolCalls(): Promise<ToolCall[]> {
  const { toolcalls } = await apiFetch<{ toolcalls: ToolCall[] }>('/api/agent/toolcalls');
  return toolcalls;
}

export async function listAudit(): Promise<AuditEvent[]> {
  const { events } = await apiFetch<{ events: AuditEvent[] }>('/api/agent/audit');
  return events;
}

export async function approveCall(callId: string) {
  return apiFetch<{ ok: boolean; result: unknown; error: string | null }>('/api/agent/approve', {
    method: 'POST',
    body: JSON.stringify({ callId }),
  });
}

export async function rejectCall(callId: string) {
  return apiFetch<{ ok: boolean }>('/api/agent/reject', {
    method: 'POST',
    body: JSON.stringify({ callId }),
  });
}

// --- Capability grants (INV-4) ---

export interface Capability {
  id: string;
  tool: string;
  resource: string;
  grantedAt: string;
  expiresAt: string;
  oneShot: boolean;
  usedAt: string | null;
  revokedAt: string | null;
}

export async function listCapabilities(): Promise<Capability[]> {
  const { capabilities } = await apiFetch<{ capabilities: Capability[] }>(
    '/api/agent/capabilities',
  );
  return capabilities;
}

export async function grantCapability(input: {
  tool: string;
  resource: string;
  hours?: number;
  oneShot?: boolean;
}): Promise<Capability> {
  const { capability } = await apiFetch<{ capability: Capability }>('/api/agent/capabilities', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return capability;
}

export async function revokeCapability(capId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/agent/capabilities/${encodeURIComponent(capId)}`, {
    method: 'DELETE',
  });
}

// --- Perimeter log (INV-6, INV-7) ---

export interface PerimeterEvent {
  id: string;
  seq: number;
  prevHash: string;
  ts: string;
  kind: 'ingest' | 'reader' | 'plan' | 'decision' | 'execute' | 'redteam' | 'error';
  zone: string | null;
  tool: string | null;
  decision: 'allow' | 'deny' | 'confirm' | null;
  reason: string;
  invariant: string | null;
  detail: Record<string, unknown>;
}

export interface ChainVerification {
  intact: boolean;
  count: number;
  brokenAt: number | null;
  reason: string;
  /** True when the log is longer than one verification pass could read. */
  partial: boolean;
  /** How many events were actually verified. */
  verified: number;
}

export async function listPerimeterEvents(): Promise<PerimeterEvent[]> {
  const { events } = await apiFetch<{ events: PerimeterEvent[] }>('/api/agent/perimeter/events');
  return events;
}

export async function verifyPerimeterChain(): Promise<ChainVerification> {
  return apiFetch<ChainVerification>('/api/agent/perimeter/verify');
}

// --- Red team (Amendment C) ---

export interface CorpusPayload {
  id: string;
  class: string;
  title: string;
  intent: string;
  expectedBlock: string;
  invariant: string;
  body: string;
  provenance: 'authored' | 'third_party';
  source: {
    author: string;
    title: string;
    venue: string;
    year: number;
    url: string;
    fidelity: 'verbatim' | 'reconstructed';
  } | null;
}

export interface StageResult {
  stage: string;
  outcome: 'passed' | 'blocked' | 'flagged';
  detail: string;
}

export interface RunResult {
  payloadId: string;
  class: string;
  intent: string;
  expectedBlock: string;
  invariant: string;
  outcome: 'blocked' | 'leaked' | 'error';
  stages: StageResult[];
  readerFlaggedInstruction: boolean;
}

export interface CorpusSummary {
  attempted: number;
  blocked: number;
  leaked: number;
  errors: number;
}

export async function listPayloads(): Promise<CorpusPayload[]> {
  const { payloads } = await apiFetch<{ payloads: CorpusPayload[] }>('/api/redteam/payloads');
  return payloads;
}

export async function runPayload(payloadId: string): Promise<RunResult> {
  const { result } = await apiFetch<{ result: RunResult }>('/api/redteam/run', {
    method: 'POST',
    body: JSON.stringify({ payloadId }),
  });
  return result;
}

/**
 * Fires text the user wrote. Same pipeline, same stages, same log entry as a
 * catalogued payload — the point is that there is no gentler path for input we
 * did not choose.
 */
export async function runCustomAttack(body: string): Promise<RunResult> {
  const { result } = await apiFetch<{ result: RunResult }>('/api/redteam/run-custom', {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return result;
}

export async function runCorpus(): Promise<{ summary: CorpusSummary; results: RunResult[] }> {
  return apiFetch<{ summary: CorpusSummary; results: RunResult[] }>('/api/redteam/run-all', {
    method: 'POST',
  });
}

// --- Egress destinations (sandbox only) ---

export interface Destination {
  id: string;
  kind: 'sandbox';
  label: string;
  createdAt: string;
  deliveryCount: number;
}

export async function listDestinations(): Promise<Destination[]> {
  const { destinations } = await apiFetch<{ destinations: Destination[] }>(
    '/api/agent/destinations',
  );
  return destinations;
}

export async function createDestination(label: string): Promise<Destination> {
  const { destination } = await apiFetch<{ destination: Destination }>('/api/agent/destinations', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
  return destination;
}

export interface Delivery {
  id: string;
  destinationId: string;
  bodySha256: string;
  bodyLength: number;
  preview: string;
  at: string;
}

export async function listDeliveries(destinationId: string): Promise<Delivery[]> {
  const { deliveries } = await apiFetch<{ deliveries: Delivery[] }>(
    `/api/agent/destinations/${encodeURIComponent(destinationId)}/deliveries`,
  );
  return deliveries;
}

// --- Aggregate metrics (Amendment E) ---

export interface GlobalMetrics {
  totalRuns: number;
  blocked: number;
  leaked: number;
  byClass: Record<string, number>;
  updatedAt: string;
}

/** Admin-only. Returns 403 for everyone else; callers should hide the entry point. */
export async function fetchMetrics(): Promise<GlobalMetrics> {
  const { metrics } = await apiFetch<{ metrics: GlobalMetrics }>('/api/redteam/metrics');
  return metrics;
}
