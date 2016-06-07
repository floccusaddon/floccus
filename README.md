# Cirrus Floccus
The goal of this project is to build a browser extension that syncs your browser data with [OwnCloud](http://owncloud.org).

Historically this was once possible using [the mozilla sync owncloud app](https://github.com/owncloudarchive/mozilla_sync). However, Mozilla <del>did a Google</del> tried to improve Firefox Sync and dropped support for the old API. If you're into history, read [the owncloud issue on the topic](https://github.com/owncloudarchive/mozilla_sync/issues/33).

### Status
 - [x] Syncing bookmarks (with the Bookmarks app, no folders :/)
 - [ ] Syncing History

Tested to work in both Firefox and Chromium.

### Roadmap
I will explore alternatives to ownCloud's default Bookmark app, mostly because it's not very elegant to access until [owncloud/bookmarks#218](https://github.com/owncloud/bookmarks/pull/218) is in. One alternative that would be very rewarding due to its interoperability appeal / standards compatibility is using WebDAV as a syncing backend.

## Prior art
 * [OwnCloud Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-bookmarks/eomolhpeokmbnincelpkagpapjpeeckc?hl=en-US), which basically acts as a proxy to the Owncloud Bookmarks app -- it doesn't integrate the bookmarks into the browser experience.
 * [OwnCloud 8 Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-8-bookmarks/efdanaldnkagmbmcngfpnjfgmgjhbjhm?hl=en-US), which basically does the same thing as the above: it has a few more features, but a less attractive UI
 * [A firefox addon](https://github.com/mjanser/firefox-addon-owncloud-bookmarks) similar to this one, developed using the old SDK
 * [Mark Lindhout's WebDAV-Bookmark-Sync](https://github.com/marklindhout/WebDAV-Bookmark-Sync) is quite promising as he doesn't depend on the feature-poor [owncloud Bookmarks app](https://github.com/owncloud/bookmarks), however he hasn't implemented syncing, yet

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## License
(c) 2016 by Marcel Klehr
MPL 2.0
