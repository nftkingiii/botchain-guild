import { createPublicClient, createWalletClient, custom, defineChain, http, parseAbi } from "viem";

const env = import.meta.env;
export const escrowAddress = (env.VITE_GUILD_ESCROW_ADDRESS || "0x8fF7299cc7C86A091a7b1a7844a7793279AC7485") as `0x${string}`;
export const tokenAddress = (env.VITE_GUILD_TOKEN_ADDRESS || "0xF03f34a30eFd1d333249Ea733ee9c2564c188CEb") as `0x${string}`;
export const rpcUrl = env.VITE_BOTCHAIN_RPC_URL || "https://rpc.bohr.life";
export const deploymentBlock = BigInt(env.VITE_GUILD_DEPLOYMENT_BLOCK || "0x167ff1d");
export const guildChain = defineChain({
  id: 968, name: "BOT Chain Testnet", nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }, blockExplorers: { default: { name: "Bohr Scan", url: "https://scan.bohr.life" } }, testnet: true,
});
export const publicClient = createPublicClient({ chain: guildChain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }) });

export const escrowAbi = parseAbi([
  "function paymentToken() view returns (address)",
  "function REVIEW_PERIOD() view returns (uint64)",
  "function getJob(bytes32 jobId) view returns ((address client,address worker,address arbiter,uint128 amount,uint64 deadline,uint64 submittedAt,uint8 state,bytes32 evidenceHash))",
  "function fundJob(bytes32 jobId,address worker,address arbiter,uint128 amount,uint64 deadline)",
  "function submitEvidence(bytes32 jobId,bytes32 evidenceHash)",
  "function approve(bytes32 jobId)",
  "function openDispute(bytes32 jobId)",
  "function claimAfterReviewPeriod(bytes32 jobId)",
  "function resolveDispute(bytes32 jobId,bool releaseToWorker)",
  "function refundAfterDeadline(bytes32 jobId)",
  "event JobFunded(bytes32 indexed jobId,address indexed client,address indexed worker,uint256 amount,uint64 deadline,address arbiter)",
  "event EvidenceSubmitted(bytes32 indexed jobId,bytes32 indexed evidenceHash)",
  "event DisputeOpened(bytes32 indexed jobId,address indexed openedBy)",
  "event JobReleased(bytes32 indexed jobId,address indexed worker,uint256 amount)",
  "event JobRefunded(bytes32 indexed jobId,address indexed client,uint256 amount,bool timedOut)",
]);
export const tokenAbi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function mint(address to,uint256 amount)",
]);

export type GuildJob = {
  id: `0x${string}`; client: `0x${string}`; worker: `0x${string}`; arbiter: `0x${string}`;
  amount: bigint; deadline: bigint; submittedAt: bigint; state: number; evidenceHash: `0x${string}`;
  blockNumber: bigint; transactionHash: `0x${string}`;
};
export type JobMeta = { title: string; scope: string; createdAt: number; source: "local" | "imported" };
export type TimelineEvent = { kind: "funded" | "evidence" | "dispute" | "released" | "refunded"; block: bigint; hash: `0x${string}`; actor?: string; timedOut?: boolean };

export const statusNames = ["Unknown", "Funded", "Submitted", "Disputed", "Released", "Refunded"] as const;
export function metaKey(account: string, id: string) { return `guild:968:${escrowAddress.toLowerCase()}:${account.toLowerCase()}:${id.toLowerCase()}`; }
export function getMeta(account: string, id: string): JobMeta | null {
  try { const value: unknown = JSON.parse(localStorage.getItem(metaKey(account, id)) || "null"); if (!value || typeof value !== "object") return null; const item = value as Record<string, unknown>; if (typeof item.title !== "string" || item.title.length > 90 || typeof item.scope !== "string" || item.scope.length > 3000 || typeof item.createdAt !== "number") return null; return { title: item.title, scope: item.scope, createdAt: item.createdAt, source: item.source === "imported" ? "imported" : "local" }; } catch { return null; }
}
export function putMeta(account: string, id: string, meta: JobMeta) { if (meta.title.length > 90 || meta.scope.length > 3000) throw new Error("Local brief exceeds allowed length."); localStorage.setItem(metaKey(account, id), JSON.stringify(meta)); }

export async function readJobs(): Promise<GuildJob[]> {
  const chainId = await publicClient.getChainId();
  if (chainId !== 968) throw new Error(`RPC chain mismatch: expected 968, received ${chainId}`);
  const [escrowCode, tokenCode, configuredToken] = await Promise.all([
    publicClient.getCode({ address: escrowAddress }), publicClient.getCode({ address: tokenAddress }),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "paymentToken" }),
  ]);
  if (!escrowCode || escrowCode === "0x") throw new Error("No contract bytecode at the configured Guild escrow address.");
  if (!tokenCode || tokenCode === "0x") throw new Error("No contract bytecode at the configured test-token address.");
  if (configuredToken.toLowerCase() !== tokenAddress.toLowerCase()) throw new Error("Configured MockUSDT address does not match the escrow's paymentToken().");
  const latest = await publicClient.getBlockNumber();
  const funded = escrowAbi.find((item) => item.type === "event" && item.name === "JobFunded") as any;
  if (!funded) throw new Error("JobFunded ABI unavailable");
  const logs = [] as Awaited<ReturnType<typeof publicClient.getLogs>>[];
  for (let start = deploymentBlock; start <= latest; start += 4000n) {
    const end = start + 3999n < latest ? start + 3999n : latest;
    logs.push(await publicClient.getLogs({ address: escrowAddress, event: funded, fromBlock: start, toBlock: end }));
  }
  const entries = logs.flat().slice(-100).reverse();
  const jobs = await Promise.all(entries.map(async (log) => {
    const id = (log.args as { jobId?: `0x${string}` } | undefined)?.jobId;
    if (!id || log.blockNumber === null || !log.transactionHash) return null;
    const job = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getJob", args: [id] });
    return { id, client: job.client, worker: job.worker, arbiter: job.arbiter, amount: job.amount, deadline: job.deadline, submittedAt: job.submittedAt, state: job.state, evidenceHash: job.evidenceHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash } satisfies GuildJob;
  }));
  return jobs.filter((job): job is GuildJob => job !== null);
}

export async function readTimeline(id: `0x${string}`, from = deploymentBlock): Promise<TimelineEvent[]> {
  const latest = await publicClient.getBlockNumber();
  const eventNames = ["JobFunded", "EvidenceSubmitted", "DisputeOpened", "JobReleased", "JobRefunded"] as const;
  const all: TimelineEvent[] = [];
  for (const name of eventNames) {
    const event = escrowAbi.find((item) => item.type === "event" && item.name === name) as any;
    if (!event) continue;
    for (let start = from; start <= latest; start += 4000n) {
      const end = start + 3999n < latest ? start + 3999n : latest;
      const logs = await publicClient.getLogs({ address: escrowAddress, event, args: { jobId: id }, fromBlock: start, toBlock: end });
      for (const log of logs) {
        if (log.blockNumber === null) continue;
        const args = log.args as Record<string, unknown>;
        const kind = name === "JobFunded" ? "funded" : name === "EvidenceSubmitted" ? "evidence" : name === "DisputeOpened" ? "dispute" : name === "JobReleased" ? "released" : "refunded";
        const actor = kind === "funded" || kind === "refunded" ? args.client as string | undefined : kind === "dispute" ? args.openedBy as string | undefined : kind === "released" ? args.worker as string | undefined : undefined;
        all.push({ kind, block: log.blockNumber, hash: (args.evidenceHash as `0x${string}` | undefined) ?? id, actor, timedOut: args.timedOut as boolean | undefined });
      }
    }
  }
  return all.sort((a, b) => a.block < b.block ? -1 : a.block > b.block ? 1 : 0);
}

export type WalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
declare global { interface Window { ethereum?: WalletProvider } }
export function walletClient() { if (!window.ethereum) throw new Error("No injected wallet found. Install or open a compatible EVM wallet."); return createWalletClient({ chain: guildChain, transport: custom(window.ethereum) }); }
export async function ensureTestnet() {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found.");
  const current = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(current, 16) === 968) return;
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] }); }
  catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x3c8", chainName: "BOT Chain Testnet", nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 }, rpcUrls: [rpcUrl], blockExplorerUrls: ["https://scan.bohr.life"] }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] });
  }
}
export async function sha256File(file: File): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
