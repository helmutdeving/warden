/**
 * AuditLogger test suite
 *
 * Tests the persistent, append-only audit log backed by node:sqlite.
 * Uses ':memory:' database for isolation — each test suite gets a fresh instance.
 * Run with: node --test --no-warnings tests/audit.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AuditLogger } from '../src/audit/logger.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh in-memory AuditLogger for each test. */
function makeLogger () {
  return new AuditLogger(':memory:')
}

const ADDR = '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF'

// ── Basic logging ─────────────────────────────────────────────────────────────

describe('AuditLogger › log()', () => {
  it('writes a policy_decision entry and reads it back', () => {
    const logger = makeLogger()
    logger.log({
      type: 'policy_decision',
      decision: 'APPROVE',
      reason: 'Within all policy limits',
      request: { to: ADDR, value: 100n },
      timestamp: 1_000_000
    })
    const entries = logger.query()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].type, 'policy_decision')
    assert.equal(entries[0].decision, 'APPROVE')
    assert.equal(entries[0].reason, 'Within all policy limits')
    assert.equal(entries[0].to_address, ADDR)
    assert.equal(entries[0].value_wei, '100')
    assert.equal(entries[0].timestamp, 1_000_000)
    logger.close()
  })

  it('writes a tx_submitted entry with a txHash', () => {
    const logger = makeLogger()
    logger.log({
      type: 'tx_submitted',
      txHash: '0xdeadbeef',
      request: { to: ADDR, value: 500n },
      timestamp: 2_000_000
    })
    const entries = logger.query()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].tx_hash, '0xdeadbeef')
    logger.close()
  })

  it('stores optional fields as null when absent', () => {
    const logger = makeLogger()
    logger.log({ type: 'tx_error', reason: 'out of gas' })
    const entries = logger.query()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].decision, null)
    assert.equal(entries[0].to_address, null)
    assert.equal(entries[0].tx_hash, null)
    logger.close()
  })

  it('stores calldata when request.data is provided', () => {
    const logger = makeLogger()
    logger.log({
      type: 'policy_decision',
      decision: 'APPROVE',
      request: { to: ADDR, value: 1n, data: '0xabcdef' }
    })
    const entries = logger.query()
    assert.equal(entries[0].data, '0xabcdef')
    logger.close()
  })

  it('does not throw on a malformed event (resilience)', () => {
    const logger = makeLogger()
    // Simulate a broken caller passing invalid data — the logger must not crash
    assert.doesNotThrow(() => logger.log({ type: 'unknown_event' }))
    logger.close()
  })

  it('serialises bigint value_wei as a string', () => {
    const logger = makeLogger()
    const bigValue = 10n ** 18n  // 1 ETH
    logger.log({ type: 'policy_decision', decision: 'APPROVE', request: { to: ADDR, value: bigValue } })
    const entries = logger.query()
    assert.equal(entries[0].value_wei, bigValue.toString())
    logger.close()
  })
})

// ── Multiple entries ───────────────────────────────────────────────────────────

describe('AuditLogger › multiple entries', () => {
  it('stores and retrieves multiple entries in descending timestamp order', () => {
    const logger = makeLogger()
    const events = [
      { type: 'policy_decision', decision: 'APPROVE', timestamp: 1000 },
      { type: 'policy_decision', decision: 'REJECT',  timestamp: 2000 },
      { type: 'tx_submitted',    txHash: '0xabc',     timestamp: 3000 }
    ]
    events.forEach(e => logger.log(e))
    const entries = logger.query()
    assert.equal(entries.length, 3)
    // Descending order by timestamp
    assert.ok(entries[0].timestamp >= entries[1].timestamp)
    assert.ok(entries[1].timestamp >= entries[2].timestamp)
    logger.close()
  })
})

// ── Querying by type ──────────────────────────────────────────────────────────

describe('AuditLogger › query({ type })', () => {
  it('filters entries by type', () => {
    const logger = makeLogger()
    logger.log({ type: 'policy_decision', decision: 'APPROVE', timestamp: 1000 })
    logger.log({ type: 'tx_submitted',    txHash: '0x1',       timestamp: 2000 })
    logger.log({ type: 'policy_decision', decision: 'REJECT',  timestamp: 3000 })

    const decisions = logger.query({ type: 'policy_decision' })
    assert.equal(decisions.length, 2)
    decisions.forEach(e => assert.equal(e.type, 'policy_decision'))

    const txs = logger.query({ type: 'tx_submitted' })
    assert.equal(txs.length, 1)
    assert.equal(txs[0].tx_hash, '0x1')
    logger.close()
  })

  it('returns empty array when type has no entries', () => {
    const logger = makeLogger()
    logger.log({ type: 'policy_decision', decision: 'APPROVE' })
    const result = logger.query({ type: 'tx_submitted' })
    assert.equal(result.length, 0)
    logger.close()
  })
})

// ── Querying by since ──────────────────────────────────────────────────────────

describe('AuditLogger › query({ since })', () => {
  it('returns only entries after the given timestamp', () => {
    const logger = makeLogger()
    logger.log({ type: 'ev', timestamp: 1000 })
    logger.log({ type: 'ev', timestamp: 2000 })
    logger.log({ type: 'ev', timestamp: 3000 })

    const result = logger.query({ since: 1500 })
    assert.equal(result.length, 2)
    result.forEach(e => assert.ok(e.timestamp > 1500))
    logger.close()
  })

  it('combining type + since filters by both', () => {
    const logger = makeLogger()
    logger.log({ type: 'policy_decision', decision: 'APPROVE', timestamp: 1000 })
    logger.log({ type: 'tx_submitted',                         timestamp: 2000 })
    logger.log({ type: 'policy_decision', decision: 'REJECT',  timestamp: 3000 })

    const result = logger.query({ type: 'policy_decision', since: 1500 })
    assert.equal(result.length, 1)
    assert.equal(result[0].decision, 'REJECT')
    logger.close()
  })
})

// ── Query limit ────────────────────────────────────────────────────────────────

describe('AuditLogger › query({ limit })', () => {
  it('respects the limit parameter', () => {
    const logger = makeLogger()
    for (let i = 0; i < 10; i++) {
      logger.log({ type: 'ev', timestamp: i * 1000 })
    }
    const result = logger.query({ limit: 3 })
    assert.equal(result.length, 3)
    logger.close()
  })

  it('defaults to limit 50 when not specified', () => {
    const logger = makeLogger()
    for (let i = 0; i < 60; i++) {
      logger.log({ type: 'ev', timestamp: i * 1000 })
    }
    const result = logger.query()
    assert.equal(result.length, 50)
    logger.close()
  })
})

// ── stats() ───────────────────────────────────────────────────────────────────

describe('AuditLogger › stats()', () => {
  it('returns zero counts on an empty log', () => {
    const logger = makeLogger()
    const s = logger.stats()
    assert.equal(Number(s.total), 0)
    assert.equal(Number(s.approved), 0)
    assert.equal(Number(s.rejected), 0)
    assert.equal(Number(s.escalated), 0)
    logger.close()
  })

  it('counts decisions correctly across all verdict types', () => {
    const logger = makeLogger()
    const decisions = ['APPROVE', 'APPROVE', 'APPROVE', 'REJECT', 'REJECT', 'ESCALATE']
    decisions.forEach(d => logger.log({ type: 'policy_decision', decision: d }))
    // Add a non-decision event — should not count in stats
    logger.log({ type: 'tx_submitted', txHash: '0x1' })

    const s = logger.stats()
    assert.equal(Number(s.total), 6)
    assert.equal(Number(s.approved), 3)
    assert.equal(Number(s.rejected), 2)
    assert.equal(Number(s.escalated), 1)
    logger.close()
  })

  it('only counts policy_decision events, not other event types', () => {
    const logger = makeLogger()
    logger.log({ type: 'tx_submitted', txHash: '0xabc' })
    logger.log({ type: 'tx_error',    reason: 'failed' })
    const s = logger.stats()
    assert.equal(Number(s.total), 0)
    logger.close()
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('AuditLogger › close()', () => {
  it('closes without error', () => {
    const logger = makeLogger()
    assert.doesNotThrow(() => logger.close())
  })
})

// ── getById ───────────────────────────────────────────────────────────────────

describe('AuditLogger › getById()', () => {
  it('retrieves a logged entry by its id', () => {
    const logger = makeLogger()
    logger.log({
      type: 'policy_decision',
      decision: 'ESCALATE',
      reason: 'Above per-tx limit',
      request: { to: ADDR, value: 9_000_000_000_000_000_000n }
    })
    const all = logger.query({ limit: 1 })
    assert.equal(all.length, 1)
    const entry = logger.getById(all[0].id)
    assert.ok(entry, 'entry should exist')
    assert.equal(entry.decision, 'ESCALATE')
    assert.equal(entry.to_address, ADDR)
    logger.close()
  })

  it('returns undefined for a non-existent id', () => {
    const logger = makeLogger()
    const entry = logger.getById(99999)
    assert.equal(entry, undefined)
    logger.close()
  })
})
