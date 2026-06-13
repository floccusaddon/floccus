/* global globalThis */
import Mocha from 'mocha'
import '../test/nodejs-shim'
import Controller from '../lib/Controller'
import { registerNodeSuite } from '../test/node-suite'

if (!process.env.FLOCCUS_TEST_ACCOUNTS) {
  process.env.FLOCCUS_TEST_ACCOUNTS = 'fake'
}

if (!process.env.FLOCCUS_TEST_BROWSER) {
  process.env.FLOCCUS_TEST_BROWSER = 'node'
}

Controller.singleton = {
  setEnabled() {
    return Promise.resolve()
  },
  scheduleSync() {
    return Promise.resolve()
  },
  scheduleAll() {
    return Promise.resolve()
  },
  syncAccount() {
    return Promise.resolve()
  },
  cancelSync() {
    return Promise.resolve()
  },
  unlock() {
    return Promise.resolve()
  },
  getUnlocked() {
    return Promise.resolve(true)
  },
  onStatusChange() {
    return () => undefined
  },
  onLoad() {
    return Promise.resolve()
  },
}

const grep = process.env.FLOCCUS_TEST || undefined
const invert = process.env.FLOCCUS_TEST_INVERT === 'true'

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

async function main() {
  const mocha = new Mocha({
    color: true,
    grep,
    invert,
    reporter: process.env.MOCHA_REPORTER || 'spec',
    timeout: 120000,
    ui: 'bdd',
    allowUncaught: false,
  })

  mocha.suite.emit('pre-require', globalThis, 'floccus-node-tests', mocha)
  await registerNodeSuite()

  const failures = await new Promise((resolve) => {
    mocha.run(resolve)
  })

  if (failures) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})