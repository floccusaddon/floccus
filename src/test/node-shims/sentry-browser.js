function createScope() {
  return {
    setExtra() {
      return undefined
    },
    setFingerprint() {
      return undefined
    },
    setLevel() {
      return undefined
    },
    setTag() {
      return undefined
    },
  }
}

export function captureException() {
  return undefined
}

export function captureFeedback() {
  return undefined
}

export function init() {
  return undefined
}

export function isInitialized() {
  return false
}

export function setContext() {
  return undefined
}

export function setTag() {
  return undefined
}

export function setUser() {
  return undefined
}

export function withScope(callback) {
  callback(createScope())
}

