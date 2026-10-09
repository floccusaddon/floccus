export async function yieldToEventLoop() {
  if (process && process.versions.node) {
    // Eliminate randomness in node.js tests by not yielding to the event loop, which can cause tests to run in a different order
    return Promise.resolve()
  }
  // In production we need this to prevent the browser from killing the background worker.
  // We must not use setTimeout for this: Timers in hidden pages (e.g. the background page in WebKit-based
  // browsers like Orion) are throttled to a second or more, which turns a sync of seconds into one of minutes (#2153)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduler = (self as any).scheduler
  if (scheduler && typeof scheduler.yield === 'function') {
    await scheduler.yield()
    return
  }
  if (typeof MessageChannel !== 'undefined') {
    // A message to ourselves is delivered in a new task, without the clamping and throttling that timers get
    await new Promise<void>(resolve => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
    return
  }
  await new Promise(resolve => setTimeout(resolve, 0))
}
