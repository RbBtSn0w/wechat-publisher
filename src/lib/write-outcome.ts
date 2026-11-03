/** A remote write may have committed. Callers must reconcile before retrying. */
export class UnknownWriteOutcomeError extends Error {
  readonly code = 'WRITE_RESULT_UNKNOWN';

  constructor(operation: string) {
    super(`${operation}: remote write result is unknown; verify the remote state before retrying.`);
    this.name = 'UnknownWriteOutcomeError';
  }
}

export class WeChatRejectedError extends Error {
  readonly code = 'WECHAT_REJECTED';

  constructor(operation: string, readonly errcode: number) {
    // Remote errmsg can contain credentials or untrusted payloads.
    super(`${operation}: WeChat rejected the request (code ${errcode}).`);
    this.name = 'WeChatRejectedError';
  }
}

export function responseObject(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
}

export function checkBusinessError(data: unknown, operation: string): void {
  const errcode = responseObject(data)?.errcode;
  if (typeof errcode === 'number' && Number.isFinite(errcode) && errcode !== 0) {
    throw new WeChatRejectedError(operation, errcode);
  }
}

export function requireWriteField(data: unknown, field: string, operation: string): string {
  checkBusinessError(data, operation);
  const value = responseObject(data)?.[field];
  if (typeof value !== 'string' || value.trim() === '') throw new UnknownWriteOutcomeError(operation);
  return value;
}
