/**
 * Warden Demo
 *
 * Self-contained simulation of the Warden AI treasury agent.
 * No network connection required — demonstrates the full policy evaluation cycle.
 *
 * Run: node src/demo.js
 */

'use strict'

import { PolicyEngine } from './policy/engine.js'
import { AuditLogger } from './audit/logger.js'
import { tmpdir } from 'os'
import { join } from 'path'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'

function log (msg) { process.stdout.write(msg + '\n') }
function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

function colorDecision (d) {
  if (d === 'APPROVE') return `${GREEN}${BOLD}APPROVE${RESET}`
  if (d === 'REJECT') return `${RED}${BOLD}REJECT${RESET}`
  return `${YELLOW}${BOLD}ESCALATE${RESET}`
}

async function runDemo () {
  log(`\n${CYAN}${BOLD}=== Warden AI Treasury Agent — Demo ===${RESET}\n`)

  const dbPath = join(tmpdir(), 'warden-demo.db')
  const logger = new AuditLogger(dbPath)

  const policy = new PolicyEngine({
    autoApproveLimit: 10n ** 17n,        // 0.1 ETH per tx
    dailyLimit: 5n * 10n ** 17n,         // 0.5 ETH per day
    maxTxPerHour: 5,
    whitelist: ['0xdao-payroll-0000000000000000000000000001'],
    blacklist: ['0xdeadbeef00000000000000000000000000000000']
  }, logger)

  const SCENARIOS = [
    {
      label: 'Routine payroll disbursement (whitelisted, 0.08 ETH)',
      request: {
        to: '0xdao-payroll-0000000000000000000000000001',
        value: 8n * 10n ** 16n,   // 0.08 ETH
        reason: 'Weekly contributor payroll — Alice'
      }
    },
    {
      label: 'Small vendor payment (0.05 ETH)',
      request: {
        to: '0xvendor00000000000000000000000000000002',
        value: 5n * 10n ** 16n,   // 0.05 ETH
        reason: 'Infra hosting invoice #INV-2026-003'
      }
    },
    {
      label: 'Blacklisted address attempt',
      request: {
        to: '0xdeadbeef00000000000000000000000000000000',
        value: 1n * 10n ** 16n,   // 0.01 ETH
        reason: 'Unknown recipient'
      }
    },
    {
      label: 'Large transfer over auto-approve limit (0.5 ETH)',
      request: {
        to: '0xpartner0000000000000000000000000000003',
        value: 5n * 10n ** 17n,   // 0.5 ETH
        reason: 'Q1 strategic partnership payment'
      }
    },
    {
      label: 'Another routine payment (0.09 ETH)',
      request: {
        to: '0xvendor00000000000000000000000000000004',
        value: 9n * 10n ** 16n,   // 0.09 ETH
        reason: 'Design work invoice #INV-2026-004'
      }
    },
    {
      label: 'Payment that would breach daily limit (0.1 ETH — remaining is 0.13 ETH but context matters)',
      request: {
        to: '0xvendor00000000000000000000000000000005',
        value: 10n ** 17n,         // 0.1 ETH
        reason: 'Legal services retainer'
      }
    }
  ]

  for (const scenario of SCENARIOS) {
    await sleep(120)
    log(`${CYAN}▶ ${scenario.label}${RESET}`)
    log(`  To: ${scenario.request.to}`)
    log(`  Value: ${Number(scenario.request.value) / 1e18} ETH`)
    log(`  Reason: "${scenario.request.reason}"`)

    const decision = policy.evaluate({ ...scenario.request, timestamp: Date.now() })

    log(`  Decision: ${colorDecision(decision.decision)}`)
    log(`  Reason: ${decision.reason}\n`)
  }

  // Final stats
  log(`${CYAN}${BOLD}=== Audit Summary ===${RESET}`)
  const stats = logger.stats()
  log(`  Total decisions: ${stats.total}`)
  log(`  ${GREEN}Approved: ${stats.approved}${RESET}`)
  log(`  ${RED}Rejected: ${stats.rejected}${RESET}`)
  log(`  ${YELLOW}Escalated: ${stats.escalated}${RESET}`)

  const spending = policy.getSpendingStats()
  log(`\n${CYAN}${BOLD}=== Spending Stats ===${RESET}`)
  log(`  Daily spent: ${Number(spending.dailySpent) / 1e18} ETH / ${Number(spending.dailyLimit) / 1e18} ETH limit`)
  log(`  Transactions last hour: ${spending.txLastHour}/${spending.maxTxPerHour}`)
  log(`  Transactions last 24h: ${spending.txLast24h}`)

  log(`\n${GREEN}${BOLD}Demo complete. Warden is ready for production.${RESET}\n`)
  logger.close()
}

runDemo().catch(err => {
  console.error('Demo failed:', err)
  process.exit(1)
})
