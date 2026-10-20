"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  CalendarClock,
  Code2,
  Gauge,
  HeartPulse,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquareDashed,
  Plug,
  Receipt,
  ScrollText,
  Shield,
  Smartphone,
  Ticket,
  Users,
  UserSquare,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn, useOnline } from "./ui";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string };
const NAV: Array<{ section: string; items: Item[] }> = [
  {
    section: "Support",
    items: [
      { href: "/", label: "Overview", icon: Gauge },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/customers", label: "Customers", icon: UserSquare },
      { href: "/tickets", label: "Tickets", icon: Ticket },
      { href: "/followups", label: "Follow-ups", icon: CalendarClock },
      { href: "/simulator", label: "Simulator", icon: MessageSquareDashed },
    ],
  },
  {
    section: "Configure",
    items: [
      { href: "/agent", label: "AI agent", icon: Bot, perm: "settings:read" },
      { href: "/knowledge", label: "Knowledge base", icon: BookOpen },
      { href: "/tools", label: "Tools & integrations", icon: Plug },
      { href: "/connections", label: "WhatsApp connections", icon: Smartphone, perm: "settings:read" },
      { href: "/team", label: "Team", icon: Users },
    ],
  },
  {
    section: "Monitor",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/usage", label: "Usage & costs", icon: Receipt, perm: "usage:read" },
      { href: "/audit", label: "Audit log", icon: ScrollText, perm: "audit:read" },
      { href: "/health", label: "System health", icon: HeartPulse, perm: "health:read" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/developer", label: "Developer API", icon: Code2, perm: "apikeys:manage" },
      { href: "/security", label: "Security & privacy", icon: Shield },
      { href: "/setup", label: "Setup & docs", icon: LifeBuoy },
    ],
  },
];

export function Shell({
  appName,
  user,
  orgs,
  org,
  role,
  permissions,
  killSwitch,
  counts,
  children,
}: {
  appName: string;
  user: { name: string; email: string };
  orgs: Array<{ id: string; name: string }>;
  org: { id: string; name: string; aiPaused: boolean; autonomyMode: string };
  role: string;
  permissions: string[];
  killSwitch: boolean;
  counts: { pendingApprovals: number; escalated: number };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav aria-label="Main" className="space-y-5">
      {NAV.map((s) => (
        <div key={s.section}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{s.section}</p>
          <ul className="mt-1 space-y-0.5">
            {s.items
              .filter((i) => !i.perm || permissions.includes(i.perm))
              .map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={active(i.href) ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm",
                      active(i.href)
                        ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    )}
                  >
                    <i.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{i.label}</span>
                    {i.href === "/inbox" && counts.escalated + counts.pendingApprovals > 0 && (
                      <span
                        className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white"
                        title={`${counts.escalated} escalated, ${counts.pendingApprovals} drafts awaiting approval`}
                      >
                        {counts.escalated + counts.pendingApprovals}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 lg:hidden">
        <button
          aria-label="Open menu"
          className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold">{appName}</span>
        <Activity
          className={cn("h-5 w-5", org.aiPaused || killSwitch ? "text-amber-500" : "text-emerald-500")}
          aria-label={org.aiPaused || killSwitch ? "AI paused" : "AI active"}
        />
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white p-4 transition-transform dark:border-slate-800 dark:bg-slate-950 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {appName}
          </Link>
          <button
            aria-label="Close menu"
            className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {orgs.length > 1 ? (
          <select
            aria-label="Organization"
            className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={org.id}
            onChange={async (e) => {
              await api("/api/v1/me/switch-org", { body: { orgId: e.target.value } });
              window.location.href = "/";
            }}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="mb-4 truncate px-3 text-sm text-slate-500">{org.name}</p>
        )}
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          <p className="truncate px-3 font-medium">{user.name}</p>
          <p className="truncate px-3 text-xs text-slate-500">
            {user.email} · {role.toLowerCase()}
          </p>
          <button
            className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {!online && (
          <div className="bg-slate-800 px-4 py-2 text-center text-sm text-white">
            You are offline. Changes cannot be saved until the connection returns.
          </div>
        )}
        {killSwitch && (
          <div role="status" className="bg-red-600 px-4 py-2 text-center text-sm font-medium text-white">
            Global emergency stop is ON: no AI-generated messages are being sent.
          </div>
        )}
        {!killSwitch && org.aiPaused && (
          <div role="status" className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
            AI replies are paused for this organization.{" "}
            <Link href="/agent" className="underline">
              Resume in AI agent settings
            </Link>
          </div>
        )}
        <main id="main" className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
