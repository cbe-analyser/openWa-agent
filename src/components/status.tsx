import { Badge, type Tone } from "./ui";

export function ControlBadge({ control, aiPaused }: { control: string; aiPaused?: boolean }) {
  if (aiPaused && control === "AI")
    return (
      <Badge tone="yellow" title="AI replies are paused for this conversation">
        AI paused
      </Badge>
    );
  const map: Record<string, [Tone, string, string]> = {
    AI: ["purple", "AI-controlled", "The AI agent is handling this conversation"],
    PENDING_HUMAN: [
      "yellow",
      "Waiting for human",
      "Escalated: AI replies are paused until a team member takes over",
    ],
    HUMAN: ["blue", "Human-controlled", "A team member is handling this conversation; AI replies are paused"],
  };
  const [tone, label, title] = map[control] ?? ["gray", control, control];
  return (
    <Badge tone={tone} title={title}>
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = {
    OPEN: "blue",
    PENDING: "yellow",
    ESCALATED: "red",
    RESOLVED: "green",
    IN_PROGRESS: "blue",
    WAITING: "yellow",
    CLOSED: "gray",
    SCHEDULED: "blue",
    SENT: "green",
    DELIVERED: "green",
    READ: "green",
    QUEUED: "gray",
    SENDING: "gray",
    FAILED: "red",
    REJECTED: "gray",
    SUPERSEDED: "gray",
    PENDING_APPROVAL: "yellow",
    CANCELLED: "gray",
    SKIPPED: "gray",
    READY: "green",
    PROCESSING: "blue",
    ACTIVE: "green",
    ERROR: "red",
    DISABLED: "gray",
    SUCCEEDED: "green",
    APPROVED: "green",
    DENIED: "red",
    healthy: "green",
    unhealthy: "red",
  };
  return <Badge tone={tone[status] ?? "gray"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const tone: Record<string, Tone> = { LOW: "gray", NORMAL: "gray", HIGH: "yellow", URGENT: "red" };
  return <Badge tone={tone[urgency] ?? "gray"}>{urgency.toLowerCase()}</Badge>;
}
