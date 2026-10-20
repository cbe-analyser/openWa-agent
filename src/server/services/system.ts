import { prisma } from "../db";
import { env } from "../env";

const KILL_SWITCH_KEY = "ai_kill_switch";

/** Instance-wide emergency stop for AI-generated outbound messages (env var OR runtime toggle). */
export async function isGlobalKillSwitchOn(): Promise<boolean> {
  if (env().AI_KILL_SWITCH) return true;
  const row = await prisma.systemSetting.findUnique({ where: { key: KILL_SWITCH_KEY } });
  return row?.value === true;
}

export async function setGlobalKillSwitch(on: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: KILL_SWITCH_KEY },
    create: { key: KILL_SWITCH_KEY, value: on },
    update: { value: on },
  });
}

/** Whether AI may currently send for an organization/conversation, with the reason if not. */
export async function aiSendBlockedReason(orgId: string, conversationId?: string): Promise<string | null> {
  if (await isGlobalKillSwitchOn()) return "global_kill_switch";
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { aiPaused: true } });
  if (!org) return "org_missing";
  if (org.aiPaused) return "org_ai_paused";
  if (conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: { aiPaused: true, control: true },
    });
    if (!conv) return "conversation_missing";
    if (conv.aiPaused) return "conversation_ai_paused";
    if (conv.control !== "AI") return `conversation_control_${conv.control.toLowerCase()}`;
  }
  return null;
}
