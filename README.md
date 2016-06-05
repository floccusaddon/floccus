# Floccus
The goal of this project is to build a browser extension that syncs your browser data with [OwnCloud](http://owncloud.org).

Historically this was once possible using [the mozilla sync owncloud app](https://github.com/owncloudarchive/mozilla_sync). However, Mozilla <del>did a Google</del> tried to improve Firefox Sync and dropped support for the old API. If you're into history, read [the owncloud issue on the topic](https://github.com/owncloudarchive/mozilla_sync/issues/33).

### Status
 - [ ] Syncing bookmarks *(works one way; blocked by [owncloud/bookmarks#218](https://github.com/owncloud/bookmarks/pull/218); perhaps M. Lindhout's approach is better)*
 - [ ] Syncing History

I'm trying to use the WebExtensions API as much as possible in order to support both Firefox and Chromium.

## Prior art
 * [OwnCloud Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-bookmarks/eomolhpeokmbnincelpkagpapjpeeckc?hl=en-US), which adds its own interface for owncloud's Bookmarks app and *only* "syncs" those bookmarks.
 * [OwnCloud 8 Bookmarks](https://chrome.google.com/webstore/detail/owncloud-8-bookmarks/efdanaldnkagmbmcngfpnjfgmgjhbjhm?hl=en-US), which basically does the same thing: it has a few more features, but a less attractive UI
 * [A firefox addon](https://github.com/mjanser/firefox-addon-owncloud-bookmarks) similar to this one, developed using the old SDK
 * [Mark Lindhout's WebDAV-Bookmark-Sync](https://github.com/marklindhout/WebDAV-Bookmark-Sync) is quite promising as he doesn't depend on the feature-poor [owncloud Bookmarks app](https://github.com/owncloud/bookmarks), however he hasn't implemented syncing, yet

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## License
(c) 2016 by Marcel Klehr
MPL 2.0
