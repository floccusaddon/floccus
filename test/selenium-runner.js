const fs = require('fs')
const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
const { Type, Entry } = require('selenium-webdriver/lib/logging')
const { Options: ChromeOptions } = require('selenium-webdriver/chrome')
const { Options: FirefoxOptions } = require('selenium-webdriver/firefox')
const VERSION = require('./package.json').version

let driver = new Builder()
  .usingServer(
    `http://${process.env.SAUCE_USERNAME}:${
      process.env.SAUCE_ACCESS_KEY
    }@ondemand.saucelabs.com/wd/hub`
  )
  .withCapabilities(
    new Capabilities({ 'tunnel-identifier': process.env['TRAVIS_JOB_NUMBER'] })
  )
  .forBrowser('chrome')
  .setChromeOptions(
    new ChromeOptions().addExtensions(fs.readFileSync('./floccus.crx'))
  )
  .setFirefoxOptions(
    new FirefoxOptions().addExtensions(
      fs.readFileSync(`./builds/floccus-build-v${VERSION}.xpi`)
    )
  )
  .build()
;(async function() {
  // open floccus test page by pressing the magic keyboard shortcut
  await driver
    .actions()
    .sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, Key.SPACE), '')
    .perform()

  let logs, fin
  do {
    await new Promise(resolve => setTimeout(resolve, 3000))
    logs = await driver
      .manage()
      .logs()
      .get(Type.BROWSER)

    logs.forEach(entry => console.log(entry.message))
  } while (
    !logs.some(entry => {
      if (~entry.message.indexOf('FINISHED')) {
        fin = entry
        return true
      }
      return false
    })
  )
  if (~fin.message.indexOf('FAILED')) {
    process.exit(1)
  }
})()
