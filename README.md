# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus
![](https://raw.githubusercontent.com/marcelklehr/floccus/master/img/screen_firefox_options.png)

> Sync your browser bookmarks with Nextcloud

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

The goal of this project is to build a browser extension that syncs your browser data with [Nextcloud](http://nextcloud.com).

Historically this was once possible using [the mozilla sync app](https://github.com/owncloudarchive/mozilla_sync). However, it's [not very easy anymore](https://github.com/owncloudarchive/mozilla_sync/issues/33) to run your own sync server and it still would only work with firefox.

**News:** Floccus v2.0 can now sync all your bookmarks with all of your ginormous folder hierarchy. :weight_lifting_woman:

## Install
For this to work with your Nextcloud server, you need at least version v0.11 of the Bookmarks app installed. Once you've done that you can continue to install floccus in your browser as follows.

**Note:** It is recommended to not enable native bookmark synchronization built into your browser, as it is known to cause issues.

### Chrome
Not in the web store [yet](https://github.com/marcelklehr/floccus/issues/51).

You can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.


#### Updating from 1.x to v2.0
It is recommended to remove all of your bookmarks from your accounts before updating floccus, deleting them and after updating to reconnect them again, in order to prevent unforeseen problems!

### Firefox
You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

#### Updating from 1.x to v2.0
It is recommended to remove all of your bookmarks from your accounts before updating floccus, deleting them and after updating to reconnect them again, in order to prevent unforeseen problems!

### Firefox for Android
Floccus is not supported by Firefox for Android, [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility).


## Usage
After installation the options pane will pop up allowing you to create accounts and edit their settings. You will be able to access this pane at all times by clicking the floccus icon in the browser tool bar.
You can setup multiple nextcloud accounts and select a bookmark folder for each that should be synced with that account. Floccus will keep the bookmarks in sync with your nextcloud whenever you add or change them and will also sync periodically to pull the latest changes from the server.
If you want to sync all bookmarks in your browser you need to select the topmost untitled folder in the folder picker.
If something goes wrong during the sync process the floccus icon will sport a red exclamation mark. In the options pane you can then hover over the status text to get more information about the error.

### Limitations
 * Note that currently you cannot sync the same folder with multiple nextcloud accounts in order to avoid data corruption. If you sync the root folder with one account and sync a sub folder with a different account, that sub-folder will not be synced with the account connected to the root folder anymore.
 * Floccus yields an error if you attempt to sync a folder with duplicate bookmarks (two or more bookmarks of the same URL). Remove one of the bookmarks for floccus to resume normal functionality.

## Goals and Limitations aka. Is this a good idea?
As there have been debates about whether this software product is a good idea, I've made a little section here with my considerations.

### Goals
The goals of this piece of software

 * provide an open cross-platform sync solution for browser data with nextcloud
 * performance is a plus, but not necessary
 * (eventual) consistency is more important than intention preservation (i.e. when ever a mistake happens during sync, it's guaranteed to be eventually consistent on all sites)


### Current status and Limitations
The WebExtensions bookmarks API has a few limitations:

1. No support for batching or transactions
2. Record GUIDs can change, but are only known to change when Firefox Sync is used.
3. The data format doesn't represent descriptions, tags or separators
4. No way to create a per-device folder
5. It's impossible to express safe operations, because there are no compare-and-set primitives.
6. Triggering a sync after the first change, causing repeated syncs and inconsistency to spread to other devices.

Nonetheless, I've chosen to utilize the WebExtensions API for implementing this sync client. As I'm aware, this decision has (at least) the following consequences:
1. No transaction support (\#1) leads to bad performance
2. No support for transactions (\#1) also can potentially cause intermediate states to be synced. However, all necessary precautions are taken to prevent this and even in the case that this happens, all sites will be eventually consistent, allowing you to manually resolve possible problems after the fact.
3. Due to the modification of GUIDs (\#2), usage of Firefox Sync along with Floccus is discouraged.
4. The incomplete data format (\#3) is an open problem, but doesn't impact the synchronization of the remaining accessible data.
5. The inability to exclude folders from sync in 3rd-party extensions (\#4) is a problem, but manageable when users are able to manually choose folders to ignore. (Currently not implemented)
6. The lack of safe write operations (\#5) can be dealt with similarly to the missing transaction support: Changes made during sync could lead to an unintended but consistent state, which can be resolved manually. Additionally, precautions are taken to prevent this.
7. In order to avoid syncing prematurely (\#6) floccus can employ a timeout to wait until all pending bookmarks operations are done. (Currently not implemented.)

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
