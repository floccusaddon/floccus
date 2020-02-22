const fs = require('fs')
const url = require('url')
const { Builder } = require('selenium-webdriver')
const { Options: ChromeOptions } = require('selenium-webdriver/chrome')
const { Options: FirefoxOptions } = require('selenium-webdriver/firefox')
const saveStats = require('./save-stats')
const VERSION = require('../package.json').version
;(async function() {
  let driver = await new Builder()
    .withCapabilities({
      browserVersion: process.env['BROWSER_VERSION'],
      'sauce:options': {
        name: process.env['TRAVIS_JOB_NUMBER'],
        tunnelIdentifier: process.env['TRAVIS_JOB_NUMBER'],
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
        'moz:firefoxOptions': { wc3: true },
        'goog:chromeOptions': { wc3: true },
        'seleniumVersion:': '3.11.0'
      }
    })
    .usingServer(`https://ondemand.saucelabs.com/wd/hub`)
    .forBrowser(process.env.SELENIUM_BROWSER)
    .setChromeOptions(
      new ChromeOptions()
        .excludeSwitches('extension-content-verification')
        .addExtensions(
          fs.readFileSync(`./builds/floccus-build-v${VERSION}.crx`, 'base64')
        )
    )
    .build()
  try {
    let id, testUrl
    switch (await (await driver.getSession()).getCapability('browserName')) {
      case 'chrome':
        // Scrape extension id from chrome extension page
        await driver.get('chrome://extensions')
        await new Promise(resolve => setTimeout(resolve, 5000))
        id = await driver.executeAsyncScript(function() {
          var callback = arguments[arguments.length - 1]
          var extension = document
            .querySelector('extensions-manager')
            .extensions_.find(
              extension => extension.name === 'floccus bookmarks sync'
            )
          callback(extension.id)
        })
        if (!id) throw new Error('Could not install extension')
        testUrl = `chrome-extension://${id}/`
        break

      case 'firefox':
        // Scrape extension id from firefox addons page
        await driver.installAddon(
          `./builds/floccus-build-v${VERSION}.xpi`,
          true
        )
        await driver.get('about:debugging#/runtime/this-firefox')
        await new Promise(resolve => setTimeout(resolve, 10000))
        let optionsURL = await driver.executeScript(function() {
          const extension = AboutDebugging.store
            .getState()
            .debugTargets.temporaryExtensions.concat(
              AboutDebugging.store.getState().debugTargets.installedExtensions
            )
            .filter(obj => obj.id === 'floccus@handmadeideas.org')[0]
          return extension.details.manifestURL
        })
        if (!optionsURL) throw new Error('Could not install extension')
        id = url.parse(optionsURL).hostname
        testUrl = `moz-extension://${id}/`
        break
      default:
        throw new Error('Unknown browser')
    }

    testUrl += `dist/html/test.html?grep=${process.env.FLOCCUS_ADAPTER}`

    await driver.get(testUrl)

    let logs = [],
      fin
    do {
      await new Promise(resolve => setTimeout(resolve, 3000))
      logs = await driver.executeScript(function() {
        var logs = window.floccusTestLogs.slice(
          window.floccusTestLogsLength || 0
        )
        window.floccusTestLogsLength = window.floccusTestLogs.length
        return logs
      })

      logs.forEach(entry => console.log(entry))
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
    } else {
      const match = fin.match(/duration: (\d+):(\d+)/i)
      if (match) {
        const data = {
          testSuiteTime: parseInt(match[1]) + parseInt(match[2]) / 60
        }
        const label =
          process.env['FLOCCUS_ADAPTER'] +
          ' ' +
          process.env['SELENIUM_BROWSER'] +
          ' ' +
          process.env['SERVER_BRANCH'] +
          ' ' +
          process.env['NC_APP_VERSION']
        try {
          await saveStats(process.env['TRAVIS_COMMIT'], label, data)
        } catch (e) {
          console.log('FAILED TO SAVE BENCHMARK STATS', e)
        }
      }
    }
  } catch (e) {
    console.log(e)
    await driver.quit()
    process.exit(1)
  }
})()
