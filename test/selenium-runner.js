const fs = require('fs')
const url = require('url')
const { Builder, By, until } = require('selenium-webdriver')
const { Preferences, Level, Type, installConsoleHandler } = require('selenium-webdriver/lib/logging')
const { Options: ChromeOptions } = require('selenium-webdriver/chrome')
const { Options: FirefoxOptions } = require('selenium-webdriver/firefox')
const fetch = require('node-fetch')
const VERSION = require('../package.json').version
// Enable SELENIUM logging to console
installConsoleHandler()
;(async function() {
  const loggingPrefs = new Preferences()
  loggingPrefs.setLevel(Type.CLIENT, Level.INFO)
  loggingPrefs.setLevel(Type.DRIVER, Level.INFO)
  loggingPrefs.setLevel(Type.SERVER, Level.INFO)

  let driver = await new Builder()
    .usingServer(`http://localhost:4444/wd/hub`)
    .forBrowser(process.env.SELENIUM_BROWSER)
    .setChromeOptions(
      process.env.SELENIUM_BROWSER === 'chrome'
        ? new ChromeOptions()
          .excludeSwitches('extension-content-verification')
          .addArguments([
            '--no-sandbox', // see https://bugs.chromium.org/p/chromedriver/issues/detail?id=2473
            '--remote-debugging-port=9222'
          ])
          .addExtensions(`./builds/floccus-build-v${VERSION}.crx`)
        : null
    )
    .setLoggingPrefs(loggingPrefs)
    .build()
  console.log('Driver built for browser ' + process.env.SELENIUM_BROWSER)
  try {
    let id, testUrl
    switch (await (await driver.getSession()).getCapability('browserName')) {
      case 'chrome':
        // Scrape extension id from chrome extension page
        await driver.get('chrome://extensions')
        console.log('Opened chrome://extensions')
        await driver.sleep(5000)
        console.log('Slept 5s')

        id = await driver.executeAsyncScript(function() {
          var callback = arguments[arguments.length - 1]
          var extension = document
            .querySelector('extensions-manager')
            .extensions_.find(
              extension => extension.name === 'floccus bookmarks sync'
            )
          callback(extension.id)
        })
        console.log('Extracted extension.id')
        if (!id) throw new Error('Could not install extension')
        testUrl = `chrome-extension://${id}/`
        break

      case 'firefox':
        // Scrape extension id from firefox addons page
        await driver.installAddon(
          `${__dirname}/../builds/floccus-build-v${VERSION}-firefox.zip`,
          true
        )
        console.log('Installed extension')

        // Get extension URL
        await driver.get('about:debugging')
        console.log('Opened about:debugging')
        await driver.sleep(10000)
        console.log('Slept 10s')
        testUrl = await driver.executeScript(function() {
          const extension = WebExtensionPolicy.getActiveExtensions()
            .find(({name}) => name === 'floccus bookmarks sync')
          return extension.extension.baseURL
        })
        console.log('Extracted extension.baseURL')
        if (!testUrl) throw new Error('Could not install extension')
        break
      default:
        throw new Error('Unknown browser')
    }

    let server = `http://${process.env.TEST_HOST}`

    if (process.env.FLOCCUS_TEST.includes('linkwarden')) {
      server = `https://cloud.linkwarden.app`
    }

    testUrl += `dist/html/test.html?grep=${process.env.FLOCCUS_TEST}&server=${server}&app_version=${process.env.APP_VERSION}&browser=${process.env.SELENIUM_BROWSER}`

    if (process.env.FLOCCUS_TEST.includes('google-drive')) {
      testUrl += `&password=${process.env.GOOGLE_API_REFRESH_TOKEN}`
    }

    if (process.env.FLOCCUS_TEST.includes('linkwarden')) {
      testUrl += `&username=mk`
      testUrl += `&password=${process.env.LINKWARDEN_TOKEN}`
    }

    if (process.env.FLOCCUS_TEST_SEED) {
      testUrl += `&seed=${process.env.FLOCCUS_TEST_SEED}`
    }

    await driver.get(testUrl)
    console.log('Opened test page')

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
    if (fin && ~fin.indexOf('FAILED')) {
      await driver.quit()
      process.exit(1)
    } else {
      await driver.quit()
    }
  } catch (e) {
    console.log(e)
    await driver.quit()
    process.exit(1)
  }
})()
