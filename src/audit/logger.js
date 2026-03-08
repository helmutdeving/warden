/**
 * Warden Audit Logger
 *
 * Persistent, append-only audit log backed by the Node.js built-in SQLite module.
 * Every policy decision and transaction execution is recorded immutably.
 */

'use strict'

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export class AuditLogger {
  /**
   * @param {string} dbPath - Path to the SQLite database file (use ':memory:' for tests).
   */
  constructor (dbPath) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this._db = new DatabaseSync(dbPath)
    this._initSchema()
  }

  _initSchema () {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   INTEGER NOT NULL,
        type        TEXT NOT NULL,
        decision    TEXT,
        reason      TEXT,
        to_address  TEXT,
        value_wei   TEXT,
        tx_hash     TEXT,
        chain_id    INTEGER,
        data        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_type ON audit_log(type);
    `)

    this._insert = this._db.prepare(`
      INSERT INTO audit_log (timestamp, type, decision, reason, to_address, value_wei, tx_hash, chain_id, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  }

  /**
   * Log any audit event.
   *
   * @param {Object} event
   * @param {string} event.type - Event type (e.g. 'policy_decision', 'tx_submitted', 'tx_confirmed')
   * @param {string} [event.decision] - 'APPROVE' | 'REJECT' | 'ESCALATE'
   * @param {string} [event.reason]
   * @param {Object} [event.request] - Transaction request
   * @param {string} [event.txHash]
   * @param {number} [event.chainId]
   * @param {number} [event.timestamp]
   */
  log (event) {
    try {
      this._insert.run(
        event.timestamp ?? Date.now(),
        event.type,
        event.decision ?? null,
        event.reason ?? null,
        event.request?.to ?? null,
        event.request?.value?.toString() ?? null,
        event.txHash ?? null,
        event.chainId ?? null,
        event.request?.data ?? null
      )
    } catch (err) {
      // Audit log must never crash the main process
      console.error('[AuditLogger] Failed to write log entry:', err.message)
    }
  }

  /**
   * Query recent audit entries.
   *
   * @param {{ limit?: number, type?: string, since?: number }} opts
   * @returns {Object[]}
   */
  query ({ limit = 50, type, since } = {}) {
    if (type && since) {
      return this._db.prepare(
        'SELECT * FROM audit_log WHERE type = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT ?'
      ).all(type, since, limit)
    } else if (type) {
      return this._db.prepare(
        'SELECT * FROM audit_log WHERE type = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(type, limit)
    } else if (since) {
      return this._db.prepare(
        'SELECT * FROM audit_log WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?'
      ).all(since, limit)
    }
    return this._db.prepare(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
    ).all(limit)
  }

  /**
   * Retrieve a single audit entry by its primary-key ID.
   *
   * @param {number} id
   * @returns {Object|undefined}
   */
  getById (id) {
    return this._db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id)
  }

  /**
   * Returns aggregate statistics across all decisions.
   *
   * @returns {{ total: number, approved: number, rejected: number, escalated: number }}
   */
  stats () {
    return this._db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision='APPROVE' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN decision='REJECT'  THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN decision='ESCALATE' THEN 1 ELSE 0 END) as escalated
      FROM audit_log WHERE type='policy_decision'
    `).get()
  }

  close () {
    this._db.close()
  }
}
