import { describe, expect, it } from "vitest";
import { eligibleActions, isParticipant, isRejected, withinBudget } from "./logic";
import type { GuildJob } from "./chain";
const client = "0x0000000000000000000000000000000000000011" as const;
const worker = "0x0000000000000000000000000000000000000022" as const;
const arbiter = "0x0000000000000000000000000000000000000033" as const;
const job: GuildJob = { id: `0x${"11".repeat(32)}`, client, worker, arbiter, amount: 250n, deadline: 1000n, submittedAt: 700n, state: 2, evidenceHash: `0x${"00".repeat(32)}`, blockNumber: 1n, transactionHash: `0x${"22".repeat(32)}` };
describe("Guild authorization derived from contract roles", () => {
  it("surfaces actions only to the assigned role and state", () => {
    expect(eligibleActions(job, client, 800n, 300n)).toEqual(["approve", "dispute"]);
    expect(eligibleActions(job, worker, 800n, 300n)).toEqual(["dispute"]);
    expect(eligibleActions(job, arbiter, 800n, 300n)).toEqual([]);
    expect(eligibleActions({ ...job, state: 3 }, arbiter, 800n, 300n)).toEqual(["resolve"]);
    expect(eligibleActions({ ...job, state: 2 }, worker, 1001n, 300n)).toEqual(["dispute", "claim"]);
  });
  it("checks participation case-insensitively and filters raw token units", () => {
    expect(isParticipant(job, client.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(withinBudget(job, 200n, 300n)).toBe(true);
    expect(withinBudget(job, 251n)).toBe(false);
  });
  it("recognizes an explicitly rejected wallet prompt", () => {
    expect(isRejected({ code: 4001 })).toBe(true);
    expect(isRejected(new Error("other"))).toBe(false);
  });
});
