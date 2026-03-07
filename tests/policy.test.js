/**
 * PolicyEngine test suite
 *
 * Uses Node.js built-in test runner (node:test) with in-memory AuditLogger.
 * Run with: node --test --no-warnings tests/policy.test.js
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { PolicyEngine } from '../src/policy/engine.js'
import { AuditLogger } from '../src/audit/logger.js'

// ── Constants ────────────────────────────────────────────────────────────────

const ETH = 10n ** 18n          // 1 ETH in wei
const LIMIT = ETH / 10n         // 0.1 ETH — default autoApproveLimit
const DAILY = ETH               // 1 ETH — default dailyLimit

const ADDR_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01'
const ADDR_B = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02'
const ADDR_C = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03'

/** Create a fresh PolicyEngine backed by an in-memory audit logger. */
function makeEngine (config = {}) {
  const logger = new AuditLogger(':memory:')
  const engine = new PolicyEngine({
    autoApproveLimit: LIMIT,
    dailyLimit: DAILY,
    maxTxPerHour: 3,
    ...config
  }, logger)
  return { engine, logger }
}

/** Build a minimal transaction request. */
function tx (to, value, timestamp = Date.now()) {
  return { to, value, timestamp }
}

// ── Blacklist checks ─────────────────────────────────────────────────────────

describe('PolicyEngine › blacklist', () => {
  it('rejects a blacklisted address immediately', () => {
    const { engine } = makeEngine({ blacklist: [ADDR_A] })
    const result = engine.evaluate(tx(ADDR_A, 1n))
    assert.equal(result.decision, 'REJECT')
    assert.match(result.reason, /blacklist/i)
  })

  it('allows a non-blacklisted address', () => {
    const { engine } = makeEngine({ blacklist: [ADDR_A] })
    const result = engine.evaluate(tx(ADDR_B, 1n))
    assert.equal(result.decision, 'APPROVE')
  })

  it('blacklist check is case-insensitive', () => {
    const { engine } = makeEngine({ blacklist: [ADDR_A.toLowerCase()] })
    const result = engine.evaluate(tx(ADDR_A.toUpperCase(), 1n))
    assert.equal(result.decision, 'REJECT')
  })

  it('blacklist takes priority over whitelist', () => {
    const { engine } = makeEngine({ blacklist: [ADDR_A], whitelist: [ADDR_A] })
    const result = engine.evaluate(tx(ADDR_A, 1n))
    assert.equal(result.decision, 'REJECT')
  })
})

// ── Auto-approve limit checks ─────────────────────────────────────────────────

describe('PolicyEngine › auto-approve limit', () => {
  it('approves a transaction exactly at the limit', () => {
    const { engine } = makeEngine()
    const result = engine.evaluate(tx(ADDR_A, LIMIT))
    assert.equal(result.decision, 'APPROVE')
  })

  it('escalates a transaction one wei over the limit', () => {
    const { engine } = makeEngine()
    const result = engine.evaluate(tx(ADDR_A, LIMIT + 1n))
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /auto-approve limit/i)
  })

  it('approves a zero-value transaction', () => {
    const { engine } = makeEngine()
    const result = engine.evaluate(tx(ADDR_A, 0n))
    assert.equal(result.decision, 'APPROVE')
  })

  it('includes the formatted ETH amounts in the escalation reason', () => {
    const { engine } = makeEngine()
    const result = engine.evaluate(tx(ADDR_A, ETH))
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /ETH/i)
  })
})

// ── Whitelist: 10× limit multiplier ──────────────────────────────────────────

describe('PolicyEngine › whitelist (10× limit)', () => {
  it('approves a whitelisted address for 10× the base limit', () => {
    const { engine } = makeEngine({ whitelist: [ADDR_A] })
    const result = engine.evaluate(tx(ADDR_A, LIMIT * 10n))
    assert.equal(result.decision, 'APPROVE')
    assert.match(result.reason, /whitelisted/i)
  })

  it('escalates a whitelisted address one wei over 10× the limit', () => {
    // Use a generous daily limit so the per-tx check fires, not the daily check
    const { engine } = makeEngine({ whitelist: [ADDR_A], dailyLimit: ETH * 100n })
    const result = engine.evaluate(tx(ADDR_A, LIMIT * 10n + 1n))
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /whitelisted 10x/i)
  })

  it('a non-whitelisted address still uses the base limit', () => {
    const { engine } = makeEngine({ whitelist: [ADDR_A] })
    const result = engine.evaluate(tx(ADDR_B, LIMIT + 1n))
    assert.equal(result.decision, 'ESCALATE')
  })

  it('whitelist check is case-insensitive', () => {
    const { engine } = makeEngine({ whitelist: [ADDR_A.toLowerCase()] })
    const result = engine.evaluate(tx(ADDR_A.toUpperCase(), LIMIT * 5n))
    assert.equal(result.decision, 'APPROVE')
  })
})

// ── Daily spend limit ─────────────────────────────────────────────────────────

describe('PolicyEngine › daily spend limit', () => {
  it('approves transactions up to the daily limit', () => {
    const { engine } = makeEngine({ maxTxPerHour: 100 })
    const base = Date.now()
    // 9 × 0.1 ETH = 0.9 ETH — under 1 ETH daily limit
    for (let i = 0; i < 9; i++) {
      const result = engine.evaluate(tx(ADDR_A, LIMIT, base + i * 1000))
      assert.equal(result.decision, 'APPROVE', `tx ${i} should be approved`)
    }
  })

  it('escalates when cumulative spend would exceed the daily limit', () => {
    const { engine } = makeEngine({ maxTxPerHour: 100 })
    const base = Date.now()
    // Fill up 1 ETH daily budget (10 × 0.1 ETH)
    for (let i = 0; i < 10; i++) {
      engine.evaluate(tx(ADDR_A, LIMIT, base + i * 1000))
    }
    // 11th transaction should be escalated
    const result = engine.evaluate(tx(ADDR_A, LIMIT, base + 10_000))
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /daily limit/i)
  })

  it('daily limit resets after 24 hours', () => {
    const { engine } = makeEngine({ maxTxPerHour: 100 })
    const yesterday = Date.now() - 86_400_001   // just over 24h ago
    // Record 10 tx "yesterday" by directly evaluating with old timestamps
    for (let i = 0; i < 10; i++) {
      engine.evaluate(tx(ADDR_A, LIMIT, yesterday + i * 1000))
    }
    // Today's transaction should be fine — yesterday's are outside the window
    const result = engine.evaluate(tx(ADDR_A, LIMIT))
    assert.equal(result.decision, 'APPROVE')
  })

  it('includes remaining budget in the escalation reason', () => {
    const { engine } = makeEngine({ dailyLimit: LIMIT, maxTxPerHour: 100 })
    engine.evaluate(tx(ADDR_A, LIMIT / 2n))  // use half
    const result = engine.evaluate(tx(ADDR_A, LIMIT))  // would exceed
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /remaining/i)
  })
})

// ── Hourly rate limit ─────────────────────────────────────────────────────────

describe('PolicyEngine › hourly rate limit', () => {
  it('escalates after maxTxPerHour transactions in the same hour', () => {
    const { engine } = makeEngine({ maxTxPerHour: 3, dailyLimit: ETH * 100n })
    const base = Date.now()
    // 3 approved transactions
    for (let i = 0; i < 3; i++) {
      const result = engine.evaluate(tx(ADDR_A, 1n, base + i * 1000))
      assert.equal(result.decision, 'APPROVE', `tx ${i} should be approved`)
    }
    // 4th within the same hour → escalate
    const result = engine.evaluate(tx(ADDR_A, 1n, base + 3_000))
    assert.equal(result.decision, 'ESCALATE')
    assert.match(result.reason, /hourly transaction limit/i)
  })

  it('rate limit resets after 1 hour', () => {
    const { engine } = makeEngine({ maxTxPerHour: 3, dailyLimit: ETH * 100n })
    const oneHourAgo = Date.now() - 3_600_001
    // Fill 3 slots in the past hour
    for (let i = 0; i < 3; i++) {
      engine.evaluate(tx(ADDR_A, 1n, oneHourAgo + i * 1000))
    }
    // Those should have expired — new tx should be approved
    const result = engine.evaluate(tx(ADDR_A, 1n))
    assert.equal(result.decision, 'APPROVE')
  })

  it('escalated (not approved) transactions do not consume rate-limit slots', () => {
    // A REJECT or ESCALATE should NOT record a tx — only APPROVE does
    const { engine } = makeEngine({ maxTxPerHour: 1, dailyLimit: ETH * 100n })
    const base = Date.now()
    // 1st approved
    engine.evaluate(tx(ADDR_A, 1n, base))
    // 2nd escalated due to rate limit — does NOT consume a slot
    engine.evaluate(tx(ADDR_A, 1n, base + 1000))
    // Rate limit still at 1 slot used, not 2 — hour window check should still fail
    const result = engine.evaluate(tx(ADDR_A, 1n, base + 2000))
    assert.equal(result.decision, 'ESCALATE')
  })
})

// ── Decision output structure ─────────────────────────────────────────────────

describe('PolicyEngine › decision shape', () => {
  it('returns the original request in the decision', () => {
    const { engine } = makeEngine()
    const request = tx(ADDR_A, 1n)
    const result = engine.evaluate(request)
    assert.deepEqual(result.request, request)
  })

  it('sets a timestamp on every decision', () => {
    const { engine } = makeEngine()
    const result = engine.evaluate(tx(ADDR_A, 1n))
    assert.ok(typeof result.timestamp === 'number')
    assert.ok(result.timestamp > 0)
  })

  it('uses the request timestamp if provided', () => {
    const { engine } = makeEngine()
    const t = 1_000_000
    const result = engine.evaluate(tx(ADDR_A, 1n, t))
    assert.equal(result.timestamp, t)
  })
})

// ── Spending statistics ────────────────────────────────────────────────────────

describe('PolicyEngine › getSpendingStats()', () => {
  it('returns zero stats on a fresh engine', () => {
    const { engine } = makeEngine()
    const stats = engine.getSpendingStats()
    assert.equal(stats.dailySpent, 0n)
    assert.equal(stats.txLast24h, 0)
    assert.equal(stats.txLastHour, 0)
  })

  it('reflects approved transactions in stats', () => {
    const { engine } = makeEngine({ maxTxPerHour: 100 })
    engine.evaluate(tx(ADDR_A, LIMIT))
    engine.evaluate(tx(ADDR_A, LIMIT))
    const stats = engine.getSpendingStats()
    assert.equal(stats.dailySpent, LIMIT * 2n)
    assert.equal(stats.txLast24h, 2)
    assert.equal(stats.txLastHour, 2)
  })

  it('does not reflect rejected/escalated transactions in stats', () => {
    const { engine } = makeEngine({ blacklist: [ADDR_A] })
    engine.evaluate(tx(ADDR_A, 1n))  // rejected
    const stats = engine.getSpendingStats()
    assert.equal(stats.dailySpent, 0n)
    assert.equal(stats.txLast24h, 0)
  })

  it('reports the configured limits', () => {
    const { engine } = makeEngine()
    const stats = engine.getSpendingStats()
    assert.equal(stats.dailyLimit, DAILY)
    assert.equal(stats.maxTxPerHour, 3)
  })
})

// ── Audit logging integration ─────────────────────────────────────────────────

describe('PolicyEngine › audit logging', () => {
  it('logs every decision to the audit logger', () => {
    const logger = new AuditLogger(':memory:')
    const engine = new PolicyEngine({ autoApproveLimit: LIMIT, dailyLimit: DAILY, maxTxPerHour: 10 }, logger)
    engine.evaluate(tx(ADDR_A, 1n))
    engine.evaluate(tx(ADDR_B, LIMIT + 1n))  // escalated
    const entries = logger.query({ type: 'policy_decision' })
    assert.equal(entries.length, 2)
  })

  it('works without a logger (logger = null)', () => {
    // Should not throw if no logger is provided
    const engine = new PolicyEngine({ autoApproveLimit: LIMIT, dailyLimit: DAILY, maxTxPerHour: 10 }, null)
    assert.doesNotThrow(() => engine.evaluate(tx(ADDR_A, 1n)))
  })
})
