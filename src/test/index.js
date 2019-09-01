import { createWebdriverAndHtmlReporter } from './reporter'
import tests from './test'
import util from 'util'

mocha.setup('bdd')
tests()
mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
mocha.run()
