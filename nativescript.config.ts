import { NativeScriptConfig } from '@nativescript/core'

export default {
  id: 'org.handmadeideas.floccus',
  appPath: '.',
  appResourcesPath: 'resources',
  android: {
    markingMode: 'none',
    v8Flags: '--expose-gc',
    maxLogcatObjectSize: 9999,
  }
} as NativeScriptConfig
