import type { ErrorCode, Result } from '../shared/types';

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({
  ok: false,
  code,
  message,
});

/** 把任意异常收敛成 Result，避免 invoke 抛出后渲染层拿不到 code。 */
export function fromError<T = never>(code: ErrorCode, err: unknown): Result<T> {
  const message = err instanceof Error ? err.message : String(err);
  return fail<T>(code, message);
}
