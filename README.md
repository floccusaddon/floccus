# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Cirrus Floccus
The goal of this project is to build a browser extension that syncs your browser data with [Nextcloud](http://nextcloud.com).

Historically this was once possible using [the mozilla sync owncloud app](https://github.com/owncloudarchive/mozilla_sync). However, Mozilla <del>did a Google</del> tried to improve Firefox Sync and dropped support for the old API. If you're into history, read [the owncloud issue on the topic](https://github.com/owncloudarchive/mozilla_sync/issues/33).

### Status
 - [x] Syncing bookmarks
 - [ ] Syncing History

Currently you can setup one nextcloud account only and floccus will create a bookmarks folder whose contents will be synced with your nextcloud bookmarks. It cannot handle folders, yet. You can move the synced folder anywhere, however.

Tested to work in both Firefox and Chromium. Doesn't work in Firefox for Android [yet](http://arewewebextensionsyet.com). Requires nextcloud bookmarks app with at least version 0.10.

## Installation

### Chrome
Not in the web store yet.

You can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox
You can [install it on AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Beware that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

## Usage
After installation you'll be asked to enter the url and credentials to your nextcloud account. (If not, click on the new floccus icon in the browser toolbar.)

Floccus will sync your bookmarks every 25mins, so you'll have to wait a bit until the bookmarks folder is created. Afterwards you should find the bookmarks from nextcloud inside a new folder titled "Owncloud" (I know, I know, this will change in the next release). You can rename and move this folder at will. Don't create any folders within, though, as that is not supported, yet.

## Prior art
 * [OwnCloud Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-bookmarks/eomolhpeokmbnincelpkagpapjpeeckc?hl=en-US), which basically acts as a proxy to the Owncloud Bookmarks app -- it doesn't integrate the bookmarks into the browser experience.
 * [OwnCloud 8 Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-8-bookmarks/efdanaldnkagmbmcngfpnjfgmgjhbjhm?hl=en-US), which basically does the same thing as the above: it has a few more features, but a less attractive UI
 * [A firefox addon](https://github.com/mjanser/firefox-addon-owncloud-bookmarks) similar to this one, developed using the old SDK
 * [Mark Lindhout's WebDAV-Bookmark-Sync](https://github.com/marklindhout/WebDAV-Bookmark-Sync) is quite promising as he doesn't depend on the feature-poor [owncloud Bookmarks app](https://github.com/owncloud/bookmarks), however he hasn't implemented syncing, yet

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Development
### Setting up a dev environment
 * Clone this repository.
 * Install node.js and npm
 * In the root of your floccus repo, run `npm install && npm install -g gulp`
 * Run `gulp` to build
 * Install firefox developer edition and prepare it as follows: https://developer.mozilla.org/en-US/Add-ons/Setting_up_extension_development_environment

### Building
* `gulp`

### Releasing
Firefox expects a zip, for chrome do the following: https://developer.chrome.com/extensions/packaging (private key necessary!)

## License
(c) 2016 by Marcel Klehr
MPL 2.0

