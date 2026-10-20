/**
 * Redaction of secrets and sensitive personal data from strings and objects before they
 * are written to logs, audit metadata or tool-execution records.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[REDACTED_API_KEY]"],
  [/owa_(?:live|test)_[A-Za-z0-9]{8,}/g, "[REDACTED_OPENWA_KEY]"],
  [/EAA[A-Za-z0-9]{20,}/g, "[REDACTED_META_TOKEN]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED_CARD_OR_NUMBER]"],
  [/\b(password|passwd|pwd|secret|api[_-]?key|token|otp|pin)\b(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]"],
];

const SENSITIVE_KEYS =
  /^(password|passwordhash|secret|token|apikey|api_key|accesstoken|access_token|authorization|appsecret|encrypted.*|keyhash|tokenhash|cookie|set-cookie|x-api-key)$/i;

export function redactString(input: string): string {
  let out = input;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return "[TRUNCATED]" as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Mask a phone number for logs: +254712345678 -> +2547*****678 */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  return phone.slice(0, 5) + "*".repeat(Math.max(0, phone.length - 8)) + phone.slice(-3);
}
