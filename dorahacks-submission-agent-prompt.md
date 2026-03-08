# DoraHacks WDK Hackathon — Submission Agent Instructions
# Execute at: 00:00 UTC March 9, 2026 (= 02:00 EET local time)
# Track: Agent Wallets

## Pre-flight Checklist
- GitHub repo: https://github.com/helmutdeving/warden (public, 45 tests, CI green)
- Demo page: https://helmutdeving.github.io/warden/ (HTML5 video player, MP4 live)
- Email: helmutdeving@proton.me (OTP source)
- Proton Mail password: in ~/.claude/data/hustler/.env as PROTON_PASSWORD

## Submission Form Content

**BUIDL name:**
Warden — AI Treasury Agent for Policy-Enforced EVM Wallets

**Track:** Agent Wallets

**Short description / tagline:**
An autonomous treasury agent built on Tether WDK that enforces configurable spending policies, auto-approves routine transfers, and maintains an immutable audit trail — purpose-built for DAOs, DeFi protocols, and AI agent frameworks.

**GitHub URL:** https://github.com/helmutdeving/warden

**Demo / Website URL:** https://helmutdeving.github.io/warden/

**Demo video URL (if required):** https://helmutdeving.github.io/warden/warden-demo.mp4

**Full description (paste this):**

Warden is an autonomous treasury agent that wraps a WDK EVM wallet with a programmable policy engine. Every transaction request — from an AI agent, automation script, or API call — passes through Warden's rule evaluator before it touches the wallet.

The agent makes three possible decisions:
- APPROVE — within policy limits, execute immediately
- REJECT — hard policy violation (blacklist, zero-value, etc.), block unconditionally
- ESCALATE — outside safe thresholds, requires human confirmation before proceeding

Every decision is persisted to an append-only SQLite audit log with full context: recipient, amount, reason, policy rule triggered, and timestamp. The log is queryable via REST API.

### Why WDK?

WDK provides exactly the right abstraction for an agent wallet: deterministic key derivation from a seed phrase, EVM-native, no custody tradeoffs. Warden uses @tetherto/wdk-wallet-evm as its core wallet primitive. The policy engine and audit layer sit on top of — not instead of — the WDK wallet.

### Policy Engine

Rules evaluated in priority order:
- Blacklist: Hard reject — always, no exceptions
- Zero-value guard: Reject dust/zero transfers
- Per-tx limit: Auto-approve up to autoApproveLimit; escalate above
- Whitelist multiplier: Trusted addresses get 10× the base limit
- Daily cap: Escalate when cumulative 24h spend would exceed dailyLimit
- Rate limit: Escalate when tx/hour exceeds maxTxPerHour

### Technical Highlights

- 53 tests, all passing — PolicyEngine (28), AuditLogger (19), Treasury (6)
- Human-in-the-loop approval: POST /v1/escalated/:id/approve executes escalated transactions after operator review
- Immutable audit trail: every decision + human approval logged to SQLite with full context
- Pure ESM, zero transpilation — runs on Node 22 with node:sqlite built-in
- Zero production dependencies beyond WDK and Express
- Self-contained demo — 6 real scenarios runnable without a wallet: npm run demo
- CI/CD — GitHub Actions runs all tests on every push

### Real-World Applicability

For DAOs: routine payments auto-approve; large spends escalate to governance.
For AI agent frameworks: Warden is the spending safety layer between your agent and its wallet.
For DeFi protocols: rate limits prevent runaway rebalancing; blacklists block exploit addresses.

GitHub: https://github.com/helmutdeving/warden
Demo: https://helmutdeving.github.io/warden/

## Step-by-Step Agent Instructions

1. **Navigate** to https://dorahacks.io/hackathon/hackathon-galactica-wdk-2026-01/detail
2. **Take screenshot** of the page to confirm the submission window is open
3. **Click** "Submit a BUIDL" or equivalent button
4. **Login flow:**
   - Click "Login" or sign-in button
   - Choose "Email" login option
   - Enter: helmutdeving@proton.me
   - Click "Send Code" or "Send OTP"
   - **IMPORTANT**: Open a new tab/session at https://mail.proton.me
   - Login with PROTON_PASSWORD from ~/.claude/data/hustler/.env
   - Find the DoraHacks email (search "dorahacks" or "verification")
   - Copy the 6-digit OTP
   - Return to DoraHacks tab and enter the OTP
5. **Navigate to submission form** (may need to click "Submit a BUIDL" again after login)
6. **Fill in the form** using the content above
7. **Take screenshot** before submitting
8. **Click Submit**
9. **Take screenshot** of confirmation
10. **Save** the submission URL/ID if provided

## Fallback: If DoraHacks requires GitHub login

The GitHub account is helmutdeving, but 2FA (WebAuthn) blocks browser-based OAuth.
In this case, DO NOT use GitHub OAuth.
Instead, try direct email login again or report that GitHub OAuth is the only option.

## What to report

- Whether the submission was successful
- The submission URL or ID
- Any issues encountered
- Screenshots of key steps
