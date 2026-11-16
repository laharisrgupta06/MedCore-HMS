import { sanitize } from '../logger/sanitize';

/**
 * Builds the `changes` metadata stored in audit_logs (SEC-012, DEC-030).
 * Request bodies are NEVER stored: only the names of the submitted fields, plus the values of
 * fields explicitly declared safe on the route. Passwords, tokens, OTPs, secrets, personal and
 * clinical values therefore cannot reach the audit log through this path.
 */
export function bodyMetadata(
  body: unknown,
  safeFields: readonly string[] = [],
): { fields: string[]; values?: Record<string, unknown> } | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const values: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!safeFields.includes(key)) continue;
    // Only scalars; anything structured is recorded by name only.
    if (value === null || ['boolean', 'number'].includes(typeof value)) values[key] = value;
    else if (typeof value === 'string' && value.length <= 64) values[key] = value;
  }
  return {
    fields: entries.map(([k]) => k).sort(),
    ...(Object.keys(values).length ? { values: sanitize(values) as Record<string, unknown> } : {}),
  };
}

const MAX_STRING = 200;
const MAX_DEPTH = 3;

/**
 * Last line of defence applied to every audit entry, whatever its source: sensitive keys are
 * redacted (passwords, tokens, OTPs, secrets, cookies, card numbers), long strings are cut, deep
 * structures are dropped, and a raw `body` is never accepted.
 */
export function safeChanges(changes: Record<string, unknown>): Record<string, unknown> {
  const prune = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
    if (depth >= MAX_DEPTH) return '[Omitted]';
    if (Array.isArray(v)) return v.slice(0, 100).map((x) => prune(x, depth + 1));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'body') continue;
        out[k] = prune(x, depth + 1);
      }
      return out;
    }
    return undefined;
  };
  return prune(sanitize(changes), 0) as Record<string, unknown>;
}
