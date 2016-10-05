# Cirrus Floccus
The goal of this project is to build a browser extension that syncs your browser data with [OwnCloud](http://owncloud.org).

Historically this was once possible using [the mozilla sync owncloud app](https://github.com/owncloudarchive/mozilla_sync). However, Mozilla <del>did a Google</del> tried to improve Firefox Sync and dropped support for the old API. If you're into history, read [the owncloud issue on the topic](https://github.com/owncloudarchive/mozilla_sync/issues/33).

### Status
 - [x] Syncing bookmarks (with the Bookmarks app, no folders :/)
 - [ ] Syncing History

Tested to work in both Firefox and Chromium.

## Installation

### Chrome
Not in the web store yet.

You can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox
You can [install it on AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

## Roadmap
Clearly, owncloud's default bookmarks app is rather rudimentary. The [roadmap for version 2](https://github.com/marcelklehr/floccus/issues/1) comprises end-to-end encryption and support for syncing browsing history.

## Prior art
 * [OwnCloud Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-bookmarks/eomolhpeokmbnincelpkagpapjpeeckc?hl=en-US), which basically acts as a proxy to the Owncloud Bookmarks app -- it doesn't integrate the bookmarks into the browser experience.
 * [OwnCloud 8 Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-8-bookmarks/efdanaldnkagmbmcngfpnjfgmgjhbjhm?hl=en-US), which basically does the same thing as the above: it has a few more features, but a less attractive UI
 * [A firefox addon](https://github.com/mjanser/firefox-addon-owncloud-bookmarks) similar to this one, developed using the old SDK
 * [Mark Lindhout's WebDAV-Bookmark-Sync](https://github.com/marklindhout/WebDAV-Bookmark-Sync) is quite promising as he doesn't depend on the feature-poor [owncloud Bookmarks app](https://github.com/owncloud/bookmarks), however he hasn't implemented syncing, yet

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Building
Firefox expects a zip, for chrome do the following: https://developer.chrome.com/extensions/packaging (private key necessary!)

## License
(c) 2016 by Marcel Klehr
MPL 2.0
