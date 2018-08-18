import { createWebdriverAndHtmlReporter } from './reporter'

mocha.setup('bdd')
require('./test')
mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
mocha.run()
