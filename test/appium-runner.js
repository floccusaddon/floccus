const fetch = require('node-fetch')

const APPIUM_SERVER = process.env.APPIUM_SERVER || 'http://127.0.0.1:4723'
const APPIUM_TIMEOUT = parseInt(process.env.APPIUM_TIMEOUT || '180000', 10)
const APPIUM_POLL_INTERVAL = parseInt(process.env.APPIUM_POLL_INTERVAL || '3000', 10)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function request(method, path, body) {
  const response = await fetch(`${APPIUM_SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
  })

  let payload = null
  const text = await response.text()
  if (text) {
    payload = JSON.parse(text)
  }

  if (!response.ok) {
    const error = new Error(`Appium request failed: ${method} ${path} -> ${response.status}`)
    error.payload = payload
    throw error
  }

  if (payload && payload.value && payload.value.error) {
    const error = new Error(payload.value.message || payload.value.error)
    error.payload = payload
    throw error
  }

  return payload ? payload.value : null
}

async function waitForAppium() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < APPIUM_TIMEOUT) {
    try {
      const status = await request('GET', '/status')
      if (status && status.ready !== false) {
        return
      }
    } catch (error) {
      console.log('Waiting for Appium server:', error.message)
    }
    await sleep(1000)
  }

  throw new Error('Timed out while waiting for the Appium server')
}

function getSessionCapabilities() {
  const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.APPIUM_DEVICE_NAME || 'Android Emulator',
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 600,
    'appium:noReset': false,
    'appium:chromedriverAutodownload': true,
  }

  if (process.env.APPIUM_APP) {
    capabilities['appium:app'] = process.env.APPIUM_APP
  } else {
    capabilities['appium:appPackage'] = process.env.APPIUM_APP_PACKAGE || 'org.handmadeideas.floccus'
    capabilities['appium:appActivity'] = process.env.APPIUM_APP_ACTIVITY || 'org.handmadeideas.floccus.MainActivity'
  }

  return {
    capabilities: {
      alwaysMatch: capabilities,
      firstMatch: [{}],
    },
  }
}

async function createSession() {
  const value = await request('POST', '/session', getSessionCapabilities())
  if (value.sessionId) {
    return value.sessionId
  }
  throw new Error('Appium did not return a session id')
}

async function deleteSession(sessionId) {
  if (!sessionId) {
    return
  }

  try {
    await request('DELETE', `/session/${sessionId}`)
  } catch (error) {
    console.log('Failed to delete Appium session:', error.message)
  }
}

async function waitForWebViewContext(sessionId) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < APPIUM_TIMEOUT) {
    const contexts = await request('GET', `/session/${sessionId}/contexts`)
    const webViewContext = (contexts || []).find(context => context.startsWith('WEBVIEW'))
    if (webViewContext) {
      return webViewContext
    }
    await sleep(1000)
  }

  throw new Error('Timed out while waiting for a WEBVIEW context')
}

async function switchContext(sessionId, context) {
  await request('POST', `/session/${sessionId}/context`, { name: context })
}

async function executeScript(sessionId, script, args = []) {
  return request('POST', `/session/${sessionId}/execute/sync`, {
    script,
    args,
  })
}

function getServerUrl() {
  let server = `http://${process.env.TEST_HOST || 'localhost'}`

  if ((process.env.FLOCCUS_TEST || '').includes('linkwarden')) {
    server = 'https://cloud.linkwarden.app'
  }
  if ((process.env.FLOCCUS_TEST || '').includes('karakeep')) {
    server = `http://${process.env.KARAKEEP_TEST_HOST}`
  }

  return server
}

async function appendKarakeepCredentials(server, params) {
  const createUserResp = await fetch(`${server}/api/trpc/users.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      json: {
        name: 'floccus',
        email: 'floccus@example.com',
        password: '12345678',
        confirmPassword: '12345678',
      }
    }),
  })

  console.log('Created karakeep user', await createUserResp.json())

  const apiKeyResp = await fetch(`${server}/api/trpc/apiKeys.exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      json: {
        keyName: 'karakeep',
        email: 'floccus@example.com',
        password: '12345678',
      }
    }),
  })
  const apiKey = await apiKeyResp.json()
  params.set('password', apiKey.result.data.json.key)
}

async function buildTestRoute() {
  const params = new URLSearchParams()
  const server = getServerUrl()

  params.set('grep', process.env.FLOCCUS_TEST || '')
  params.set('server', server)
  params.set('app_version', process.env.APP_VERSION || 'native')
  params.set('browser', 'android')
  params.set('test_url', process.env.TEST_URL || 'http://nextcloud/')
  params.set('ci', 'true')

  if (process.env.GOOGLE_API_REFRESH_TOKEN && (process.env.FLOCCUS_TEST || '').includes('google-drive')) {
    params.set('password', process.env.GOOGLE_API_REFRESH_TOKEN)
  }

  if (process.env.DROPBOX_API_REFRESH_TOKEN && (process.env.FLOCCUS_TEST || '').includes('dropbox')) {
    params.set('password', process.env.DROPBOX_API_REFRESH_TOKEN)
  }

  if ((process.env.FLOCCUS_TEST || '').includes('linkwarden')) {
    params.set('username', 'mk')
    params.set('password', process.env.LINKWARDEN_TOKEN || '')
  }

  if (process.env.FLOCCUS_TEST_SEED) {
    params.set('seed', process.env.FLOCCUS_TEST_SEED)
  }

  if ((process.env.FLOCCUS_TEST || '').includes('karakeep')) {
    await appendKarakeepCredentials(server, params)
  }

  return `#/test?${params.toString()}`
}

async function waitForTestBoot(sessionId) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < APPIUM_TIMEOUT) {
    try {
      const state = await executeScript(sessionId, `
        return {
          href: window.location.href,
          ready: Boolean(window.__floccusNativeTestReady),
          logs: window.floccusTestLogs ? window.floccusTestLogs.slice(window.floccusTestLogsLength || 0) : []
        }
      `)

      if (Array.isArray(state.logs)) {
        state.logs.forEach(entry => console.log(entry))
        await executeScript(sessionId, 'window.floccusTestLogsLength = window.floccusTestLogs ? window.floccusTestLogs.length : 0')
      }

      if (state.ready) {
        return
      }
    } catch (error) {
      console.log('Waiting for native test route:', error.message)
    }

    await sleep(1000)
  }

  throw new Error('Timed out while waiting for the native test route to boot')
}

async function streamLogsUntilFinished(sessionId) {
  let finishedLog = null

  while (!finishedLog) {
    await sleep(APPIUM_POLL_INTERVAL)
    const logs = await executeScript(sessionId, `
      var logs = window.floccusTestLogs ? window.floccusTestLogs.slice(window.floccusTestLogsLength || 0) : []
      window.floccusTestLogsLength = window.floccusTestLogs ? window.floccusTestLogs.length : 0
      return logs
    `)

    logs.forEach(entry => console.log(entry))
    finishedLog = logs.find(entry => entry.includes('FINISHED'))
  }

  if (finishedLog.includes('FAILED')) {
    throw new Error(finishedLog)
  }
}

;(async function() {
  let sessionId
  try {
    await waitForAppium()
    sessionId = await createSession()
    console.log('Created Appium session', sessionId)

    const webViewContext = await waitForWebViewContext(sessionId)
    console.log('Switching to context', webViewContext)
    await switchContext(sessionId, webViewContext)

    const route = await buildTestRoute()
    await executeScript(sessionId, 'window.location.hash = arguments[0]; return window.location.href', [route])
    console.log('Opened native test route', route)

    await waitForTestBoot(sessionId)
    await streamLogsUntilFinished(sessionId)

    await deleteSession(sessionId)
  } catch (error) {
    console.log(error)
    await deleteSession(sessionId)
    process.exit(1)
  }
})()
