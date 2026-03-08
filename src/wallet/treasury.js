/**
 * Warden Treasury Wallet
 *
 * A thin wrapper around the Tether WDK EVM wallet that adds spending policy enforcement.
 * All transfers go through the PolicyEngine before being signed and broadcast.
 */

'use strict'

import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { PolicyEngine } from '../policy/engine.js'
import { AuditLogger } from '../audit/logger.js'

/**
 * @typedef {Object} TreasuryConfig
 * @property {string} seed - BIP-39 mnemonic for the treasury wallet.
 * @property {string} rpcUrl - EVM JSON-RPC endpoint.
 * @property {import('../policy/engine.js').PolicyConfig} policy - Spending policy configuration.
 * @property {string} dbPath - Path to the SQLite audit database.
 * @property {number} [accountIndex] - BIP-44 account index (default 0).
 */

export class Treasury {
  /**
   * @param {TreasuryConfig} config
   */
  constructor (config) {
    this._logger = new AuditLogger(config.dbPath)
    this._policy = new PolicyEngine(config.policy, this._logger)
    this._manager = new WalletManagerEvm(config.seed, {
      provider: config.rpcUrl
    })
    this._accountIndex = config.accountIndex ?? 0
    this._account = null
  }

  /** Lazy-load the wallet account (avoids heavy BIP derivation on import) */
  async _getAccount () {
    if (!this._account) {
      this._account = await this._manager.getAccount(this._accountIndex)
    }
    return this._account
  }

  /**
   * Returns the treasury's public address.
   * @returns {Promise<string>}
   */
  async getAddress () {
    const account = await this._getAccount()
    return account.getAddress()
  }

  /**
   * Returns the current ETH balance (in wei).
   * @returns {Promise<bigint>}
   */
  async getBalance () {
    const account = await this._getAccount()
    return account.getBalance()
  }

  /**
   * Submit a transaction request for policy evaluation.
   * If approved, the transaction is signed and broadcast automatically.
   * If escalated or rejected, the decision is logged and returned without signing.
   *
   * @param {import('../policy/engine.js').TransactionRequest} request
   * @returns {Promise<{decision: import('../policy/engine.js').PolicyDecision, txHash?: string}>}
   */
  async submit (request) {
    const decision = this._policy.evaluate(request)

    if (decision.decision === 'APPROVE') {
      try {
        const account = await this._getAccount()
        const txHash = await account.transfer({
          to: request.to,
          value: request.value,
          data: request.data
        })
        this._logger.log({
          type: 'tx_submitted',
          txHash,
          request,
          timestamp: Date.now()
        })
        return { decision, txHash }
      } catch (err) {
        this._logger.log({
          type: 'tx_error',
          reason: err.message,
          request,
          timestamp: Date.now()
        })
        throw err
      }
    }

    // REJECT or ESCALATE — already logged by PolicyEngine, just return
    return { decision }
  }

  /**
   * Returns current spending statistics from the policy engine.
   */
  getSpendingStats () {
    return this._policy.getSpendingStats()
  }

  /**
   * Query the audit log.
   * @param {Parameters<AuditLogger['query']>[0]} opts
   */
  queryAuditLog (opts) {
    return this._logger.query(opts)
  }

  /** Returns aggregate audit stats */
  auditStats () {
    return this._logger.stats()
  }

  /**
   * Manually approve a previously ESCALATE'd transaction.
   *
   * A human operator calls this after reviewing an escalated transaction.
   * Warden signs and broadcasts the original transaction via WDK, then logs
   * a 'human_approval' audit entry that cross-references the original escalation.
   *
   * @param {number} auditId - The primary-key ID of the ESCALATE audit entry to approve.
   * @returns {Promise<{txHash: string, approvedAuditId: number}>}
   * @throws {Error} If the entry doesn't exist or isn't an ESCALATE decision.
   */
  async approveEscalated (auditId) {
    const entry = this._logger.getById(auditId)
    if (!entry) {
      throw new Error(`Audit entry ${auditId} not found`)
    }
    if (entry.decision !== 'ESCALATE') {
      throw new Error(`Entry ${auditId} is not an ESCALATE decision (got: ${entry.decision ?? entry.type})`)
    }

    const account = await this._getAccount()
    const txHash = await account.transfer({
      to: entry.to_address,
      value: BigInt(entry.value_wei),
      data: entry.data ?? undefined
    })

    this._logger.log({
      type: 'human_approval',
      decision: 'APPROVE',
      reason: `Human-approved escalated transaction (audit #${auditId})`,
      request: {
        to: entry.to_address,
        value: BigInt(entry.value_wei),
        data: entry.data
      },
      txHash,
      timestamp: Date.now()
    })

    return { txHash, approvedAuditId: auditId }
  }

  dispose () {
    this._logger.close()
  }
}
