/**
 * Treasury.approveEscalated test suite
 *
 * Tests the human-approval path for escalated transactions.
 * WDK's wallet account is mocked via dependency injection so no live RPC
 * connection is needed — tests stay fast and deterministic.
 *
 * Run with: node --test --no-warnings tests/treasury.test.js
 */

'use strict'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AuditLogger } from '../src/audit/logger.js'
import { Treasury } from '../src/wallet/treasury.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADDR = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01'
const SEED = 'test test test test test test test test test test test junk'
const POLICY = {
  autoApproveLimit: 100n,
  dailyLimit: 10000n,
  maxTxPerHour: 10
}

/**
 * Build a Treasury backed by an in-memory SQLite logger.
 * The WDK manager is replaced with a lightweight mock to avoid live RPC calls.
 */
function makeTreasury (transferResult = '0xdeadbeef') {
  const treasury = new Treasury({
    seed: SEED,
    rpcUrl: 'http://localhost:9999',   // never actually called
    policy: POLICY,
    dbPath: ':memory:'
  })

  // Replace the WDK manager with a minimal mock
  const mockAccount = {
    getAddress: async () => ADDR,
    getBalance: async () => 0n,
    transfer: async () => transferResult   // returns the txHash string directly
  }
  treasury._manager = { getAccount: async () => mockAccount }
  treasury._account = null  // reset lazy-load cache

  return treasury
}

/**
 * Log an ESCALATE entry directly into a Treasury's logger and return its id.
 */
function seedEscalated (treasury, opts = {}) {
  treasury._logger.log({
    type: 'policy_decision',
    decision: 'ESCALATE',
    reason: 'Above per-tx limit',
    request: { to: opts.to ?? ADDR, value: opts.value ?? 9_000_000_000_000_000_000n },
    timestamp: Date.now()
  })
  const [entry] = treasury._logger.query({ limit: 1, type: 'policy_decision' })
  return entry.id
}

// ── approveEscalated — error paths ────────────────────────────────────────────

describe('Treasury › approveEscalated() — error paths', () => {
  it('throws when the audit id does not exist', async () => {
    const treasury = makeTreasury()
    await assert.rejects(
      () => treasury.approveEscalated(99999),
      { message: 'Audit entry 99999 not found' }
    )
    treasury.dispose()
  })

  it('throws when the entry is an APPROVE decision', async () => {
    const treasury = makeTreasury()
    treasury._logger.log({
      type: 'policy_decision',
      decision: 'APPROVE',
      reason: 'Within limits',
      request: { to: ADDR, value: 1n }
    })
    const [entry] = treasury._logger.query({ limit: 1 })
    await assert.rejects(
      () => treasury.approveEscalated(entry.id),
      /not an ESCALATE decision/
    )
    treasury.dispose()
  })

  it('throws when the entry is a REJECT decision', async () => {
    const treasury = makeTreasury()
    treasury._logger.log({
      type: 'policy_decision',
      decision: 'REJECT',
      reason: 'Blacklisted',
      request: { to: ADDR, value: 1n }
    })
    const [entry] = treasury._logger.query({ limit: 1 })
    await assert.rejects(
      () => treasury.approveEscalated(entry.id),
      /not an ESCALATE decision/
    )
    treasury.dispose()
  })
})

// ── approveEscalated — happy path ─────────────────────────────────────────────

describe('Treasury › approveEscalated() — happy path', () => {
  it('returns the txHash and approvedAuditId on success', async () => {
    const treasury = makeTreasury('0xcafebabe')
    const id = seedEscalated(treasury)

    const result = await treasury.approveEscalated(id)
    assert.equal(result.approvedAuditId, id)
    assert.ok(typeof result.txHash === 'string', 'txHash should be a string')
    treasury.dispose()
  })

  it('logs a human_approval entry after successful approval', async () => {
    const treasury = makeTreasury('0xcafecafe')
    const id = seedEscalated(treasury)

    await treasury.approveEscalated(id)

    const approvals = treasury._logger.query({ type: 'human_approval' })
    assert.equal(approvals.length, 1)
    assert.equal(approvals[0].decision, 'APPROVE')
    assert.ok(approvals[0].reason.includes(String(id)))
    treasury.dispose()
  })

  it('does not consume a policy-engine slot (approval bypasses the rule engine)', async () => {
    const treasury = makeTreasury()
    const id = seedEscalated(treasury)

    // stats before approval
    const before = treasury.auditStats()

    await treasury.approveEscalated(id)

    // policy_decision count unchanged (human_approval is a different type)
    const after = treasury.auditStats()
    assert.equal(Number(after.total), Number(before.total))
    treasury.dispose()
  })
})
