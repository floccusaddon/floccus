const {
  EVENT_RUN_END,
  EVENT_TEST_BEGIN,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_SUITE_BEGIN
} = Mocha.Runner.constants

export function createWebdriverAndHtmlReporter(html_reporter) {
  return function(runner) {
    Mocha.reporters.Base.call(this, runner)

    // report on the selenium screen, too
    new html_reporter(runner)

    // build a summary
    const summary = []

    let mocha = document.querySelector('#mocha')
    runner.on(EVENT_TEST_BEGIN, test => {
      resetKillTimeout()
      console.log('\n### ' + test.title + ' ###\n')
      // Scroll down test display after each test
      mocha.scrollTop = mocha.scrollHeight
    })

    runner.on(EVENT_SUITE_BEGIN, suite => {
      if (suite.root) return
      console.log('\n## ' + suite.title + ' ## \n')
      summary.push('## ' + suite.title)
    })

    runner.on(EVENT_TEST_FAIL, test => {
      console.log('->', 'FAILED :', test.title, stringifyException(test.err))
      summary.push(this.symbols.err, test.title)
      resetKillTimeout()
    })
    runner.on(EVENT_TEST_PASS, test => {
      console.log('->', 'PASSED :', test.title, test.duration / 1000 + 's')
      summary.push(this.symbols.ok, test.title)
      resetKillTimeout()
    })

    runner.on(EVENT_RUN_END, () => {
      var minutes = Math.floor(runner.stats.duration / 1000 / 60)
      var seconds = Math.round((runner.stats.duration / 1000) % 60)

      console.log('\n' + summary.join('\n'))

      console.log(
        'FINISHED ' + (runner.stats.failures > 0 ? 'FAILED' : 'PASSED') + ' -',
        runner.stats.passes,
        'tests passed,',
        runner.stats.failures,
        'tests failed, duration: ' + minutes + ':' + seconds
      )
    })
  }
}

var killTimeout
function resetKillTimeout() {
  if (killTimeout) clearTimeout(killTimeout)
  killTimeout = setTimeout(() => {
    console.log(
      'FINISHED FAILED - no test has ended for 3 minutes, tests stopped'
    )
  }, 60000 * 3)
}

function stringifyException(exception) {
  var err = exception.stack || exception.toString()

  // FF / Opera do not add the message
  if (!~err.indexOf(exception.message)) {
    err = exception.message + '\n' + err
  }

  // <=IE7 stringifies to [Object Error]. Since it can be overloaded, we
  // check for the result of the stringifying.
  if ('[object Error]' == err) err = exception.message

  // Safari doesn't give you a stack. Let's at least provide a source line.
  if (!exception.stack && exception.sourceURL && exception.line !== undefined) {
    err += '\n(' + exception.sourceURL + ':' + exception.line + ')'
  }

  return err
}
