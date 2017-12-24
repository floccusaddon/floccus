# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Cirrus Floccus
The goal of this project is to build a browser extension that syncs your browser data with [Nextcloud](http://nextcloud.com).

Historically this was once possible using [the mozilla sync owncloud app](https://github.com/owncloudarchive/mozilla_sync). However, Mozilla <del>did a Google</del> tried to improve Firefox Sync and dropped support for the old API. If you're into history, read [the owncloud issue on the topic](https://github.com/owncloudarchive/mozilla_sync/issues/33).

### Status
 - [x] Syncing bookmarks
 - [ ] Syncing History

Currently you can setup multiple nextcloud accounts and floccus will create bookmarks folders whose contents will be synced with the nextcloud bookmarks account. It cannot handle folders, yet. (This is planned, though.) You can move the synced folders anywhere and rename them at will, however.

Tested to work in both Firefox and Chromium. Doesn't work in Firefox for Android [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility). Requires nextcloud bookmarks app with at least version 0.10.

## Installation

### Chrome
Not in the web store yet.

You can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox
You can [install it on AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Beware that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

## Usage
After installation the options pane will pop up allowing you to create accounts and edit their settings. You will be able to access this pane at all times by clicking the floccus icon in the browser toolbar.

For every account that you connect floccus to, it will create a new folder the first time it is synced. This folder will act like a Dropbox for your bookmarks: Put them in there to have them be synced with nextcloud. After connecting your accounts, these folders should be inside the "Other bookmarks" (or similar) folder in your browser, they should be titled "Nextcloud (user@your.nextcloud.tld)".

Floccus doesn't sync all of the bookmarks in your browser, because you should be able to have multiple accounts with different bookmarks to sync with. You can rename and move this folder at will.

## Prior art
 * [OwnCloud Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-bookmarks/eomolhpeokmbnincelpkagpapjpeeckc?hl=en-US), which basically acts as a proxy to the Owncloud Bookmarks app -- it doesn't integrate the bookmarks into the browser experience.
 * [OwnCloud 8 Bookmarks for chrome](https://chrome.google.com/webstore/detail/owncloud-8-bookmarks/efdanaldnkagmbmcngfpnjfgmgjhbjhm?hl=en-US), which basically does the same thing as the above: it has a few more features, but a less attractive UI
 * [A firefox addon](https://github.com/mjanser/firefox-addon-owncloud-bookmarks) similar to this one, developed using the old SDK
 * [Mark Lindhout's WebDAV-Bookmark-Sync](https://github.com/marklindhout/WebDAV-Bookmark-Sync) is quite promising as he doesn't depend on the feature-poor [owncloud Bookmarks app](https://github.com/owncloud/bookmarks), however he hasn't implemented syncing, yet

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Support
If you'd like to support the creating and maintainance of this software, consider donating.

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

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
(c) 2016-2017 by Marcel Klehr
MPL 2.0

