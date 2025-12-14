if (typeof window.chrome === 'undefined') {
  window.chrome = {}
}
// Keep the connection alive by sending periodic messages
setInterval(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  window.chrome.runtime.sendMessage({
    type: 'ping-service-worker'
  }).catch((err) => {
    console.debug('Failed to ping service worker:', err)
  })
}, 25000) // Send message every 25 seconds

// Listen for messages from service worker
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
window.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'sync-progress') {
    sendResponse({ success: true })
  }
  return true // Keep message channel open
})