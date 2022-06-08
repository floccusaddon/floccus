export function getIcons(html, pageUrl) {
  const url = new URL(pageUrl)
  const parser = new DOMParser()
  const document = parser.parseFromString(html, 'text/html')
  var links = document.getElementsByTagName('link')
  var icons = []

  for (var i = 0; i < links.length; i++) {
    var link = links[i]

    // Technically it could be null / undefined if someone didn't set it!
    // People do weird things when building pages!
    var rel = link.getAttribute('rel')
    if (rel) {
      // I don't know why people don't use indexOf more often
      // It is faster than regex for simple stuff like this
      // Lowercase comparison for safety
      if (rel.toLowerCase().indexOf('icon') > -1) {
        var href = link.getAttribute('href')

        // Make sure href is not null / undefined
        if (href) {
          // Relative
          // Lowercase comparison in case some idiot decides to put the
          // https or http in caps
          // Also check for absolute url with no protocol
          if (href.toLowerCase().indexOf('https:') === -1 && href.toLowerCase().indexOf('http:') === -1 &&
            href.indexOf('//') !== 0) {
            // This is of course assuming the script is executing in the browser
            // Node.js is a different story! As I would be using cheerio.js for parsing the html instead of document.
            // Also you would use the response.headers object for Node.js below.

            var absoluteHref = url.protocol + '//' + url.host

            if (url.port) {
              absoluteHref += ':' + url.port
            }

            // We already have a forward slash
            // On the front of the href
            if (href.indexOf('/') === 0) {
              absoluteHref += href
            } else {
              // We don't have a forward slash
              // It is really relative!
              var path = url.pathname.split('/')
              path.pop()
              var finalPath = path.join('/')

              absoluteHref += finalPath + '/' + href
            }
            icons.push(absoluteHref)
          } else if (href.indexOf('//') === 0) {
            // Absolute url with no protocol
            var absoluteUrl = url.protocol + href
            icons.push(absoluteUrl)
          } else {
            // Absolute
            icons.push(href)
          }
        }
      }
    }
  }

  icons.push(url.protocol + '//' + url.host + '/favicon.ico')

  return icons
}
