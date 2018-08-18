export function createWebdriverAndHtmlReporter(html_reporter) {
  return function(runner) {
    Mocha.reporters.Base.call(this, runner)
    new html_reporter(runner)

    // Scroll down test display after each test
    let mocha = document.querySelector('#mocha')
    runner.on('test', test => {
      console.log(test.title)
      mocha.scrollTop = mocha.scrollHeight
    })

    runner.on('suite', suite => {
      if (suite.root) return
      console.log(suite.title)
    })

    var killTimeout
    runner.on('test end', test => {
      if ('passed' == test.state) {
        console.log('->', 'PASSED :', test.title)
      } else if (test.pending) {
        console.log('->', 'PENDING:', test.title)
      } else {
        console.log('->', 'FAILED :', test.title, stringifyException(test.err))
      }

      if (killTimeout) clearTimeout(killTimeout)
      killTimeout = setTimeout(() => {
        console.log('FINISHED - no test started since 3 minutes, tests stopped')
      }, 60000 * 3)
    })

    var total = runner.total
    runner.on('end', () => {
      if (this.stats.tests >= total) {
        var minutes = Math.floor(this.stats.duration / 1000 / 60)
        var seconds = Math.round((this.stats.duration / 1000) % 60)

        console.log(
          'FINISHED ' + (this.stats.failures > 0 ? 'FAILED' : 'PASSED') + ' -',
          this.stats.passes,
          'tests passed,',
          this.stats.failures,
          'tests failed, duration: ' + minutes + ':' + seconds
        )
      }
    })
  }
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
