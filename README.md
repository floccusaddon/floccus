# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus
![](https://raw.githubusercontent.com/marcelklehr/floccus/master/img/screen_firefox_options.png)

> Sync your browser bookmarks with Nextcloud

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

The goal of this project is to build a browser extension that syncs your browser data with [Nextcloud](http://nextcloud.com).

Historically this was once possible using [the mozilla sync app](https://github.com/owncloudarchive/mozilla_sync). However, it's [not very easy anymore](https://github.com/owncloudarchive/mozilla_sync/issues/33) to run your own sync server and it still would only work with firefox.

**News:** Floccus v2.0 can now sync all your bookmarks with all of your ginormous folder hierarchy. :weight_lifting_woman:

## Install
For this to work with your Nextcloud server, you need at least version v0.11 of the Bookmarks app installed. Once you've done that you can continue to install floccus in your browser as follows.

### Chrome
Not in the web store [yet](https://github.com/marcelklehr/floccus/issues/51).

You can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox
You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

### Firefox for Android
Floccus is not supported by Firefox for Android, [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility).

### Usage
After installation the options pane will pop up allowing you to create accounts and edit their settings. You will be able to access this pane at all times by clicking the floccus icon in the browser tool bar.
You can setup multiple nextcloud accounts and select a bookmark folder for each that should be synced with that account. Floccus will keep the bookmarks in sync with your nextcloud whenever you add or change them and will also sync periodically to pull the latest changes from the server.
If you want to sync all bookmarks in your browser you need to select the topmost untitled folder in the folder picker.
If something goes wrong during the sync process the floccus icon will sport a red exclamation mark. In the options pane you can then hover over the status text to get more information about the error.

#### Limitations
Note that currently you cannot sync the same folder with multiple accounts in order to avoid data corruption. If you sync the root folder with one account and sync a sub folder with a different account, that sub-folder will not be synced with the account connected to the root folder anymore.
Floccus yields an error if you attempt to sync a folder with duplicate bookmarks (two or more bookmarks of the same URL). Remove one of the bookmarks for floccus to resume normal functionality.

## What's with the name?
[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Donate
If you'd like to support the creation and maintenance of this software, consider donating.

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

## Contribute
All contributions, code, feedback and strategic advice, are welcome. If you have a question you can contact me directly via email or simply [open an issue](https://github.com/marcelklehr/floccus/issues/new) on the repository. I'm also always happy for people helping me test new features -- see the issues for announcements of beta versions.

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
(c) Marcel Klehr
MPL-2.0 (see LICENSE.txt)
