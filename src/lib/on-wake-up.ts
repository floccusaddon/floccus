const CLOCK = 1000
const TIMEOUT = 2 * 60 * 1000 // 2 mins

export function onWakeUp(fn: () => void) {
  let then = Date.now()
  const interval = setInterval(tick, CLOCK)
  return clear

  function clear() {
    clearInterval(interval)
  }

  function tick() {
    const now = Date.now()
    if (now - then > TIMEOUT) fn()
    then = now
  }
}