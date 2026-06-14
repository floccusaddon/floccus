export async function yieldToEventLoop() {
  await new Promise(resolve => setTimeout(resolve, 0))
}