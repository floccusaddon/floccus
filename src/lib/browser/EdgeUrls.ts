/**
 * Edge stores a bookmark created with a `chrome://` url as `edge://` (#2429).
 * Floccus never learns about that rewrite, so on the next sync it would read
 * `edge://...`, see a url that differs from the cache and push it to the server
 * as a user edit -- and Chrome can't open `edge://` urls.
 *
 * Reading Edge's internal urls back as `chrome://` keeps them stable: what
 * floccus wrote is what it reads, and the server only ever holds the `chrome://`
 * form, which Edge rewrites on its own whenever it creates the bookmark.
 */

const EDGE_SCHEME = /^edge:/i

export function isEdge(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /\bEdgA?\//.test(userAgent)
}

export function edgeUrlToChrome(url: string): string {
  if (typeof url !== 'string' || !EDGE_SCHEME.test(url)) {
    return url
  }
  return url.replace(EDGE_SCHEME, 'chrome:')
}
