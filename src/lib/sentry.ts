import packageJson from '../../package.json'
import * as Sentry from '@sentry/browser'
import { Capacitor } from '@capacitor/core'

Sentry.setTag('platform', Capacitor.getPlatform())

export const dsn = 'https://836f0f772fbf2e12b9dd651b8e6b6338@o4507214911307776.ingest.de.sentry.io/4507216408870992'

export function initEmpty() {
  Sentry.init({
    dsn: dsn,
    integrations: [],
    sampleRate: 0,
    release: packageJson.version,
    debug: true,
  })
}

export function initSharp() {
  Sentry.init({
    dsn: dsn,
    integrations: [],
    sampleRate: 0.15,
    release: packageJson.version,
    debug: true,
  })
}