import { createWebdriverAndHtmlReporter } from './reporter'
import util from 'util'

// Make logs accessible to travis selenium runner
window.floccusTestLogs = []
const consoleLog = console.log
console.log = function() {
  consoleLog.apply(console, arguments)
  window.floccusTestLogs.push(util.format.apply(util, arguments))
}

mocha.setup('bdd')
require('./test')
mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
mocha.run()
