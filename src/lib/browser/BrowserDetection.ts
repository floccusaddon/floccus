import browser from '../browser-api'

export const isVivaldi = async() => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return Boolean(tabs?.[0]?.['vivExtData'])
}
