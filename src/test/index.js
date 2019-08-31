import { createWebdriverAndHtmlReporter } from './reporter'
import tests from './test'
import util from 'util'

// Make logs accessible to travis selenium runner
window.floccusTestLogs = []
var consoleLog = console.log
console.log = function() {
  consoleLog.apply(console, arguments)
  window.floccusTestLogs.push(util.format.apply(util, arguments))
}

mocha.setup('bdd')
tests()
mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
mocha.run()
