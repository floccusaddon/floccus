function isWebUrl(str) {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (e) {
    return false
  }
}

/**
 * Check that the supplied string is a valid URL. If not, look for a
 * URL at the end of the string, to match the input we see from the
 * Share action in some apps.
 */
export function findUrl(url) {
  try {
    // If we can parse this string as a URL, we are done.
    // eslint-disable-next-line no-new
    new URL(url)
    return url
  } catch (e1) {
    // noop
  }
  // If not, see whether we can find a URL at the end of this string.
  // This happens e.g. when we share from the Amazon Shopping app.
  const lastWord = url.trim().split(' ').slice(-1)[0]
  try {
    // eslint-disable-next-line no-new
    new URL(lastWord)
    // The last word is a URL - return it
    return lastWord
  } catch (e2) {
    // noop
  }
  const indexOfHttp = url.lastIndexOf('http')
  if (indexOfHttp > 0) {
    const couldBeUrl = url.substring(indexOfHttp)
    try {
      // eslint-disable-next-line no-new
      new URL(couldBeUrl)
      return couldBeUrl
    } catch (e3) {
      // noop
    }
  }
  // We didn't find a valid URL - return our input unchanged
  return url
}

/**
 * Find the URLs in a shared text. Sharing several tabs from Firefox for
 * Android sends a single text with one URL per line, which the URL parser
 * would happily accept as one URL, because it drops line breaks.
 */
export function extractSharedUrls(text) {
  if (!text) {
    return []
  }
  const urls = text.split(/\s+/).filter(isWebUrl)
  if (urls.length > 1) {
    return [...new Set(urls)]
  }
  return [findUrl(text.trim())]
}
