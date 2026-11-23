/**
 * Log sanitiser (PRD section 7.1: "Never log passwords, tokens, or OTPs").
 * Redacts sensitive keys at any depth and bearer tokens inside strings.
 */
const SENSITIVE_KEY =
  /(pass(word)?|token|secret|otp|authorization|cookie|api[-_]?key|cvv|card[-_]?number|csrf|jwt|credential|private[-_]?key|hash)/i;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g;
export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

export function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value.replace(BEARER, `Bearer ${REDACTED}`);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitize(value.message, depth + 1, seen),
      stack: value.stack,
    };
  }
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(v, depth + 1, seen);
  }
  return out;
}
