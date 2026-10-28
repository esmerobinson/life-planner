/**
 * A row without its sync stamp. Every local write sets `updatedAt` to the write time, so
 * tests that compare a stored row with the object they wrote compare it without the stamp.
 */
export function unstamped<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const { updatedAt: _u, ...rest } = row as T & { updatedAt?: number };
  return rest as T;
}
