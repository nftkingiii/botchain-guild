# Guild

Guild's escrow contract supports milestone-based work agreements, evidence, review, dispute, and refund paths. The paired `MockUSDT` is an unrestricted-mint test token and must not be used as a production asset.

Testnet deployment and explorer proof for both contracts: [BOTCHAIN_TESTNET.md](BOTCHAIN_TESTNET.md).

This repository publishes the contract layer only. No public web app URL, completed escrow user flow, or mainnet deployment is claimed.

## Guild web app

The public-read workspace runs against the verified Testnet contracts listed in `BOTCHAIN_TESTNET.md`. It discovers funded agreements from `JobFunded` events and derives actions only from the assigned client/worker/arbiter role and current contract state. The contract records agreement IDs, role addresses, token base units, deadline/review time, state, and an evidence hash; it does not record human-readable scope or the evidence file. Brief title/scope is stored locally and can be shared using an out-of-band JSON file, whose text is not authenticated by the contract.

The paired `MockUSDT` is test-only and has unrestricted minting. Its deployed interface does not expose `decimals()` or `symbol()`, so the app uses raw integer base units without USDT formatting. Never treat it as a production asset.

### Local run and Railway

Use Node 22 or 24 and npm 11.6.2. Copy `.env.example` to `.env.local` for Vite overrides if needed. Install and build with `npm ci` and `npm run build`; run locally with `npm run dev`. The production service uses `npm start`, binds `0.0.0.0:$PORT`, serves the built SPA with deep-link fallback, and exposes `/healthz` with the revision.

Railway commands: install `npm ci`, build `npm run build`, start `npm start`. Configure `PORT` (Railway supplies it), `REVISION` (optional), and the `VITE_BOTCHAIN_CHAIN_ID`, `VITE_BOTCHAIN_RPC_URL`, `VITE_GUILD_ESCROW_ADDRESS`, `VITE_GUILD_TOKEN_ADDRESS`, and `VITE_GUILD_DEPLOYMENT_BLOCK` build-time values. The current `.env.example` values are the verified Testnet endpoints, contract addresses, and escrow deployment block. No deployment or mainnet support is implied.

To check the app: `npm test`, `npm run typecheck`, `npm run build`. Contract checks remain `forge build` and `forge test` from this repository root.

```sh
forge build
forge test
```
