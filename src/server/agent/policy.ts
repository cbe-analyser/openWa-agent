import type { AutonomyMode } from "@prisma/client";
import type { InboundFlags, OutputIssues } from "./safety";

export type AgentAction = "SEND" | "DRAFT" | "ESCALATE" | "IGNORE";
export type Resolution = "resolved" | "in_progress" | "needs_info" | "needs_human";

export interface PolicyInput {
  mode: AutonomyMode;
  threshold: number;
  autoReplyIntents: string[];
  escalatingIntents: Set<string>;
  intent: string;
  urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  flags: InboundFlags;
  wantsHumanModel: boolean;
  confidence: number;
  resolution: Resolution;
  hasReply: boolean;
  output: OutputIssues;
  pendingApproval: boolean;
  refusal: boolean;
  troubleshootingExhausted: boolean;
}

export interface PolicyDecision {
  action: AgentAction;
  reasons: string[];
}

/**
 * Decides what happens to the agent's drafted reply. Pure function — exhaustively unit-tested.
 * Escalation rules are evaluated first and cannot be overridden by the model or by autonomy mode.
 */
export function decide(p: PolicyInput): PolicyDecision {
  const esc: string[] = [];
  if (p.flags.wantsHuman || p.wantsHumanModel) esc.push("customer_requested_human");
  if (p.resolution === "needs_human") esc.push("agent_requested_human");
  if (p.flags.legal) esc.push("legal_matter");
  if (p.flags.securityIncident) esc.push("security_incident");
  if (p.flags.refund) esc.push("refund_requires_authorization");
  if (p.flags.financialTransaction) esc.push("financial_transaction_requires_authorization");
  if (p.flags.sensitiveData) esc.push("sensitive_personal_data");
  if (p.flags.abusive) esc.push("abusive_message");
  if (p.urgency === "URGENT") esc.push("urgent");
  if (p.escalatingIntents.has(p.intent)) esc.push(`intent_${p.intent}`);
  if (p.pendingApproval) esc.push("action_requires_approval");
  if (p.refusal) esc.push("model_refusal");
  if (p.troubleshootingExhausted) esc.push("repeated_unsuccessful_troubleshooting");
  if (p.output.asksForSecrets) esc.push("reply_requested_credentials");
  if (p.output.leaksInstructions) esc.push("reply_leaked_instructions");
  if (!p.hasReply) esc.push("no_usable_reply");
  if (p.confidence < p.threshold * 0.6 && p.resolution !== "needs_info") esc.push("low_confidence");

  if (p.intent === "spam_abuse" && p.flags.spam && esc.length === 0)
    return { action: "IGNORE", reasons: ["spam"] };
  if (esc.length) return { action: "ESCALATE", reasons: esc };

  const reasons: string[] = [];
  if (p.output.unverifiedClaims.length)
    reasons.push(...p.output.unverifiedClaims.map((c) => `unverified_claim_${c}`));
  if (p.flags.promptInjection) reasons.push("possible_prompt_injection");
  if (reasons.length) return { action: "DRAFT", reasons };

  switch (p.mode) {
    case "COPILOT":
      return { action: "DRAFT", reasons: ["copilot_mode"] };
    case "SUPERVISED": {
      if (!p.autoReplyIntents.includes(p.intent))
        return { action: "DRAFT", reasons: [`intent_${p.intent}_requires_approval`] };
      if (p.confidence < p.threshold) return { action: "DRAFT", reasons: ["below_confidence_threshold"] };
      return { action: "SEND", reasons: ["supervised_auto_approved"] };
    }
    case "AUTONOMOUS": {
      if (p.confidence >= p.threshold) return { action: "SEND", reasons: ["autonomous"] };
      if (p.resolution === "needs_info") return { action: "SEND", reasons: ["clarification_question"] };
      return { action: "ESCALATE", reasons: ["below_confidence_threshold"] };
    }
  }
}
