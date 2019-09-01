import { createWebdriverAndHtmlReporter } from './reporter'
import tests from './test'

mocha.setup('bdd')
tests()
mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
mocha.run()
