"use client";

/**
 * Minimal dependency-free charts. Every chart also renders its values as an accessible table
 * for screen readers, so the numbers are never only available as shapes.
 */

export function DailyBars({
  rows,
  series,
  format = (v: number) => v.toLocaleString(),
}: {
  rows: Array<Record<string, number | string>>;
  series: Array<{ key: string; label: string; className: string }>;
  format?: (v: number) => string;
}) {
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-slate-500">No data in this period.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key] ?? 0))));
  return (
    <figure>
      <div className="flex h-40 items-end gap-1 overflow-x-auto" aria-hidden="true">
        {rows.map((r) => (
          <div
            key={String(r.day)}
            className="flex h-full min-w-3 flex-1 items-end gap-px"
            title={`${r.day}: ${series.map((s) => `${s.label} ${format(Number(r[s.key] ?? 0))}`).join(", ")}`}
          >
            {series.map((s) => (
              <div
                key={s.key}
                className={`w-full rounded-t ${s.className}`}
                style={{
                  height: `${(Number(r[s.key] ?? 0) / max) * 100}%`,
                  minHeight: Number(r[s.key]) > 0 ? 2 : 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
        <span>
          {String(rows[0]!.day)} → {String(rows[rows.length - 1]!.day)}
        </span>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-3 rounded ${s.className}`} /> {s.label}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th>Day</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.day)}>
              <td>{String(r.day)}</td>
              {series.map((s) => (
                <td key={s.key}>{format(Number(r[s.key] ?? 0))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function BarList({
  items,
  format = (v: number) => v.toLocaleString(),
}: {
  items: Array<{ label: string; value: number }>;
  format?: (v: number) => string;
}) {
  if (items.length === 0)
    return <p className="py-6 text-center text-sm text-slate-500">No data in this period.</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">{format(i.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true">
            <div className="h-2 rounded bg-emerald-600" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
