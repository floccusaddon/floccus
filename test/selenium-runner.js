const fs = require('fs')
const url = require('url')
const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
const { Type, Entry } = require('selenium-webdriver/lib/logging')
const { Options: ChromeOptions } = require('selenium-webdriver/chrome')
const { Options: FirefoxOptions } = require('selenium-webdriver/firefox')
const VERSION = require('../package.json').version
;(async function() {
  let driver = await new Builder()
    .usingServer(
      `http://${process.env.SAUCE_USERNAME}:${
        process.env.SAUCE_ACCESS_KEY
      }@ondemand.saucelabs.com/wd/hub`
    )
    .withCapabilities(
      new Capabilities({
        'tunnel-identifier': process.env['TRAVIS_JOB_NUMBER']
      })
    )
    .forBrowser('chrome')
    .setChromeOptions(
      new ChromeOptions().addExtensions(
        fs.readFileSync(`./builds/floccus-build-v${VERSION}.crx`, 'base64')
      )
    )
    .setFirefoxOptions(
      new FirefoxOptions()
        .set('version', 'dev')
        .set('platform', 'Windows 10')
        .addExtensions(`./builds/floccus-build-v${VERSION}.xpi`)
    )
    .build()
  try {
    let id, testURL
    switch (await (await driver.getSession()).getCapability('browserName')) {
      case 'chrome':
        // Scrape extension id from chrome extension page
        await driver.get('chrome://extensions')
        await new Promise(resolve => setTimeout(resolve, 5000))
        id = await driver.executeAsyncScript(function() {
          var callback = arguments[arguments.length - 1]
          extensions.Service.getInstance()
            .getExtensionsInfo()
            .then(data => {
              return data
                .filter(extension => extension.name === 'floccus')
                .map(extension => extension.id)[0]
            })
            .then(callback)
        })
        if (!id) throw new Error('Could not install extension')
        testUrl = `chrome-extension://${id}/`
        break

      case 'firefox':
        // Scrape extension id from firefox addons page
        await driver.get('about:addons')
        await new Promise(resolve => setTimeout(resolve, 5000))
        let optionsURL = await driver.executeAsyncScript(function() {
          var callback = arguments[arguments.length - 1]
          AddonManager.getActiveAddons()
            .then(data => {
              return data.addons
                .filter(extension => extension.name === 'floccus')
                .map(extension => extension.optionsURL)[0]
            })
            .then(callback)
        })
        if (!optionsURL) throw new Error('Could not install extension')
        id = url.parse(optionsURL).hostname
        testUrl = `moz-extension://${id}/`
        break
      default:
        throw new Error('Unknown browser')
    }

    testUrl += `dist/html/test.html?grep=${process.env.FLOCCUS_ADAPTER}%20`

    await driver.get(testUrl)

    let logs,
      fin,
      i = 0
    do {
      await new Promise(resolve => setTimeout(resolve, 3000))
      logs = await driver.executeScript(function() {
        return window.floccusTestLogs
      })

      logs.slice(i).forEach(entry => console.log(entry))
      i = logs.length
    } while (
      !logs.some(entry => {
        if (~entry.indexOf('FINISHED')) {
          fin = entry
          return true
        }
        return false
      })
    )
    await driver.quit()
    if (fin && ~fin.indexOf('FAILED')) {
      process.exit(1)
    }
  } catch (e) {
    console.log(e)
    await driver.quit()
    process.exit(1)
  }
})()
