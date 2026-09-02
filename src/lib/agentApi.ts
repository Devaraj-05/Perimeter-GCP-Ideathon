import { apiFetch } from './apiClient';

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
}

export async function listPerimeterEvents(): Promise<PerimeterEvent[]> {
  const { events } = await apiFetch<{ events: PerimeterEvent[] }>('/api/agent/perimeter/events');
  return events;
}

export async function verifyPerimeterChain(): Promise<ChainVerification> {
  return apiFetch<ChainVerification>('/api/agent/perimeter/verify');
}
