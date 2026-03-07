/**
 * Warden Policy Engine
 *
 * Evaluates transaction requests against a set of configurable spending policies.
 * Returns a decision: APPROVE, REJECT, or ESCALATE (requires human review).
 */

'use strict'

/** @typedef {'APPROVE' | 'REJECT' | 'ESCALATE'} Decision */

/**
 * @typedef {Object} PolicyConfig
 * @property {bigint} autoApproveLimit - Max amount (in wei) that can be auto-approved per transaction.
 * @property {bigint} dailyLimit - Max total spend (in wei) per rolling 24h window.
 * @property {string[]} [whitelist] - Recipient addresses that bypass rate limiting (still subject to autoApproveLimit).
 * @property {string[]} [blacklist] - Recipient addresses that are always rejected.
 * @property {number} [maxTxPerHour] - Maximum transactions allowed per hour.
 */

/**
 * @typedef {Object} TransactionRequest
 * @property {string} to - Recipient address (checksummed).
 * @property {bigint} value - Amount in wei.
 * @property {string} [data] - Optional calldata (hex string).
 * @property {string} [reason] - Human-readable reason for the transaction.
 * @property {number} [timestamp] - Unix timestamp (defaults to Date.now()).
 */

/**
 * @typedef {Object} PolicyDecision
 * @property {Decision} decision - The verdict.
 * @property {string} reason - Human-readable explanation.
 * @property {TransactionRequest} request - The original request.
 * @property {number} timestamp - When the decision was made.
 */

export class PolicyEngine {
  /**
   * @param {PolicyConfig} config
   * @param {import('../audit/logger.js').AuditLogger} logger
   */
  constructor (config, logger) {
    this._config = {
      autoApproveLimit: config.autoApproveLimit ?? 10n ** 17n, // 0.1 ETH default
      dailyLimit: config.dailyLimit ?? 10n ** 18n, // 1 ETH default
      whitelist: new Set((config.whitelist ?? []).map(a => a.toLowerCase())),
      blacklist: new Set((config.blacklist ?? []).map(a => a.toLowerCase())),
      maxTxPerHour: config.maxTxPerHour ?? 10
    }
    this._logger = logger
    /** @type {Array<{timestamp: number, value: bigint}>} */
    this._recentTxs = []
  }

  /**
   * Evaluate a transaction request against all active policies.
   *
   * @param {TransactionRequest} request
   * @returns {PolicyDecision}
   */
  evaluate (request) {
    const now = request.timestamp ?? Date.now()
    const to = request.to.toLowerCase()
    const value = request.value

    // 1. Blacklist check — hard reject
    if (this._config.blacklist.has(to)) {
      return this._decide('REJECT', 'Recipient is blacklisted', request, now)
    }

    // 2. Hourly transaction rate check
    const oneHourAgo = now - 3600_000
    const recentCount = this._recentTxs.filter(tx => tx.timestamp > oneHourAgo).length
    if (recentCount >= this._config.maxTxPerHour) {
      return this._decide('ESCALATE', `Hourly transaction limit reached (${recentCount}/${this._config.maxTxPerHour})`, request, now)
    }

    // 3. Daily spend limit check
    const oneDayAgo = now - 86_400_000
    const dailySpent = this._recentTxs
      .filter(tx => tx.timestamp > oneDayAgo)
      .reduce((sum, tx) => sum + tx.value, 0n)

    if (dailySpent + value > this._config.dailyLimit) {
      const remaining = this._config.dailyLimit - dailySpent
      return this._decide(
        'ESCALATE',
        `Daily limit would be exceeded. Spent: ${this._formatWei(dailySpent)}, limit: ${this._formatWei(this._config.dailyLimit)}, remaining: ${this._formatWei(remaining)}`,
        request,
        now
      )
    }

    // 4. Per-transaction amount check (whitelist gets higher implicit limit, still needs escalation for huge amounts)
    const isWhitelisted = this._config.whitelist.has(to)
    const effectiveLimit = isWhitelisted ? this._config.autoApproveLimit * 10n : this._config.autoApproveLimit

    if (value > effectiveLimit) {
      return this._decide(
        'ESCALATE',
        `Amount ${this._formatWei(value)} exceeds auto-approve limit ${this._formatWei(effectiveLimit)}${isWhitelisted ? ' (whitelisted 10x)' : ''}`,
        request,
        now
      )
    }

    // All checks passed — auto-approve
    this._recordTx(now, value)
    return this._decide('APPROVE', isWhitelisted ? 'Whitelisted recipient, within limits' : 'Within all policy limits', request, now)
  }

  /**
   * Record a confirmed approval for rate tracking.
   * Call this when a transaction is actually submitted.
   *
   * @param {number} timestamp
   * @param {bigint} value
   */
  _recordTx (timestamp, value) {
    this._recentTxs.push({ timestamp, value })
    // Prune entries older than 25 hours
    const cutoff = timestamp - 90_000_000
    this._recentTxs = this._recentTxs.filter(tx => tx.timestamp > cutoff)
  }

  /**
   * @param {Decision} decision
   * @param {string} reason
   * @param {TransactionRequest} request
   * @param {number} timestamp
   * @returns {PolicyDecision}
   */
  _decide (decision, reason, request, timestamp) {
    const result = { decision, reason, request, timestamp }
    this._logger?.log({ type: 'policy_decision', ...result })
    return result
  }

  /** @param {bigint} wei */
  _formatWei (wei) {
    return `${Number(wei) / 1e18} ETH`
  }

  /** Returns a snapshot of spending in the last 24h */
  getSpendingStats () {
    const now = Date.now()
    const oneDayAgo = now - 86_400_000
    const oneHourAgo = now - 3600_000
    const recent24h = this._recentTxs.filter(tx => tx.timestamp > oneDayAgo)
    const recent1h = this._recentTxs.filter(tx => tx.timestamp > oneHourAgo)
    return {
      dailySpent: recent24h.reduce((sum, tx) => sum + tx.value, 0n),
      dailyLimit: this._config.dailyLimit,
      txLast24h: recent24h.length,
      txLastHour: recent1h.length,
      maxTxPerHour: this._config.maxTxPerHour
    }
  }
}
