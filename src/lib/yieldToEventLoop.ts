import { isTest } from './isTest'

export async function yieldToEventLoop() {
  if (isTest) {
    // Eliminate randomness in tests by not yielding to the event loop, which can cause tests to run in a different order
    return Promise.resolve()
  }
  // In production we need this to prevent the browser from killing the background worker
  await new Promise(resolve => setTimeout(resolve, 0))
}