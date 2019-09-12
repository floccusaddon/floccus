const fs = require('fs')
const url = require('url')
const { Builder, logging, Condition } = require('selenium-webdriver')
const { Options: ChromeOptions } = require('selenium-webdriver/chrome')
const { Options: FirefoxOptions } = require('selenium-webdriver/firefox')
const VERSION = require('../package.json').version
;(async function() {
  logging.installConsoleHandler()
  let driver = await new Builder()
    .withCapabilities({
      browserVersion: 'latest',
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
      new ChromeOptions().addExtensions(
        fs.readFileSync(`./builds/floccus-build-v${VERSION}.crx`, 'base64')
      )
    )
    .setLoggingPrefs(
      new logging.Preferences().setLevel(
        logging.Type.BROWSER,
        logging.Level.DEBUG
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
        await driver.installAddon(
          `./builds/floccus-build-v${VERSION}.xpi`,
          true
        )
        await driver.get('about:debugging')
        await new Promise(resolve => setTimeout(resolve, 10000))
        let optionsURL = await driver.executeScript(function() {
          const extension = AboutDebugging.store
            .getState()
            .debugTargets.installedExtensions.filter(
              obj => obj.id === 'floccus@handmadeideas.org'
            )[0]
          return extension.details.manifestURL
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

    const finishStatus = await driver.wait(
      new Condition('for tests to finish', async driver => {
        // dump latest logs
        const logs = await driver.executeScript(function() {
          const logs = window.floccusLogMessages
          window.floccusLogMessages = []
          return logs
        })
        logs.forEach(entry => console.log(entry))

        // check if the tests are finished
        return driver.executeScript(function() {
          return window.floccusTestsFinished
        })
      }),
      undefined,
      undefined,
      1000 // poll interval
    )

    await driver.quit()
    if (finishStatus === 'FAILED') {
      process.exit(1)
    }
  } catch (e) {
    console.log(e)
    await driver.quit()
    process.exit(1)
  }
})()
