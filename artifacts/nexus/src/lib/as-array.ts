export function asArray<T>(v: T[] | readonly T[] | null | undefined): T[];
export function asArray<T>(v: unknown): T[];
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
