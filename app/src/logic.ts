import type { GuildJob } from "./chain";

export function isParticipant(job: GuildJob, account?: string) {
  if (!account) return false;
  const who = account.toLowerCase();
  return [job.client, job.worker, job.arbiter].some((address) => address.toLowerCase() === who);
}

export function eligibleActions(job: GuildJob, account: string | undefined, nowSeconds: bigint, reviewPeriod: bigint) {
  const who = account?.toLowerCase();
  const actions: Array<"submit" | "approve" | "dispute" | "refund" | "claim" | "resolve"> = [];
  if (!who) return actions;
  if (job.state === 1 && who === job.worker.toLowerCase() && nowSeconds <= job.deadline) actions.push("submit");
  if (job.state === 2 && who === job.client.toLowerCase()) actions.push("approve", "dispute");
  if (job.state === 1 && who === job.client.toLowerCase() && nowSeconds > job.deadline) actions.push("refund");
  if (job.state === 2 && who === job.worker.toLowerCase()) actions.push("dispute");
  if (job.state === 2 && who === job.worker.toLowerCase() && nowSeconds > job.submittedAt + reviewPeriod) actions.push("claim");
  if (job.state === 3 && who === job.arbiter.toLowerCase()) actions.push("resolve");
  return actions;
}

export function withinBudget(job: GuildJob, min?: bigint, max?: bigint) {
  return (min === undefined || job.amount >= min) && (max === undefined || job.amount <= max);
}

export function isRejected(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 4001;
}
