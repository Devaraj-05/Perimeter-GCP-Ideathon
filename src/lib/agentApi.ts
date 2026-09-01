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
