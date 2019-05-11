# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus [![Backers on Open Collective](https://opencollective.com/floccus/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/floccus/sponsors/badge.svg)](#sponsors) 

![](https://raw.githubusercontent.com/marcelklehr/floccus/master/img/screen_firefox_options.png)

> Sync your bookmarks across browsers via Nextcloud, WebDAV or a local file (and thus any file sync solution)

The goal of this project is to build a browser extension that syncs your browser data across browser vendors.

**News:** Floccus can now sync with the local file system using LoFloccus (read below).

[![Chrome Webstore](https://developer.chrome.com/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chrome.google.com/webstore/detail/floccus/fnaicdffflnofjppbagibeoednhnbjhg)|
[![Mozilla Addons](https://addons.cdn.mozilla.net/static/img/addons-buttons/AMO-button_2.png)](https://addons.mozilla.org/en-US/firefox/addon/floccus/)
|-------------------|----------------------------|
<img align="left" src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img align="right" src="https://img.shields.io/chrome-web-store/rating/fnaicdffflnofjppbagibeoednhnbjhg.svg">| <img align="left" src="https://img.shields.io/amo/users/passman.svg"> <img align="right" src="https://img.shields.io/amo/rating/passman.svg">

## Install

At least one browser and the floccus browser extension.

The following sync methods are available:

- **WebDAV**: If you have a WebDAV server at hand, like any version of nextcloud/owncloud, box.com or with any other WebDAV server, commercial or self-hosted.
- **Nextcloud Bookmarks**: Nextcloud in particular also sports a dedicated bookmarks app, which allows you to also access your bookmarks via a nice web UI. For this to work with floccus, you need v0.11 of the Bookmarks app installed (which requires at least nextcloud v12).
- **Local file and more**: You can also just sync with a local file, using [the companion desktop app LoFloccus](https://github.com/TCB13/LoFloccus). You can then also sync that file to other computers using your favorite file syncing solution, like Dropbox, Syncthing, rsync, etc.

Once your server or the LoFloccus app is ready, read on for the browser of your choosing.

**Note:** It is recommended to not enable native bookmark synchronization built into your browser, as it is known to cause issues.

**Note:** Please avoid installing the bookmarks_fulltextsearch app in nextcloud as it is known to cause issues with newer versions of the bookmarks app.

### Chrome

You can [install it via the Chrome Web store](https://chrome.google.com/webstore/detail/floccus-nextcloud-sync/fnaicdffflnofjppbagibeoednhnbjhg)

Alternatively, you can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox

You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

### Android

Floccus is not supported by Firefox for Android [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility). **But**, why wait for mozilla, if you can use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser), which supports floccus! Install instructions are the same as for Chrome.

### Ugrading

#### Updating from v2.x to v3.0

It is recommended to remove all of your bookmarks from your accounts before using the new version, deleting the accounts and then to create them again, in order to prevent unforeseen problems!

#### Updating from v3.0 to v3.1

When using a WebDAV account, there's nothing you need to do to benefit from the new order preservation feature. If you are using the nextcloud adapter, it is recommended that you switch to the new nextcloud adapter, which works with the Bookmarks folders feature and also preserves ordering.

#### Switching from tag-based to folder-based syncing

The first sync method available with floccus syncs folders by creating associated tags on the server, which contain the folder's path. Since then the Nextcloud Bookmarks app supports folders natively and floccus has a new matching sync method. Here's how you switch to the new method:

1. Back up your browser bookmarks
2. _Remove the active floccus account_ for your nextcloud in _all_ browsers
3. Remove all bookmarks on nextcloud (there's an option for that in the settings)
4. Setup a new floccus sync account with the adapter that says "with folders" (as opposed to "legacy") in one browser
5. Trigger a sync run to create the bookmarks and folders on the server
6. Make sure everything is as expected on the server
7. Setup floccus sync accounts in all other browsers with the "with folders"-adapter
8. Done.

### Permissions

Floccus requests the following permissions:

| Permission           | Explanation                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage              | Necessary for maintaining a cache and mappings between server and browser bookmarks                                                                                                                                                                                                                                                                                  |
| alarms               | Necessary for triggering synchronization in regular intervals                                                                                                                                                                                                                                                                                                        |
| bookmarks            | Necessary for creating and reading bookmarks                                                                                                                                                                                                                                                                                                                         |
| Unlimited web access | Necessary for accessing your self-hosted server. This cannot be limited, because everybody's server has a different URL. Unfortunately, the way webextensions work currently, floccus also gets access to all the data the browser has collected on those websites. However, floccus makes no use of that data and doesn't in any way collect information about you. |

## Usage

- **The accounts panel**; After installation the accounts pane will pop up allowing you to create and manage accounts. You will be able to access this pane at all times by clicking the floccus icon in the browser tool bar.
- **Your accounts**: You can setup multiple accounts and select a bookmark folder for each, that should be synced with that account. Floccus will keep the bookmarks in sync with the server you selected whenever you add or change them and will also sync periodically to pull the latest changes from the server.
- **Syncing the root folder**: If you want to sync all bookmarks in your browser you need to select the topmost untitled folder in the folder picker. (In case you're wondering: Syncing the root folder across browsers from different vendors is now possible out of the box, because the built-in folder names are now normalized).

### The server path: Mapping folders / Profiles

When using the nextcloud Bookmarks adapter, you can specify a 'server folder' in your floccus account setup. This is like the target folder of a copy or rsync command. While the local sync folder you have selected from your browser bookmarks will normally end up being synced to the root bookmark path on your server, you can change that to an arbitrary sub-directory, e.g. /Toolbar, with the 'server folder' setting. If you are using the WebDAV/XBEL adapter, you can do the same by specifying a specific xbel file in the settings.

This way it is possible to sync Firefox' 'Bookmarks Menu' folder to Chrome, which doesn't have a Menu folder out of the box: Simply set up a separate account for each of the main folders in firefox, each with a separate server folder, e.g.:

- Fx '/Bookmarks Toolbar' <=> '/Toolbar'
  - Fx '/Other Bookmarks' <=> '/Others'
  - Fx '/Bookmarks Menu' <=> '/Menu'

Then, in Chrome you can setup the folders as follows:

- GC '/Bookmarks Toolbar' <=> '/Toolbar'
- GC '/Bookmarks Toolbar/Menu' <=> '/Menu' (You need to create this folder yourself, of course.)
  - GC '/Other Bookmarks' <=> '/Others'

### Limitations

- Note that currently you cannot sync the same folder with multiple nextcloud accounts in order to avoid data corruption. If you sync the root folder with one account and sync a sub folder with a different account, that sub-folder will not be synced with the account connected to the root folder anymore.

### Performance

Performance is an aspect that I try to tackle with gradual improvements. The latest development here is the "parallel sync" option that processes multiple branches of the bookmarks tree in parallel. The benchmark results in this case are as follows:

| adapter           | cold sync (3000 Bookmarks) | warm sync (3000 Bookmarks) |
| ----------------- | -------------------------- | -------------------------- |
| nextcloud-folders | ~20min                     | ~4min                      |
| webdav            | ~3min                      | ~2min                      |

**Note**: The cold sync performance of the nextcloud-folders adapter depends to an extent on the server's resources as well, such that parallel syncing is not always faster in this case.

### Finding duplicates

Floccus will sync your bookmarks as-is, including any dupes that are in different folders. If you need to find and remove duplicates in your bookmarks, try something like [bookmark-dupes](https://addons.mozilla.org/en-US/firefox/addon/bookmark-dupes).

### Troubleshooting

- **Emojis**: MySQL doesn't support emojis out of the box, so if you're syncing to nextcloud and getting Error code 500 from nextcloud, check the nextcloud log for SQL errors and [proceed as explained in the nextcloud docs](https://docs.nextcloud.com/server/stable/admin_manual/configuration_database/mysql_4byte_support.html).

## Considerations

Is this a good idea? I think so. If you'd like to know more, check out [the considerations file](./CONSIDERATIONS.md)

## What's with the name?

[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Donate

If you'd like to support the creation and maintenance of this software, please consider donating. :)

| [<img src="https://img.shields.io/badge/paypal-donate-blue.svg?logo=paypal&style=for-the-badge">](https://www.paypal.me/marcelklehr1) | [<img src="http://img.shields.io/liberapay/receives/marcelklehr.svg?logo=liberapay&style=for-the-badge">](https://liberapay.com/marcelklehr/donate) | [![](https://opencollective.com/floccus/tiers/backer.svg?avatarHeight=36)](https://opencollective.com/floccus) |
| :-----------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------: |


## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
| [<img src="https://avatars2.githubusercontent.com/u/7296506?v=4" width="70px;" alt="Bernd Wechner"/><br /><sub><b>Bernd Wechner</b></sub>](https://github.com/bernd-wechner)<br />[🐛](https://github.com/marcelklehr/floccus/issues?q=author%3Abernd-wechner "Bug reports") [🤔](#ideas-bernd-wechner "Ideas, Planning, & Feedback") [⚠️](https://github.com/marcelklehr/floccus/commits?author=bernd-wechner "Tests") | [<img src="https://avatars0.githubusercontent.com/u/9746421?v=4" width="70px;" alt="jlbprof"/><br /><sub><b>jlbprof</b></sub>](https://github.com/jlbprof)<br />[💻](https://github.com/marcelklehr/floccus/commits?author=jlbprof "Code") [🐛](https://github.com/marcelklehr/floccus/issues?q=author%3Ajlbprof "Bug reports") [⚠️](https://github.com/marcelklehr/floccus/commits?author=jlbprof "Tests") | [<img src="https://avatars2.githubusercontent.com/u/1771400?v=4" width="70px;" alt="TeutonJon78"/><br /><sub><b>TeutonJon78</b></sub>](https://github.com/TeutonJon78)<br />[🐛](https://github.com/marcelklehr/floccus/issues?q=author%3ATeutonJon78 "Bug reports") [🤔](#ideas-TeutonJon78 "Ideas, Planning, & Feedback") | [<img src="https://avatars1.githubusercontent.com/u/9087223?v=4" width="70px;" alt="Scott P."/><br /><sub><b>Scott P.</b></sub>](https://github.com/skewty)<br />[🐛](https://github.com/marcelklehr/floccus/issues?q=author%3Askewty "Bug reports") [🤔](#ideas-skewty "Ideas, Planning, & Feedback") | [<img src="https://avatars1.githubusercontent.com/u/10448369?v=4" width="70px;" alt="Lantizia"/><br /><sub><b>Lantizia</b></sub>](https://github.com/Lantizia)<br />[🐛](https://github.com/marcelklehr/floccus/issues?q=author%3ALantizia "Bug reports") [🤔](#ideas-Lantizia "Ideas, Planning, & Feedback") | [<img src="https://avatars1.githubusercontent.com/u/6315832?v=4" width="70px;" alt="TCB13"/><br /><sub><b>TCB13</b></sub>](https://iklive.eu)<br />[💻](https://github.com/marcelklehr/floccus/commits?author=TCB13 "Code") [🤔](#ideas-TCB13 "Ideas, Planning, & Feedback") [🔌](#plugin-TCB13 "Plugin/utility libraries") |
| :---: | :---: | :---: | :---: | :---: | :---: |

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification.

## Contribute

All contributions, code, feedback and strategic advice, are welcome. If you have a question you can contact me directly via email or simply [open an issue](https://github.com/marcelklehr/floccus/issues/new) on the repository. I'm also always happy for people helping me test new features -- see the issues for announcements of beta versions.

### Translating

Translations can now be provided over at [transifex](https://www.transifex.com/floccus/floccus/).

![](https://www.transifex.com/projects/p/floccus/resource/messages-json--develop/chart/image_png)

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

## Contributors

This project exists thanks to all the people who contribute. 
<a href="https://github.com/marcelklehr/floccus/graphs/contributors"><img src="https://opencollective.com/floccus/contributors.svg?width=890&button=false" /></a>


## Backers

Thank you to all our backers! 🙏 [[Become a backer](https://opencollective.com/floccus#backer)]

<a href="https://opencollective.com/floccus#backers" target="_blank"><img src="https://opencollective.com/floccus/backers.svg?width=890"></a>


## Sponsors

Support this project by becoming a sponsor. Your logo will show up here with a link to your website. [[Become a sponsor](https://opencollective.com/floccus#sponsor)]

<a href="https://opencollective.com/floccus/sponsor/0/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/1/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/2/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/3/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/4/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/5/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/6/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/7/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/8/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/floccus/sponsor/9/website" target="_blank"><img src="https://opencollective.com/floccus/sponsor/9/avatar.svg"></a>



## License

(c) Marcel Klehr  
MPL-2.0 (see LICENSE.txt)
