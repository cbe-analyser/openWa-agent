import { route } from "@/server/http/route";
import { notFound } from "@/server/errors";
import { retryDeadJob } from "@/server/jobs/queue";
import { auditCtx } from "@/server/services/audit";

/** Re-queues a dead-lettered job belonging to this organization. */
export const POST = route<{ id: string }>(
  { auth: "session", permission: "settings:write" },
  async (_req, { ctx, params }) => {
    if (!(await retryDeadJob(ctx.orgId, params.id))) throw notFound("Dead job");
    await auditCtx(ctx, "job.retried", { type: "job", id: params.id });
    return { requeued: true };
  },
);
