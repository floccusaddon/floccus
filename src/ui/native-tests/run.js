import util from 'util'
import { installNativeBrowserApi } from './browser-api'

function getAbsoluteAssetUrl(path) {
  return window.location.origin + path
}

function loadAsset(tagName, attributes) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`${tagName}[data-native-test-asset="${attributes['data-native-test-asset']}"]`)
    if (existing) {
      resolve(existing)
      return
    }

    const element = document.createElement(tagName)
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, value)
    })
    element.addEventListener('load', () => resolve(element), { once: true })
    element.addEventListener('error', () => reject(new Error('Failed to load test asset ' + attributes['data-native-test-asset'])), { once: true })
    document.head.appendChild(element)
  })
}

function installConsoleBridge() {
  window.floccusTestLogs = []
  window.floccusTestLogsLength = 0

  if (!console.__floccusNativeOriginalLog) {
    console.__floccusNativeOriginalLog = console.log.bind(console)
    console.log = function() {
      console.__floccusNativeOriginalLog.apply(console, arguments)
      window.floccusTestLogs.push(util.format.apply(util, arguments))
    }
  }
}

function syncSearchParams(routeQuery) {
  const params = new URLSearchParams()
  Object.entries(routeQuery || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(entry => params.append(key, entry))
      return
    }
    if (value !== null && typeof value !== 'undefined') {
      params.set(key, value)
    }
  })

  const search = params.toString()
  history.replaceState(
    history.state,
    '',
    `${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`
  )
}

function installErrorBridge() {
  window.addEventListener('error', event => {
    if (event.error) {
      console.log(event.error.stack || event.error.message)
      return
    }
    console.log(event.message)
  })

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason
    console.log((reason && (reason.stack || reason.message)) || reason)
  })
}

let hasInstalledErrorBridge = false

export async function runNativeTests(routeQuery) {
  window.__floccusNativeTestReady = false
  window.__floccusNativeTestFinished = false

  installConsoleBridge()
  if (!hasInstalledErrorBridge) {
    installErrorBridge()
    hasInstalledErrorBridge = true
  }

  syncSearchParams(routeQuery)
  installNativeBrowserApi()

  await loadAsset('link', {
    rel: 'stylesheet',
    href: getAbsoluteAssetUrl('/css/mocha.css'),
    'data-native-test-asset': 'mocha.css',
  })
  await loadAsset('script', {
    src: getAbsoluteAssetUrl('/js/mocha.js'),
    'data-native-test-asset': 'mocha.js',
  })

  const { createWebdriverAndHtmlReporter } = await import('../../test/reporter')

  const params = new URL(window.location.href).searchParams
  mocha.setup('bdd')
  if (params.get('grep')) {
    mocha.grep(params.get('grep'))
  }

  await import('../../test/test')

  return new Promise((resolve) => {
    mocha.reporter(createWebdriverAndHtmlReporter(mocha._reporter))
    window.__floccusNativeTestReady = true
    mocha.run(() => {
      window.__floccusNativeTestFinished = true
      resolve()
    })
  })
}
