const CLOCK = 1000

export function onWakeUp(fn: () => void) {
  let then = Date.now()
  const interval = setInterval(tick, CLOCK)
  return clear

  function clear() {
    clearInterval(interval)
  }

  function tick() {
    const now = Date.now()
    if (now - then > 2 * CLOCK) fn()
    then = now
  }
}