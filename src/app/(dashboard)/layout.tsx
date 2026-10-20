import { requirePageAuth } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { isGlobalKillSwitchOn } from "@/server/services/system";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageAuth();
  const [user, org, killSwitch, pendingApprovals, escalated] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId! },
      select: {
        name: true,
        email: true,
        memberships: { select: { org: { select: { id: true, name: true } } } },
      },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: ctx.orgId },
      select: { id: true, name: true, aiPaused: true, autonomyMode: true },
    }),
    isGlobalKillSwitchOn(),
    prisma.message.count({ where: { orgId: ctx.orgId, status: "PENDING_APPROVAL" } }),
    prisma.conversation.count({ where: { orgId: ctx.orgId, control: "PENDING_HUMAN" } }),
  ]);
  return (
    <Shell
      appName={process.env.APP_NAME ?? "OpenWa Agent"}
      user={{ name: user.name, email: user.email }}
      orgs={user.memberships.map((m) => m.org)}
      org={org}
      role={ctx.role!}
      permissions={ctx.permissions}
      killSwitch={killSwitch}
      counts={{ pendingApprovals, escalated }}
    >
      {children}
    </Shell>
  );
}
