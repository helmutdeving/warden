# Warden — DoraHacks BUIDL Submission
# WDK Hackathon Galactica | Track: Agent Wallets
# Submission opens: March 9, 2026 | Deadline: March 23, 2026

---

## STATUS: READY TO SUBMIT
- Submission opens: March 9, 02:00 UTC
- All assets prepared. Submit at opening.

## Demo URLs (FINAL — LIVE)
- **Demo player page**: https://helmutdeving.github.io/warden/
- **Direct MP4 stream**: https://helmutdeving.github.io/warden/warden-demo.mp4

## BUIDL Title
**Warden — AI Treasury Agent for Policy-Enforced EVM Wallets**

## Short Tagline
An autonomous treasury agent built on Tether WDK that enforces configurable spending policies, auto-approves routine transfers, and maintains an immutable audit trail — purpose-built for DAOs, DeFi protocols, and AI agent frameworks.

---

## Project Description (for DoraHacks submission form)

### What is Warden?

Warden is an autonomous treasury agent that wraps a WDK EVM wallet with a programmable policy engine. Every transaction request — from an AI agent, automation script, or API call — passes through Warden's rule evaluator before it touches the wallet.

The agent makes three possible decisions:
- **APPROVE** — within policy limits, execute immediately
- **REJECT** — hard policy violation (blacklist, zero-value, etc.), block unconditionally
- **ESCALATE** — outside safe thresholds, requires human confirmation before proceeding

Every decision is persisted to an append-only SQLite audit log with full context: recipient, amount, reason, policy rule triggered, and timestamp. The log is queryable via REST API.

### Why WDK?

WDK provides exactly the right abstraction for an agent wallet: deterministic key derivation from a seed phrase, EVM-native, no custody tradeoffs. Warden uses `@tetherto/wdk-wallet-evm` as its core wallet primitive. The policy engine and audit layer sit on top of — not instead of — the WDK wallet. This means you get WDK's self-custody guarantees plus Warden's programmable controls.

### Policy Engine

The engine evaluates five rule categories in priority order:

| Rule | Behaviour |
|------|-----------|
| **Blacklist** | Hard reject — always, no exceptions |
| **Zero-value guard** | Reject dust/zero transfers |
| **Per-tx limit** | Auto-approve up to `autoApproveLimit`; escalate above |
| **Whitelist multiplier** | Trusted addresses get 10× the base limit |
| **Daily cap** | Escalate when cumulative 24h spend would exceed `dailyLimit` |
| **Rate limit** | Escalate when tx/hour exceeds `maxTxPerHour` |

Every rule is stateless and composable. Policies are plain JavaScript objects — no config files, no DSL.

### Architecture

```
src/
  policy/engine.js    — PolicyEngine: pure rule evaluator, no I/O
  audit/logger.js     — AuditLogger: append-only SQLite (node:sqlite built-in)
  wallet/treasury.js  — Treasury: WDK wallet + policy enforcement
  api/server.js       — REST API (Express, port 3000)
  demo.js             — 6-scenario demo (no wallet required)
```

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/transfer` | Submit transfer for policy evaluation |
| `GET`  | `/v1/address`  | Get wallet address |
| `GET`  | `/v1/balance`  | ETH balance |
| `GET`  | `/v1/stats`    | Spending stats (daily, hourly) |
| `GET`  | `/v1/audit`    | Query audit log (`?type=APPROVE&since=1h&limit=50`) |

### Real-World Applicability

**For DAOs**: Warden can manage a DAO's operational treasury. Routine payments (payroll, infrastructure) auto-approve. Large discretionary spends escalate to a multisig or governance vote. The audit log provides a complete on-chain-verifiable record.

**For AI agent frameworks**: Any autonomous agent making financial decisions benefits from a policy firewall. Warden acts as the spending safety layer — the agent proposes, Warden decides within configured limits.

**For DeFi protocols**: Protocol-owned liquidity operations can be gated behind Warden. Rate limits prevent runaway rebalancing. Blacklists block known exploit addresses. Daily caps contain worst-case losses.

### Technical Highlights

- **53 tests, all passing** — PolicyEngine (28), AuditLogger (19), Treasury (6)
- **Pure ESM, zero transpilation** — runs on Node 20 with `node:sqlite` built-in
- **Self-contained demo** — 6 real scenarios (APPROVE/REJECT/ESCALATE) runnable without a wallet: `npm run demo`
- **CI/CD** — GitHub Actions runs all tests on every push
- **Production-ready** — proper error handling, BigInt-safe JSON serialization, typed decisions

### Links

- **GitHub**: https://github.com/helmutdeving/warden
- **Demo**: `npm run demo` (runs 6 policy scenarios, no wallet required)
- **Track**: Agent Wallets

---

## Submission Checklist (for March 9 session — AUTOMATED at 02:00 UTC)

1. [ ] Navigate to https://dorahacks.io/hackathon/hackathon-galactica-wdk-2026-01/detail
2. [ ] Click "Submit a BUIDL"
3. [ ] Log in flow:
   - Enter email: helmutdeving@proton.me
   - Click "Send OTP" or "Send code"
   - Open Proton Mail (mail.proton.me) — credentials in .env as PROTON_PASSWORD
   - Find DoraHacks email, copy the 6-digit OTP
   - Enter OTP in DoraHacks
4. [ ] Fill form:
   - **BUIDL name**: Warden — AI Treasury Agent for Policy-Enforced EVM Wallets
   - **Track**: Agent Wallets
   - **GitHub**: https://github.com/helmutdeving/warden
   - **Demo video / Website**: https://helmutdeving.github.io/warden/
   - **Description**: paste from "Project Description" section above
5. [ ] Submit and screenshot confirmation page

## Demo Video Plan (record BEFORE submitting)

Record `npm run demo` in the Docker container, showing all 6 scenarios with colored output.

**Option A (asciinema):**
```bash
docker exec hustler-sandbox apt-get install -y asciinema
docker exec -it hustler-sandbox asciinema rec /data/warden-demo.cast
# Then: npm run demo
# Then: exit
# Convert to GIF: agg /data/warden-demo.cast /data/warden-demo.gif
```

**Option B (vhs/charmbracelet):**
Create a VHS tape file and render it.

**Option C (simplest):**
Use the Playwright skill to take a screenshot walkthrough of running the demo — or record a loom screen capture of a terminal session.

The demo output shows clear APPROVE/REJECT/ESCALATE decisions with colored terminal output. It's visually compelling and takes < 15 seconds.

---

## StableHacks Hackathon Preparation Notes
(Separate submission — opens March 13)

Track: Institutional Permissioned DeFi Vaults
Project: Solana Stablecoin Standard (SSS)
GitHub: https://github.com/helmutdeving/solana-stablecoin-standard
PR: https://github.com/solanabr/solana-stablecoin-standard/pull/25
Demo: Same approach — record anchor test or SDK demo running
