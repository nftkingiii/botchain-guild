import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowLeft, ArrowUpRight, Check, CircleAlert, CircleHelp, Clock3, Compass, Copy, ExternalLink, FileCheck2, Filter, BriefcaseBusiness, Menu, Plus, RefreshCw, Search, ShieldCheck, Wallet, X } from "lucide-react";
import { keccak256, toBytes, type Address, type Hash } from "viem";
import { escrowAbi, escrowAddress, GuildJob, getMeta, JobMeta, publicClient, putMeta, readJobs, readTimeline, sha256File, statusNames, TimelineEvent, tokenAbi, tokenAddress, walletClient, ensureTestnet } from "./chain";
import { eligibleActions, isParticipant, isRejected, withinBudget } from "./logic";

type Tab = "discover" | "work" | "escrow";
type Notice = { kind: "info" | "success" | "error"; text: string; hash?: Hash };
const tabNames: Record<Tab, string> = { discover: "Discover", work: "My work", escrow: "Escrow" };
const stateLabels = statusNames;
const explorer = (path: string) => `https://scan.bohr.life/${path}`;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const zeroHash = `0x${"0".repeat(64)}` as Hash;

export default function Guild() {
  const [tab, setTab] = useState<Tab>(() => readRoute().tab);
  const [selectedId, setSelectedId] = useState<string | null>(() => readRoute().jobId);
  const [jobs, setJobs] = useState<GuildJob[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [readVersion, setReadVersion] = useState(0);
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reviewPeriod, setReviewPeriod] = useState(259200n);
  const [chainNow, setChainNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  const [tokenBalance, setTokenBalance] = useState<bigint>();
  const [allowance, setAllowance] = useState<bigint>();
  const [notice, setNotice] = useState<Notice>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [newBriefOpen, setNewBriefOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [workerAddress, setWorkerAddress] = useState("");
  const [arbiterAddress, setArbiterAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [evidenceFileName, setEvidenceFileName] = useState("");
  const [meta, setMeta] = useState<Record<string, JobMeta | null>>({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selected = jobs.find((job) => job.id.toLowerCase() === selectedId?.toLowerCase());

  const refreshJobs = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const [items, period, latest] = await Promise.all([
        readJobs(), publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "REVIEW_PERIOD" }),
        publicClient.getBlock(),
      ]);
      setJobs(items); setReviewPeriod(period); setChainNow(latest.timestamp); setLoadError(""); setReadVersion((version) => version + 1);
      if (account) {
        setMeta(Object.fromEntries(items.map((job) => [job.id, getMeta(account, job.id)])));
      }
    } catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [account]);

  useEffect(() => {
    setWalletAvailable(Boolean(window.ethereum));
    if (window.ethereum) {
      const onAccounts = (value: unknown) => { const next = Array.isArray(value) && typeof value[0] === "string" ? value[0] as Address : undefined; setAccount(next); };
      const onChain = (value: unknown) => { setChainId(Number.parseInt(String(value), 16)); void refreshJobs(); };
      window.ethereum.on?.("accountsChanged", onAccounts); window.ethereum.on?.("chainChanged", onChain);
      void window.ethereum.request({ method: "eth_accounts" }).then(onAccounts).catch(() => undefined);
      void window.ethereum.request({ method: "eth_chainId" }).then(onChain).catch(() => undefined);
      return () => { window.ethereum?.removeListener?.("accountsChanged", onAccounts); window.ethereum?.removeListener?.("chainChanged", onChain); };
    }
    return;
  }, [refreshJobs]);

  useEffect(() => { void refreshJobs(); const id = window.setInterval(() => void refreshJobs(), 45_000); return () => clearInterval(id); }, [refreshJobs]);
  useEffect(() => {
    if (!account) { setTokenBalance(undefined); setAllowance(undefined); return; }
    let stale = false;
    Promise.all([
      publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [account] }),
      publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "allowance", args: [account, escrowAddress] }),
    ]).then(([balance, approved]) => { if (!stale) { setTokenBalance(balance); setAllowance(approved); } }).catch(() => { if (!stale) { setTokenBalance(undefined); setAllowance(undefined); } });
    return () => { stale = true; };
  }, [account, jobs, notice?.hash]);
  useEffect(() => { updateRoute(tab, selectedId); }, [tab, selectedId]);
  useEffect(() => { const sync = () => { const route = readRoute(); setTab(route.tab); setSelectedId(route.jobId); }; window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  useEffect(() => {
    if (!selected) { setTimeline([]); return; }
    let stale = false;
    void readTimeline(selected.id).then((events) => { if (!stale) setTimeline(events); }).catch((error) => { if (!stale) setNotice({ kind: "error", text: `Event history unavailable: ${errorMessage(error)}` }); });
    return () => { stale = true; };
  }, [selected?.id, readVersion]);

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    if (tab === "work" && !isParticipant(job, account)) return false;
    if (tab === "escrow" && job.client.toLowerCase() !== account?.toLowerCase()) return false;
    if (statusFilter !== "all" && stateLabels[job.state] !== statusFilter) return false;
    const roleOk = roleFilter === "all" || (roleFilter === "client" && job.client.toLowerCase() === account?.toLowerCase()) || (roleFilter === "worker" && job.worker.toLowerCase() === account?.toLowerCase()) || (roleFilter === "arbiter" && job.arbiter.toLowerCase() === account?.toLowerCase());
    if (!roleOk || !withinBudget(job, minBudget ? BigInt(minBudget) : undefined, maxBudget ? BigInt(maxBudget) : undefined)) return false;
    const localTitle = account ? getMeta(account, job.id)?.title ?? "" : "";
    const needle = search.trim().toLowerCase();
    return !needle || [job.id, job.client, job.worker, job.arbiter, localTitle].some((v) => v.toLowerCase().includes(needle));
  }), [jobs, tab, account, statusFilter, roleFilter, minBudget, maxBudget, search]);

  async function connect() {
    if (!window.ethereum) { setNotice({ kind: "error", text: "No injected wallet detected. Install or open an EVM wallet, then retry." }); return; }
    setConnecting(true);
    try { const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[]; const id = await window.ethereum.request({ method: "eth_chainId" }) as string; setAccount(accounts[0] as Address | undefined); setChainId(Number.parseInt(id, 16)); setNotice({ kind: "success", text: "Wallet connected. No transaction has been sent." }); }
    catch (error) { setNotice({ kind: "error", text: isRejected(error) ? "Wallet connection was cancelled." : errorMessage(error) }); }
    finally { setConnecting(false); }
  }
  function disconnect() { setAccount(undefined); setNotice({ kind: "info", text: "Wallet disconnected from this page." }); }
  async function switchNetwork() {
    try { await ensureTestnet(); const id = await window.ethereum?.request({ method: "eth_chainId" }) as string; setChainId(Number.parseInt(id, 16)); setNotice({ kind: "success", text: "Wallet is on BOT Chain Testnet." }); }
    catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
  }

  async function sendWrite(label: string, address: Address, abi: typeof escrowAbi | typeof tokenAbi, functionName: string, args: readonly unknown[]) {
    if (!account) throw new Error("Connect a wallet before continuing.");
    if (!window.ethereum) throw new Error("No injected wallet found.");
    await ensureTestnet();
    const client = walletClient();
    setBusy(true); setNotice({ kind: "info", text: `Checking ${label} against the deployed contract…` });
    try {
      const simulation = await publicClient.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, account });
      setNotice({ kind: "info", text: `Confirm ${label} in your wallet. Nothing is sent until you approve there.` });
      const hash = await client.writeContract(simulation.request as never);
      setNotice({ kind: "info", text: `${label} submitted. Waiting for BOT Chain confirmation…`, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
      setNotice({ kind: "success", text: `${label} confirmed in block ${receipt.blockNumber.toString()}.`, hash });
      await refreshJobs();
      return hash;
    } catch (error) {
      const cancelled = isRejected(error) || (error instanceof Error && /user rejected|user denied/i.test(error.message));
      setNotice({ kind: "error", text: cancelled ? `${label} was cancelled in the wallet.` : errorMessage(error) });
      throw error;
    } finally { setBusy(false); }
  }

  async function approveToken() {
    const value = BigInt(amount || "0"); if (value <= 0n) { setNotice({ kind: "error", text: "Enter a positive whole number of MockUSDT base units." }); return; }
    try { await sendWrite("MockUSDT approval", tokenAddress, tokenAbi, "approve", [escrowAddress, value]); const approved = await publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "allowance", args: [account!, escrowAddress] }); setAllowance(approved); }
    catch { /* message was set by sendWrite */ }
  }
  async function mintTestToken() {
    const value = BigInt(amount || "0"); if (!account || value <= 0n) { setNotice({ kind: "error", text: "Connect a wallet and enter a positive whole number of test-token base units." }); return; }
    try { await sendWrite("MockUSDT test mint", tokenAddress, tokenAbi, "mint", [account, value]); }
    catch { /* message was set by sendWrite */ }
  }
  async function fundBrief(event: FormEvent) {
    event.preventDefault();
    if (!account) { setNotice({ kind: "error", text: "Connect a wallet to fund a brief." }); return; }
    let worker: Address; let arbiter: Address; let value: bigint;
    try {
      worker = parseAddress(workerAddress); arbiter = parseAddress(arbiterAddress); value = BigInt(amount);
      if (!title.trim() || !scope.trim()) throw new Error("Add a title and scope before continuing.");
      if (value <= 0n || value > (1n << 128n) - 1n) throw new Error("Enter an amount within the contract's uint128 range.");
      if (worker.toLowerCase() === account.toLowerCase() || arbiter.toLowerCase() === account.toLowerCase() || worker.toLowerCase() === arbiter.toLowerCase()) throw new Error("Client, worker, and arbiter must be three different addresses.");
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); return; }
    if ((allowance ?? 0n) < value) { setNotice({ kind: "error", text: "Approve this amount of test-token base units to the escrow first." }); return; }
    const id = keccak256(toBytes(`${account}:${Date.now()}:${crypto.randomUUID()}:${title}`));
    const due = BigInt(Math.floor(Date.now() / 1000) + Number(deadlineDays) * 86_400);
    try {
      const hash = await sendWrite("Fund brief", escrowAddress, escrowAbi, "fundJob", [id, worker, arbiter, value, due]);
      const local = { title: title.trim(), scope: scope.trim(), createdAt: Date.now(), source: "local" as const };
      try { putMeta(account, id, local); setMeta((m) => ({ ...m, [id]: local })); }
      catch { setNotice({ kind: "error", text: "Brief funded, but its title/scope could not be saved to this browser. Contract data remains available on-chain.", hash }); }
      setSelectedId(id); setTab("work"); setNewBriefOpen(false); setTitle(""); setScope(""); setWorkerAddress(""); setArbiterAddress(""); setAmount("");
    } catch { /* status shown by sendWrite */ }
  }
  async function performAction(action: "submit" | "approve" | "dispute" | "refund" | "claim" | "resolve", job: GuildJob, resolveRelease?: boolean) {
    const names = { submit: "Submit evidence commitment", approve: "Approve work and release funds", dispute: "Open dispute", refund: "Refund after deadline", claim: "Claim after review period", resolve: "Resolve dispute" };
    let functionName: string; let args: readonly unknown[];
    if (action === "submit") {
      if (!/^0x[0-9a-fA-F]{64}$/.test(evidenceHash) || evidenceHash === zeroHash) { setNotice({ kind: "error", text: "Choose a file to hash locally or enter a non-zero bytes32 evidence commitment." }); return; }
      functionName = "submitEvidence"; args = [job.id, evidenceHash as Hash];
    } else if (action === "approve") { functionName = "approve"; args = [job.id]; }
    else if (action === "dispute") { functionName = "openDispute"; args = [job.id]; }
    else if (action === "refund") { functionName = "refundAfterDeadline"; args = [job.id]; }
    else if (action === "claim") { functionName = "claimAfterReviewPeriod"; args = [job.id]; }
    else {
      if (resolveRelease === undefined) return;
      functionName = "resolveDispute"; args = [job.id, resolveRelease];
    }
    try { await sendWrite(names[action], escrowAddress, escrowAbi, functionName, args); setEvidenceHash(""); setEvidenceFileName(""); }
    catch { /* status shown by sendWrite */ }
  }
  async function onFile(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setNotice({ kind: "error", text: "Evidence files must be 20 MB or smaller to hash in this browser." }); return; }
    try { setEvidenceHash(await sha256File(file)); setEvidenceFileName(file.name); setNotice({ kind: "info", text: "SHA-256 calculated locally. The file is not uploaded; only its hash can be written." }); }
    catch { setNotice({ kind: "error", text: "This browser could not hash the selected file." }); }
  }

  const now = chainNow;
  const actions = selected ? eligibleActions(selected, account, now, reviewPeriod) : [];
  const nav = <nav className="tabs" aria-label="Guild workspace tabs" role="tablist">{(Object.keys(tabNames) as Tab[]).map((key) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => { setTab(key); setSelectedId(null); setNewBriefOpen(false); setMobileNavOpen(false); }}><span>{tabNames[key]}</span>{key === "work" && account && <small>{jobs.filter((job) => isParticipant(job, account)).length}</small>}</button>)}</nav>;

  return <div className="app-shell">
    <aside className="rail">
      <a className="brand" href="#discover" aria-label="Guild home"><img src="/guild-mark.svg" width="38" height="38" alt=""/><span>Guild</span></a>
      <div className="rail-chain"><span className="pulse"/>BOT Chain Testnet <small>968</small></div>
      <div className="rail-label">WORKSPACE</div>
      <div className="rail-nav">{(Object.keys(tabNames) as Tab[]).map((key) => { const Icon = key === "discover" ? Compass : key === "work" ? BriefcaseBusiness : ShieldCheck; return <button key={key} className={tab === key && !selected && !newBriefOpen ? "rail-link chosen" : "rail-link"} onClick={() => { setTab(key); setSelectedId(null); setNewBriefOpen(false); }}><Icon size={17}/>{tabNames[key]}{key === "work" && account && <span className="count">{jobs.filter((job) => isParticipant(job, account)).length}</span>}</button>; })}</div>
      <div className="rail-bottom"><div className="rail-note"><strong>Work, in clear steps.</strong><span>Each escrow is a separate agreement. The contract stores roles, amount, dates and evidence hash — not your brief text.</span></div><a href="https://scan.bohr.life/address/0x8ff7299cc7c86a091a7b1a7844a7793279ac7485" target="_blank" rel="noreferrer">Verified contract <ArrowUpRight size={14}/></a></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-button" title="Open navigation" aria-label="Open navigation" onClick={() => setMobileNavOpen((v) => !v)}><Menu size={19}/></button><div className="breadcrumb"><img src="/guild-mark.svg" alt=""/> <span>Guild</span><span className="slash">/</span><strong>{selected ? "Workroom" : newBriefOpen ? "New brief" : tabNames[tab]}</strong></div><div className="top-actions">{chainId !== undefined && chainId !== 968 && account ? <button className="network-chip warning" onClick={() => void switchNetwork()} title="Switch wallet to BOT Chain Testnet"><span className="pulse"/>Wrong network · switch</button> : <span className="network-chip"><span className="pulse"/>{chainId === 968 ? "BOT Chain Testnet" : "Public reads"}</span>}{account ? <button className="wallet-button connected" onClick={disconnect} title="Disconnect wallet"><span className="wallet-dot"/><span>{short(account)}</span><X size={14}/></button> : <button className="wallet-button" onClick={() => void connect()} disabled={connecting}><Wallet size={16}/>{connecting ? "Connecting…" : "Connect wallet"}</button>}</div></header>
      <div className="content">
        {!selected && !newBriefOpen && <><div className="title-row"><div><h1>{tab === "discover" ? "Find work in motion." : tab === "work" ? "Your work." : "Escrow you opened."}</h1><p>{tab === "discover" ? "On-chain briefs, their assigned roles, and what can happen next." : tab === "work" ? "Agreements where your connected address has a defined role." : "Briefs funded by this address. Contract state determines the next step."}</p></div>{tab === "escrow" && <button className="primary-button" onClick={() => { if (!account) { setNotice({ kind: "error", text: "Connect a wallet before opening an escrow brief." }); return; } setNewBriefOpen(true); }}><Plus size={17}/> New brief</button>}</div>
          {nav}
          <section className="filterbar" aria-label="Filter briefs"><label className="search-field"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brief, ID or address" aria-label="Search briefs"/><kbd>/</kbd></label><label><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{stateLabels.slice(1).map((s) => <option key={s}>{s}</option>)}</select></label><label><span className="sr-only">Filter by your role</span><select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">All roles</option><option value="client">Client</option><option value="worker">Worker</option><option value="arbiter">Arbiter</option></select></label><label className="budget-filter"><span className="sr-only">Minimum token units</span><input inputMode="numeric" value={minBudget} onChange={(e) => setMinBudget(e.target.value.replace(/\D/g, ""))} placeholder="Min units"/><span>–</span><input inputMode="numeric" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value.replace(/\D/g, ""))} placeholder="Max units"/></label><button className="icon-button filter-reset" aria-label="Clear filters" title="Clear filters" onClick={() => { setSearch(""); setStatusFilter("all"); setRoleFilter("all"); setMinBudget(""); setMaxBudget(""); }}><Filter size={16}/></button></section>
          <div className="list-meta"><span>{loading ? "Reading testnet…" : `${visibleJobs.length} ${visibleJobs.length === 1 ? "brief" : "briefs"}`}</span><button onClick={() => void refreshJobs()} className="refresh-link" disabled={loading}><RefreshCw size={14} className={loading ? "spinning" : ""}/> Refresh</button></div>
          {loadError ? <div className="state-block error-state"><CircleAlert/><h2>Couldn’t read the Guild contract</h2><p>{loadError}</p><button className="secondary-button" onClick={() => void refreshJobs()}>Retry read</button></div> : loading && jobs.length === 0 ? <div className="loading-list" aria-label="Loading briefs">{[1,2,3].map((n) => <div className="skeleton-row" key={n}><span/><span/><span/></div>)}</div> : visibleJobs.length === 0 ? <div className="state-block"><img className="empty-art" src="/guild-illustration.svg" width="360" height="110" alt="Intersecting work blocks leading to a checked proof sheet"/><h2>{jobs.length === 0 ? "No funded briefs yet." : "No briefs match these filters."}</h2><p>{jobs.length === 0 ? "This is the live testnet contract, not sample data. Open an escrow brief to make the first agreement visible." : "Try clearing one or more filters, or check another workspace tab."}</p>{jobs.length === 0 && tab === "escrow" && account && <button className="primary-button" onClick={() => setNewBriefOpen(true)}><Plus size={17}/> Open a brief</button>}</div> : <div className="brief-list" role="list">{visibleJobs.map((job) => <BriefRow key={job.id} job={job} account={account} meta={account ? getMeta(account, job.id) : null} onClick={() => setSelectedId(job.id)} />)}</div>}
          {tab === "escrow" && <TestTokenPanel account={account} balance={tokenBalance} amount={amount} setAmount={setAmount} busy={busy} onMint={() => void mintTestToken()} onConnect={() => void connect()}/>}</>}
        {newBriefOpen && !selected && <NewBrief onCancel={() => setNewBriefOpen(false)} onSubmit={fundBrief} title={title} setTitle={setTitle} scope={scope} setScope={setScope} workerAddress={workerAddress} setWorkerAddress={setWorkerAddress} arbiterAddress={arbiterAddress} setArbiterAddress={setArbiterAddress} amount={amount} setAmount={setAmount} days={deadlineDays} setDays={setDeadlineDays} allowance={allowance} balance={tokenBalance} account={account} busy={busy} onApprove={() => void approveToken()} onConnect={() => void connect()} />}
        {selected && <JobWorkspace job={selected} account={account} meta={account ? getMeta(account, selected.id) : null} timeline={timeline} actions={actions} now={now} reviewPeriod={reviewPeriod} onBack={() => setSelectedId(null)} onAction={(action, resolution) => void performAction(action, selected, resolution)} evidenceHash={evidenceHash} setEvidenceHash={setEvidenceHash} fileName={evidenceFileName} onFile={(f) => void onFile(f)} busy={busy} onMetaImported={(next) => { if (account) { putMeta(account, selected.id, next); setMeta((current) => ({ ...current, [selected.id]: next })); setNotice({ kind: "success", text: "Shared brief text imported to this browser. Its title and scope are not verified by the contract." }); } }} />}
      </div>
      <footer className="page-footer"><span><span className="pulse"/> Public reads · BOT Chain Testnet 968</span><a href="https://scan.bohr.life/address/0x8ff7299cc7c86a091a7b1a7844a7793279ac7485" target="_blank" rel="noreferrer">Contract <ExternalLink size={13}/></a><span>Test MockUSDT only · not a production asset</span></footer>
    </main>
    {mobileNavOpen && <div className="mobile-nav-panel">{nav}<button className="secondary-button" onClick={() => { setNewBriefOpen(true); setMobileNavOpen(false); }}>Open a brief</button></div>}
    {notice && <div role="status" aria-live="polite" className={`toast ${notice.kind}`}><span className="toast-symbol">{notice.kind === "success" ? <Check size={17}/> : notice.kind === "error" ? <CircleAlert size={17}/> : <Activity size={17}/>}</span><span>{notice.text}{notice.hash && <a href={explorer(`tx/${notice.hash}`)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12}/></a>}</span><button aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X size={16}/></button></div>}
    <span className="sr-only" aria-live="polite">{busy ? "Transaction preparation is active" : ""}</span>
  </div>;
}

function BriefRow({ job, account, meta, onClick }: { job: GuildJob; account?: string; meta: JobMeta | null; onClick: () => void }) {
  const role = account?.toLowerCase() === job.client.toLowerCase() ? "Client" : account?.toLowerCase() === job.worker.toLowerCase() ? "Worker" : account?.toLowerCase() === job.arbiter.toLowerCase() ? "Arbiter" : "Public";
  return <button className="brief-row" role="listitem" onClick={onClick}><span className="brief-mark"><img src="/guild-mark.svg" alt=""/></span><span className="brief-copy"><strong>{meta?.title ?? `Agreement ${job.id.slice(0, 10)}…`}</strong><span>{meta ? meta.scope : "On-chain scope text is unavailable for this agreement."}</span><span className="brief-roles"><span>Client {short(job.client)}</span><span>Worker {short(job.worker)}</span></span></span><span className="brief-state"><StatePill state={job.state}/><small>{role}</small></span><span className="brief-value"><b>{job.amount.toString()}</b><small>test-token base units</small></span><span className="brief-due"><Clock3 size={13}/>{formatDate(job.deadline)}</span><span className="brief-open" aria-hidden="true">↗</span></button>;
}
function StatePill({ state }: { state: number }) { const variant = ["unknown", "funded", "submitted", "disputed", "released", "refunded"][state] ?? "unknown"; return <span className={`state-pill ${variant}`}>{stateLabels[state] ?? "Unknown"}</span>; }
function TestTokenPanel({ account, balance, amount, setAmount, busy, onMint, onConnect }: { account?: string; balance?: bigint; amount: string; setAmount: (value: string) => void; busy: boolean; onMint: () => void; onConnect: () => void }) {
  return <section className="test-token"><div className="token-title"><ShieldCheck size={17}/><strong>Test token only</strong><span>MockUSDT · unrestricted mint · not production money</span></div><div className="token-controls"><p>{account ? <>Connected balance <b>{balance === undefined ? "unavailable" : balance.toString()}</b> base units</> : "Connect a wallet to inspect its token balance or mint test units."}<small>The deployed token exposes no decimals()/symbol() metadata. Values are raw integer units, not formatted USDT.</small></p><div className="mint-form"><input aria-label="Test token amount in base units" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Whole base units"/><button className="secondary-button" disabled={busy} onClick={account ? onMint : onConnect}>{account ? "Mint test units" : "Connect wallet"}</button></div></div></section>;
}
function NewBrief({ onCancel, onSubmit, title, setTitle, scope, setScope, workerAddress, setWorkerAddress, arbiterAddress, setArbiterAddress, amount, setAmount, days, setDays, allowance, balance, account, busy, onApprove, onConnect }: { onCancel: () => void; onSubmit: (e: FormEvent) => void; title: string; setTitle: (s: string) => void; scope: string; setScope: (s: string) => void; workerAddress: string; setWorkerAddress: (s: string) => void; arbiterAddress: string; setArbiterAddress: (s: string) => void; amount: string; setAmount: (s: string) => void; days: string; setDays: (s: string) => void; allowance?: bigint; balance?: bigint; account?: string; busy: boolean; onApprove: () => void; onConnect: () => void }) {
  return <><div className="detail-top"><button className="back-button" onClick={onCancel}><ArrowLeft size={16}/> Escrow list</button></div><section className="new-brief"><div className="new-brief-header"><h1>Open a brief</h1><p>Create the escrow agreement now. Title and scope stay in this browser; only contract fields are public.</p></div><form onSubmit={onSubmit} className="brief-form"><label>Brief title<input required maxLength={90} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rebuild the contributor docs"/></label><label>Scope and acceptance notes<textarea required maxLength={3000} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Describe the work and how the client will review it. Saved locally in this browser; not written to chain." rows={5}/><small>Private to this browser profile. Other participants will not automatically receive this text.</small></label><div className="form-split"><label>Worker address<input required pattern="0x[a-fA-F0-9]{40}" value={workerAddress} onChange={(e) => setWorkerAddress(e.target.value)} placeholder="0x…" autoComplete="off"/></label><label>Arbiter address<input required pattern="0x[a-fA-F0-9]{40}" value={arbiterAddress} onChange={(e) => setArbiterAddress(e.target.value)} placeholder="0x…" autoComplete="off"/></label></div><div className="form-split"><label>Amount · whole MockUSDT base units<input required inputMode="numeric" pattern="[0-9]+" min="1" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="1000000"/><small>Raw token units: the verified mock exposes no decimals metadata.</small></label><label>Delivery deadline<select value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label></div><aside className="contract-preview"><strong>Before you continue</strong><span>Chain write: escrow will hold the amount and store the three wallet roles, due time, and agreement ID. Client, worker, and arbiter must be different. The title and scope are local-only.</span><span>{account ? `Your wallet ${short(account)} will be the client.` : "A wallet is required to create this agreement."}</span><span>Current token approval: {allowance === undefined ? "not loaded" : allowance.toString()} base units · connected balance: {balance === undefined ? "unknown" : balance.toString()} base units</span></aside><div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>{!account ? <button type="button" className="primary-button" onClick={onConnect}><Wallet size={16}/> Connect wallet</button> : (allowance ?? 0n) < BigInt(amount || "0") ? <button type="button" className="primary-button" onClick={onApprove} disabled={busy || !amount}><ShieldCheck size={16}/> Approve {amount || "0"} units</button> : <button className="primary-button" disabled={busy || !title.trim() || !scope.trim()}><Plus size={16}/>{busy ? "Waiting for wallet…" : "Fund escrow"}</button>}</div></form><p className="local-storage-note">Your brief text is scoped to chain, contract, and client address in local browser storage. Clearing site data removes it.</p></section></>;
}

function JobWorkspace({ job, account, meta, timeline, actions, now, reviewPeriod, onBack, onAction, evidenceHash, setEvidenceHash, fileName, onFile, busy, onMetaImported }: { job: GuildJob; account?: string; meta: JobMeta | null; timeline: TimelineEvent[]; actions: Array<"submit" | "approve" | "dispute" | "refund" | "claim" | "resolve">; now: bigint; reviewPeriod: bigint; onBack: () => void; onAction: (action: "submit" | "approve" | "dispute" | "refund" | "claim" | "resolve", resolution?: boolean) => void; evidenceHash: string; setEvidenceHash: (s: string) => void; fileName: string; onFile: (file?: File) => void; busy: boolean; onMetaImported: (meta: JobMeta) => void }) {
  const [copied, setCopied] = useState(false);
  const [resolution, setResolution] = useState<"release" | "refund" | "">("");
  const canAct = actions.length > 0;
  const timeLeft = job.state === 1 ? job.deadline - now : job.state === 2 ? job.submittedAt + reviewPeriod - now : 0n;
  const remaining = timeLeft > 0n ? formatDuration(timeLeft) : "Elapsed";
  return <><div className="detail-top"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> Back to briefs</button><a href={explorer(`address/${escrowAddress}`)} target="_blank" rel="noreferrer" className="explorer-link">Contract record <ExternalLink size={14}/></a></div><div className="workroom-head"><div><div className="workroom-title"><h1>{meta?.title ?? `Agreement ${job.id.slice(0, 12)}…`}</h1><StatePill state={job.state}/></div><p>{meta?.scope ?? "The deployed contract does not store a human-readable brief. This scope is unavailable in the current browser."}</p>{!meta && <p className="inline-boundary">Scope text was not found in local browser storage. Do not infer it from the on-chain commitment.</p>}</div><div className="job-amount"><strong>{job.amount.toString()}</strong><span>MockUSDT base units · test-only</span><small>Contract token: <a href={explorer(`address/${tokenAddress}`)} target="_blank" rel="noreferrer">{short(tokenAddress)} <ExternalLink size={12}/></a></small></div></div>
    <div className="role-strip"><Role address={job.client} label="Client" account={account}/><Role address={job.worker} label="Worker" account={account}/><Role address={job.arbiter} label="Arbiter" account={account}/></div>
    <div className="workroom-grid"><div className="workroom-primary"><section className="timeline-section"><div className="section-heading"><h2>Work record</h2><span>Contract events · ordered by block</span></div>{timeline.length ? <ol className="timeline">{timeline.map((event, i) => <li key={`${event.kind}-${event.block}-${i}`} className={`timeline-item ${event.kind}`}><span className="timeline-dot">{event.kind === "funded" ? <BriefcaseBusiness size={14}/> : event.kind === "evidence" ? <FileCheck2 size={14}/> : event.kind === "dispute" ? <CircleAlert size={14}/> : <Check size={14}/>}</span><div className="timeline-body"><strong>{eventTitle(event)}</strong><span>{event.kind === "evidence" ? <code>{event.hash}</code> : event.actor ? `Actor ${short(event.actor)}` : event.timedOut ? "Deadline refund" : "Recorded by escrow contract"}</span><small>Block {event.block.toString()} · {event.kind === "funded" ? `Due ${formatDate(job.deadline)}` : "BOT Chain Testnet"}</small></div></li>)}</ol> : <div className="timeline-empty"><Activity size={18}/><span>No contract events could be displayed yet.</span></div>}<div className="commitment-note"><ShieldCheck size={16}/><span>Evidence is a bytes32 commitment. The contract does not receive the underlying file and an anchor does not verify truth, authorship, or completion.</span></div></section>
      <section className="job-facts"><div className="fact"><span>Agreement ID</span><code>{job.id}</code><button className="icon-button tiny" title="Copy agreement ID" aria-label="Copy agreement ID" onClick={() => { void navigator.clipboard.writeText(job.id); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button></div><div className="fact"><span>Created in block</span><a href={explorer(`block/${job.blockNumber}`)} target="_blank" rel="noreferrer">{job.blockNumber.toString()} <ExternalLink size={12}/></a></div><div className="fact"><span>Review window</span><b>{(reviewPeriod / 86400n).toString()} days after evidence submitted</b></div><div className="fact"><span>Deadline</span><b>{formatDate(job.deadline)}</b></div>{job.state === 1 && <div className="fact"><span>Time to deadline</span><b className={timeLeft > 0n && timeLeft < 86_400n ? "warn-text" : ""}>{remaining}</b></div>}{job.state === 2 && <div className="fact"><span>Client review time</span><b className={timeLeft > 0n ? "" : "warn-text"}>{remaining}</b></div>}</section>
      </div><aside className="action-panel"><div className="section-heading"><h2>Next step</h2><CircleHelp size={16}/></div>{!account ? <div className="action-empty"><Wallet size={20}/><strong>Connect to see your actions</strong><span>Anyone can inspect this record. Only the contract’s client, worker, and arbiter can write.</span></div> : !isParticipant(job, account) ? <div className="action-empty"><ShieldCheck size={20}/><strong>Read-only view</strong><span>This connected address is not assigned to this agreement.</span></div> : !canAct ? <div className="action-empty"><Check size={20}/><strong>No action available now</strong><span>Action eligibility follows your assigned role, the contract state, and deadline/review timing.</span></div> : <div className="action-list">{actions.map((action) => <div className="action-item" key={action}><div className="action-description"><strong>{actionName(action)}</strong><span>{actionDescription(action)}</span></div>{action === "submit" && <EvidenceInput value={evidenceHash} setValue={setEvidenceHash} fileName={fileName} onFile={onFile}/ >}{action === "resolve" && <fieldset className="resolution-options"><legend>Resolve escrow by</legend><label><input type="radio" name="resolve" checked={resolution === "release"} onChange={() => setResolution("release")}/> Release to worker</label><label><input type="radio" name="resolve" checked={resolution === "refund"} onChange={() => setResolution("refund")}/> Refund to client</label></fieldset>}<button className={action === "dispute" || action === "resolve" ? "secondary-button caution" : "primary-button"} disabled={busy || (action === "submit" && !/^0x[0-9a-fA-F]{64}$/.test(evidenceHash)) || (action === "resolve" && !resolution)} onClick={() => onAction(action, action === "resolve" ? resolution === "release" : undefined)}>{busy ? "Waiting…" : action === "resolve" ? resolution ? `Confirm ${resolution === "release" ? "release" : "refund"}` : "Choose an outcome" : actionName(action)}</button></div>)}</div>}{account && <div className="action-disclaimer">Each action is simulated against the current chain before your wallet is asked to approve it. You can reject any prompt.</div>}</aside></div>
    <BriefExchange job={job} meta={meta} account={account} onImport={onMetaImported}/><div className="proof-links"><span>On-chain record</span><a href={explorer(`tx/${job.transactionHash}`)} target="_blank" rel="noreferrer">Funding transaction <ExternalLink size={13}/></a><a href={explorer(`address/${escrowAddress}`)} target="_blank" rel="noreferrer">Verified contract source <ExternalLink size={13}/></a><span className="local-only-chip">Title/scope: {meta ? meta.source === "imported" ? "shared, unverified text" : "this browser only" : "not available"}</span></div></>;
}
function EvidenceInput({ value, setValue, fileName, onFile }: { value: string; setValue: (s: string) => void; fileName: string; onFile: (file?: File) => void }) { return <div className="evidence-field"><label>Evidence commitment (bytes32)<input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x + 64 hex characters" spellCheck={false}/></label><label className="file-input">Choose file to hash<input type="file" onChange={(e) => onFile(e.target.files?.[0])}/></label>{fileName && <small>Locally hashed: {fileName}</small>}<small>Only SHA-256 is submitted. File remains in your browser; other participants need a separate way to obtain it.</small></div>; }
function Role({ address, label, account }: { address: string; label: string; account?: string }) { const own = address.toLowerCase() === account?.toLowerCase(); return <div className={own ? "role-item own" : "role-item"}><span>{label}{own && <small>YOU</small>}</span><a href={explorer(`address/${address}`)} target="_blank" rel="noreferrer">{short(address)} <ExternalLink size={12}/></a></div>; }

function BriefExchange({ job, meta, account, onImport }: { job: GuildJob; meta: JobMeta | null; account?: string; onImport: (meta: JobMeta) => void }) {
  const [message, setMessage] = useState("");
  const canShare = Boolean(account && isParticipant(job, account));
  function download() {
    if (!meta) return;
    const bundle = { format: "guild-brief-v1", chainId: 968, contract: escrowAddress, jobId: job.id, client: job.client, worker: job.worker, arbiter: job.arbiter, amount: job.amount.toString(), deadline: job.deadline.toString(), title: meta.title, scope: meta.scope };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `guild-${job.id.slice(2, 10)}-brief.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function importFile(file?: File) {
    if (!file || !account) return;
    if (file.size > 16_000) { setMessage("Brief file is too large."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") throw new Error("Not a Guild brief file.");
      const data = parsed as Record<string, unknown>;
      const matches = data.format === "guild-brief-v1" && data.chainId === 968 && typeof data.contract === "string" && data.contract.toLowerCase() === escrowAddress.toLowerCase() && typeof data.jobId === "string" && data.jobId.toLowerCase() === job.id.toLowerCase() && data.client === job.client && data.worker === job.worker && data.arbiter === job.arbiter && data.amount === job.amount.toString() && data.deadline === job.deadline.toString();
      if (!matches) throw new Error("This brief file does not match this chain, contract, or agreement roles and terms.");
      if (typeof data.title !== "string" || data.title.length < 1 || data.title.length > 90 || typeof data.scope !== "string" || data.scope.length > 3000) throw new Error("Brief title or scope is invalid.");
      onImport({ title: data.title, scope: data.scope, createdAt: Date.now(), source: "imported" }); setMessage("Text imported locally. Title and scope are not authenticated by the contract.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read the brief file."); }
  }
  if (!canShare) return null;
  return <section className="brief-exchange"><div><strong>Brief text sharing</strong><span>The contract has no title/scope fields. Export this JSON to share it out-of-band, then the other participant can import it. Imported text is editable and not contract-authenticated.</span></div>{meta ? <button className="secondary-button" onClick={download}>Export brief file</button> : <label className="secondary-button import-button">Import brief file<input type="file" accept="application/json,.json" onChange={(e) => void importFile(e.target.files?.[0])}/></label>}{message && <small role="status">{message}</small>}</section>;
}

function eventTitle(event: TimelineEvent) { return ({ funded: "Escrow funded", evidence: "Evidence hash submitted", dispute: "Dispute opened", released: "Funds released", refunded: "Funds refunded" } as const)[event.kind]; }
function actionName(action: "submit" | "approve" | "dispute" | "refund" | "claim" | "resolve") { return ({ submit: "Submit evidence", approve: "Approve & release", dispute: "Open a dispute", refund: "Refund client", claim: "Claim after review", resolve: "Resolve dispute" } as const)[action]; }
function actionDescription(action: "submit" | "approve" | "dispute" | "refund" | "claim" | "resolve") { return ({ submit: "Commit a SHA-256 file hash. No file upload or content validation occurs.", approve: "Release escrowed test tokens to the assigned worker.", dispute: "Freeze normal release and send the case to the assigned arbiter.", refund: "Return funds to the client after the unsubmitted-work deadline.", claim: "Worker release becomes available after the full client review period.", resolve: "Choose whether funds go to the worker or return to the client." } as const)[action]; }
function formatDate(timestamp: bigint) { return new Date(Number(timestamp) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function formatDuration(seconds: bigint) { const days = seconds / 86400n; const hours = (seconds % 86400n) / 3600n; return days ? `${days}d ${hours}h` : `${hours}h ${((seconds % 3600n) / 60n)}m`; }
function parseAddress(raw: string): Address { if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error("Enter a valid 20-byte EVM address."); return raw as Address; }
function errorMessage(error: unknown): string { if (error instanceof Error) { const msg = error.shortMessage || error.message; if (/user rejected|user denied/i.test(msg)) return "Wallet request rejected."; return msg.length > 230 ? `${msg.slice(0, 227)}…` : msg; } return "The request failed. Retry the read or inspect the contract record."; }
function readRoute(): { tab: Tab; jobId: string | null } { const [route, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?"); const parts = route.split("/"); const params = new URLSearchParams(query); const tab = ["discover", "work", "escrow"].includes(parts[0]) ? parts[0] as Tab : (params.get("tab") as Tab) || "discover"; return { tab, jobId: parts[0] === "job" && parts[1] ? parts[1] : null }; }
function updateRoute(tab: Tab, jobId: string | null) { const next = jobId ? `#/job/${jobId}?tab=${tab}` : `#/${tab}`; if (window.location.hash !== next) window.history.pushState(null, "", next); }
