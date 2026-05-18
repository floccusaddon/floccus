import { expect, getEnv } from './utils'
import Controller from '../lib/Controller'
import Crypto from '../lib/Crypto'
import DefunctCrypto from '../lib/DefunctCrypto'
import random from 'random'
import seedrandom from 'seedrandom'

describe('Floccus', function() {
  this.timeout(120000) // no test should run longer than 120s
  this.slow(20000) // 20s is slow

  const {
    SEED
  } = getEnv()
  random.use(seedrandom(SEED))

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)
  })

  describe('Crypto', function() {
    it('should encrypt and decrypt correctly', async function() {
      const passphrase = 'test'
      const salt = 'blah'
      const message = 'I don\'t know'
      const payload = await Crypto.encryptAES(passphrase, message, salt)
      console.log(payload)
      const cleartext = await Crypto.decryptAES(passphrase, payload, salt)
      expect(cleartext).to.equal(message)
      console.log(cleartext)
      console.log(message)
    })

    it('should encrypt and decrypt correctly (even with defunct crypto)', async function() {
      const passphrase = 'test'
      const message = 'I don\'t know'
      const payload = await DefunctCrypto.encryptAES(passphrase, DefunctCrypto.iv, message)
      console.log(payload)
      const cleartext = await DefunctCrypto.decryptAES(passphrase, DefunctCrypto.iv, payload)
      expect(cleartext).to.equal(message)
      console.log(cleartext)
      console.log(message)
    })
  })
})