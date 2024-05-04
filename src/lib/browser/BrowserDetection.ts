export const isVivaldi = async() => {
  const {default: browser} = await import('../browser-api.js')
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  return Boolean(tabs?.[0]?.['vivExtData'])
}
