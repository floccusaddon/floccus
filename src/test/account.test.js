/* global IS_BROWSER */
import { expect, getEnv, stringifyAccountData } from './utils'
import Controller from '../lib/Controller'
import Account from '../lib/Account'
import random from 'random'
import seedrandom from 'seedrandom'

describe('Floccus', function() {
  this.timeout(120000) // no test should run longer than 120s
  this.slow(20000) // 20s is slow

  const {
    ACCOUNTS,
    SEED,
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

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Account`, function() {
      let account
      beforeEach('set up account', async function() {
        account = await Account.create(ACCOUNT_DATA)
      })
      afterEach('clean up account', async function() {
        if (account) {
          try {
            let localResource = await account.getResource()
            let localRoot = (await localResource.getBookmarksTree()).id
            if (localRoot) await localResource.removeFolder(
              await localResource.getBookmarksTree()
            )
          } catch (e) {
            console.log(e)
          }
          await account.delete()
        }
      })
      it('should create an account', async function() {
        const secondInstance = await Account.get(account.id)
        expect(secondInstance.getData()).to.deep.equal(account.getData())
      })
      it('should save and restore an account', async function() {
        await account.setData(ACCOUNT_DATA)
        expect(account.getData()).to.deep.equal({ ...account.getData(), ...ACCOUNT_DATA })

        const secondInstance = await Account.get(account.id)
        expect(secondInstance.getData()).to.deep.equal({ ...secondInstance.getData(), ...ACCOUNT_DATA })
      })
      it('should delete an account', async function() {
        await account.delete()
        expect(Account.get(account.id)).to.be.rejected
        account = null // so afterEach notices it's deleted already
      })
      it('should not be initialized upon creation', async function() {
        expect(await account.isInitialized()).to.be.false
      })
    })
  })
})