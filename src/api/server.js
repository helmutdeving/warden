/**
 * Warden REST API
 *
 * Exposes the treasury agent via HTTP. All endpoints are JSON.
 *
 * POST /v1/transfer             - Submit a transfer request for policy evaluation + optional auto-execution
 * POST /v1/escalated/:id/approve - Human approves a previously escalated transaction
 * GET  /v1/address              - Get the treasury wallet address
 * GET  /v1/balance              - Get the current ETH balance
 * GET  /v1/stats                - Get spending stats + audit summary
 * GET  /v1/audit                - Query recent audit log entries
 */

'use strict'

import express from 'express'

/**
 * @param {import('../wallet/treasury.js').Treasury} treasury
 * @param {{ port?: number }} [opts]
 */
export function createServer (treasury, opts = {}) {
  const app = express()
  app.use(express.json())

  // POST /v1/transfer
  app.post('/v1/transfer', async (req, res) => {
    try {
      const { to, value, data, reason } = req.body
      if (!to || value == null) {
        return res.status(400).json({ error: 'Missing required fields: to, value' })
      }

      const result = await treasury.submit({
        to,
        value: BigInt(value),
        data,
        reason,
        timestamp: Date.now()
      })

      res.json({
        decision: result.decision.decision,
        reason: result.decision.reason,
        txHash: result.txHash ?? null
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /v1/address
  app.get('/v1/address', async (_req, res) => {
    try {
      const address = await treasury.getAddress()
      res.json({ address })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /v1/balance
  app.get('/v1/balance', async (_req, res) => {
    try {
      const wei = await treasury.getBalance()
      res.json({ wei: wei.toString(), eth: (Number(wei) / 1e18).toFixed(6) })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /v1/stats
  app.get('/v1/stats', (_req, res) => {
    try {
      const spending = treasury.getSpendingStats()
      const audit = treasury.auditStats()
      res.json({
        spending: {
          dailySpent: spending.dailySpent.toString(),
          dailyLimit: spending.dailyLimit.toString(),
          txLast24h: spending.txLast24h,
          txLastHour: spending.txLastHour,
          maxTxPerHour: spending.maxTxPerHour
        },
        decisions: audit
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /v1/escalated/:id/approve  — human approves an escalated transaction
  app.post('/v1/escalated/:id/approve', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (isNaN(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid audit entry ID' })
      }
      const result = await treasury.approveEscalated(id)
      res.json(result)
    } catch (err) {
      const status = err.message.includes('not found') || err.message.includes('not an ESCALATE') ? 400 : 500
      res.status(status).json({ error: err.message })
    }
  })

  // GET /v1/audit?limit=50&type=policy_decision&since=1234567890
  app.get('/v1/audit', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50
      const type = req.query.type || undefined
      const since = req.query.since ? parseInt(req.query.since) : undefined
      const entries = treasury.queryAuditLog({ limit, type, since })
      res.json({ entries })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  const port = opts.port ?? 3010
  return { app, port }
}

/**
 * Start the server and return the http.Server instance.
 *
 * @param {import('../wallet/treasury.js').Treasury} treasury
 * @param {{ port?: number }} [opts]
 * @returns {Promise<import('http').Server>}
 */
export async function startServer (treasury, opts = {}) {
  const { app, port } = createServer(treasury, opts)
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[Warden] API server running on http://localhost:${port}`)
      resolve(server)
    })
  })
}
