import { createWebdriverAndHtmlReporter } from './reporter'
import util from 'util'

// Make logs accessible to travis selenium runner
window.floccusTestLogs = []
const consoleLog = console.log
console.log = function() {
  consoleLog.apply(console, arguments)
  window.floccusTestLogs.push(util.format.apply(util, arguments))
}

window.addEventListener('DOMContentLoaded', () => {
  mocha.setup('bdd')
  import('./test').then(() => {
    mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
    mocha.run()
  })
})
