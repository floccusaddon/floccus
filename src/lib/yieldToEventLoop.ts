export async function yieldToEventLoop() {
  if (process && process.versions.node) {
    // Eliminate randomness in node.js tests by not yielding to the event loop, which can cause tests to run in a different order
    return Promise.resolve()
  }
  // In production we need this to prevent the browser from killing the background worker
  await new Promise(resolve => setTimeout(resolve, 0))
}