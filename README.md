# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus

![](https://raw.githubusercontent.com/marcelklehr/floccus/master/img/screen_firefox_options.png)

> Sync your browser bookmarks with Nextcloud

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

The goal of this project is to build a browser extension that syncs your browser data across browser vendors with the open source, self-hosted sync and share server [Nextcloud](https://nextcloud.com) and possibly other self-hosted solutions.

**News:** Floccus v3.0 now allows you to sync duplicate bookmarks in different folders and can sync accross browser vendors without any hassle. :weight_lifting_woman: Additionally you can now sync with any WebDAV server you want, not just with the nextcloud bookmarks app.

[![Chrome Webstore](https://developer.chrome.com/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chrome.google.com/webstore/detail/floccus/fnaicdffflnofjppbagibeoednhnbjhg)|
[![Mozilla Addons](https://addons.cdn.mozilla.net/static/img/addons-buttons/AMO-button_2.png)](https://addons.mozilla.org/en-US/firefox/addon/floccus/)
|-------------------|----------------------------|
<img align="left" src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img align="right" src="https://img.shields.io/chrome-web-store/rating/fnaicdffflnofjppbagibeoednhnbjhg.svg">| <img align="left" src="https://img.shields.io/amo/users/passman.svg"> <img align="right" src="https://img.shields.io/amo/rating/passman.svg">

## Install

You will need a server, at least one browser and the floccus browser extension.

You can either choose to sync via WebDAV (with any version of nextcloud or with any other WebDAV server, commercial or self-hosted).
Alternatively, if you'd like to access your bookmarks via a nice web frontend, you can sync with the nextcloud bookmarks app, which allows you to do just that. For the latter to work, you need at least version v0.11 of the Bookmarks app installed (which requires nextcloud v12 or greater).

Once you have your server ready, read on to install the browser extension.

**Note:** It is recommended to not enable native bookmark synchronization built into your browser, as it is known to cause issues.

### Chrome

You can [install it via the Chrome Web store](https://chrome.google.com/webstore/detail/floccus-nextcloud-sync/fnaicdffflnofjppbagibeoednhnbjhg)

Alternatively, you can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

#### Updating from 2.x to v3.0

It is recommended to remove all of your bookmarks from your accounts before using the new version, deleting the accounts and then to create them again, in order to prevent unforeseen problems!

### Firefox

You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

#### Updating from v2.x to v3.0

It is recommended to remove all of your bookmarks from your accounts before using the new version, deleting the accounts and then to create them again, in order to prevent unforeseen problems!

### Firefox for Android

Floccus is not supported by Firefox for Android, [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility).

## Usage

- **The accounts panel**; After installation the accounts pane will pop up allowing you to create and manage accounts. You will be able to access this pane at all times by clicking the floccus icon in the browser tool bar.
- **Your accounts**: You can setup multiple accounts and select a bookmark folder for each, that should be synced with that account. Floccus will keep the bookmarks in sync with the server you selected whenever you add or change them and will also sync periodically to pull the latest changes from the server.
- **Syncing the root folder**: If you want to sync all bookmarks in your browser you need to select the topmost untitled folder in the folder picker. (In case you're wondering: Syncing the root folder across browsers from different vendors is now possible out of the box, because the built-in folder names are now normalized).

### Limitations

- Note that currently you cannot sync the same folder with multiple nextcloud accounts in order to avoid data corruption. If you sync the root folder with one account and sync a sub folder with a different account, that sub-folder will not be synced with the account connected to the root folder anymore.

## Considerations

Is this a good idea? I think so. If you'd like to know more, check out [the considerations file](./CONSIDERATIONS.md)

## What's with the name?

[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Donate

If you'd like to support the creation and maintenance of this software, consider donating.

<a href="https://liberapay.com/marcelklehr/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a>

## Contribute

All contributions, code, feedback and strategic advice, are welcome. If you have a question you can contact me directly via email or simply [open an issue](https://github.com/marcelklehr/floccus/issues/new) on the repository. I'm also always happy for people helping me test new features -- see the issues for announcements of beta versions.

### Setting up a dev environment

- Clone this repository.
- Install node.js and npm
- In the root of your floccus repo, run `npm install && npm install -g gulp`
- Run `gulp` to build
- Install firefox developer edition and prepare it as follows: https://developer.mozilla.org/en-US/Add-ons/Setting_up_extension_development_environment

### Building

- `gulp`

### Releasing

Firefox expects a zip, for chrome do the following: https://developer.chrome.com/extensions/packaging (private key necessary!)

## License

(c) Marcel Klehr  
MPL-2.0 (see LICENSE.txt)
