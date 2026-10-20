export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 0) return `in ${formatDuration(-s)}`;
  if (s < 45) return "just now";
  return `${formatDuration(s)} ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 129600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function dateTime(input: string | Date | null | undefined, timeZone?: string): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 1000) / 10}%`;
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString();
}

export function customerName(c: {
  name?: string | null;
  profileName?: string | null;
  waId?: string;
}): string {
  return c.name || c.profileName || (c.waId ? `+${c.waId}` : "Unknown");
}
