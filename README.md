# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus

![](https://raw.githubusercontent.com/marcelklehr/floccus/master/img/screen_chrome_options.png)

> Sync your bookmarks across browsers via Nextcloud, WebDAV or a local file (and thus any file sync solution)

The goal of this project is to build a browser extension that syncs your browser data across browser vendors.

**News:** Floccus can now sync with the local file system using LoFloccus (read below).

[![Tests](https://github.com/marcelklehr/floccus/workflows/Tests/badge.svg)](https://github.com/marcelklehr/floccus/actions?query=workflow%3ATests)

[![Chrome Webstore](https://developer.chrome.com/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chrome.google.com/webstore/detail/floccus/fnaicdffflnofjppbagibeoednhnbjhg)|[![Mozilla Addons](https://addons.cdn.mozilla.net/static/img/addons-buttons/AMO-button_2.png)](https://addons.mozilla.org/en-US/firefox/addon/floccus/)|[<img alt="Microsoft Edge" src="https://developer.microsoft.com/en-us/store/badges/images/English_get-it-from-MS.png" height="45" />](https://microsoftedge.microsoft.com/addons/detail/gjkddcofhiifldbllobcamllmanombji)|
|---|-----|---|
|<img align="left" src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img align="right" src="https://img.shields.io/chrome-web-store/rating/fnaicdffflnofjppbagibeoednhnbjhg.svg">| <img align="left" src="https://img.shields.io/amo/users/floccus.svg"> <img align="right" src="https://img.shields.io/amo/rating/floccus.svg">||

## Community

Talk to us on [gitter](https://gitter.im/marcelklehr/floccus)! :wave:

## Install
The following sync methods are available:

- **WebDAV**: If you have a WebDAV server at hand, like any version of nextcloud/owncloud, box.com or with any other WebDAV server, commercial or self-hosted.
- **Nextcloud Bookmarks**: Nextcloud in particular also sports a dedicated bookmarks app, which allows you to also access your bookmarks via a nice web UI.
- **Local file and more**: You can also just sync with a local file, using [the companion desktop app LoFloccus](https://github.com/TCB13/LoFloccus). You can then also sync that file to other computers using your favorite file syncing solution, like Dropbox, Syncthing, rsync, etc. You can also create a WebDAV Server on the local machine using Docker in GNU/Linux, check out the project [Floccus-WebDavDocker](https://github.com/marlluslustosa/Floccus-WebDavDocker).

Once your server or the LoFloccus app is ready, read on for the browser of your choosing.

**Note:** It is recommended to not enable native bookmark synchronization built into your browser, as it is known to cause issues.

**Note:** Please avoid installing the bookmarks_fulltextsearch app in nextcloud as it is known to cause issues with newer versions of the bookmarks app.

**Note:** If you feel floccus is missing a sync backend and you'd like to chip in, check out the [Quick Intro to creating an adapter](https://github.com/marcelklehr/floccus/blob/develop/doc/Adapters.md). I'm happy to accept your pull request! :)

### Nextcloud
Floccus is regularly tested with the following setups:

|Nextcloud|Bookmarks|
|---|---|
|v17|v1.1.2|
|v17|v2.3.4|
|v18|v2.3.4|
|v19|v3.x|

Syncing via WebDAV should work with any Nextcloud version.

### Chrome

You can [install it via the Chrome Web store](https://chrome.google.com/webstore/detail/floccus-nextcloud-sync/fnaicdffflnofjppbagibeoednhnbjhg)

Alternatively, you can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox

You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

### Android

Floccus is not supported by Firefox for Android [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility). **But**, why wait for mozilla, if you can use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser), which supports floccus! Install instructions are the same as for Chrome.

### Ugrading

#### Upgrading from v3.x to v4.x
See "Switching from tag-based to folder-based syncing"

#### Updating from v3.0 to v3.1

When using a WebDAV account, there's nothing you need to do to benefit from the new order preservation feature. If you are using the nextcloud adapter, it is recommended that you switch to the new nextcloud adapter, which works with the Bookmarks folders feature and also preserves ordering.

#### Updating from v2.x to v3.0

It is recommended to remove all of your bookmarks from your accounts before using the new version, deleting the accounts and then to create them again, in order to prevent unforeseen problems!

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
| storage, unlimitedStorage             | Necessary for maintaining a cache and mappings between server and browser bookmarks                                                                                                                                                                                                                                                                                  |
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

| adapter           | cold initial sync (4000 Bookmarks) | warm sync with no changes (4000 Bookmarks) |
| ----------------- | ---------------------------------- | ------------------------------------------ |
| nextcloud-folders | ~7min                              | ~20s                                       |
| webdav            | ~4min                              | ~10s                                       |

**Note**: The cold sync performance of the nextcloud-folders adapter depends to an extent on the server's resources as well, such that the times may vary with your setup.

### Finding duplicates

Floccus will sync your bookmarks as-is, including any dupes that are in different folders. If you need to find and remove duplicates in your bookmarks, try something like [bookmark-dupes](https://addons.mozilla.org/en-US/firefox/addon/bookmark-dupes).

### Troubleshooting

- **Emojis**: MySQL doesn't support emojis out of the box, so if you're syncing to nextcloud and getting Error code 500 from nextcloud, check the nextcloud log for SQL errors and [proceed as explained in the nextcloud docs if you get charset errors](https://docs.nextcloud.com/server/stable/admin_manual/configuration_database/mysql_4byte_support.html).

If you need help sorting out problems, try the gitter chat room: <https://gitter.im/marcelklehr/floccus>

## Considerations

Is this a good idea? I think so. If you'd like to know more, check out [the considerations file](./CONSIDERATIONS.md)

## What's with the name?

[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

## Donate

If you'd like to support the creation and maintenance of this software, please consider donating. :)

| [<img src="https://img.shields.io/badge/paypal-donate-blue.svg?logo=paypal&style=for-the-badge">](https://www.paypal.me/marcelklehr1) | [<img src="http://img.shields.io/liberapay/receives/marcelklehr.svg?logo=liberapay&style=for-the-badge">](https://liberapay.com/marcelklehr/donate) | [![](https://opencollective.com/floccus/tiers/backer.svg?avatarHeight=36)](https://opencollective.com/floccus) |
| :-----------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------: |


## Contributors

This project exists thanks to all the people who contribute.

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/bernd-wechner"><img src="https://avatars2.githubusercontent.com/u/7296506?v=4" width="70px;" alt=""/><br /><sub><b>Bernd Wechner</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3Abernd-wechner" title="Bug reports">🐛</a> <a href="#ideas-bernd-wechner" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/marcelklehr/floccus/commits?author=bernd-wechner" title="Tests">⚠️</a></td>
    <td align="center"><a href="https://github.com/jlbprof"><img src="https://avatars0.githubusercontent.com/u/9746421?v=4" width="70px;" alt=""/><br /><sub><b>jlbprof</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/commits?author=jlbprof" title="Code">💻</a> <a href="https://github.com/marcelklehr/floccus/issues?q=author%3Ajlbprof" title="Bug reports">🐛</a> <a href="https://github.com/marcelklehr/floccus/commits?author=jlbprof" title="Tests">⚠️</a></td>
    <td align="center"><a href="https://github.com/TeutonJon78"><img src="https://avatars2.githubusercontent.com/u/1771400?v=4" width="70px;" alt=""/><br /><sub><b>TeutonJon78</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3ATeutonJon78" title="Bug reports">🐛</a> <a href="#ideas-TeutonJon78" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/skewty"><img src="https://avatars1.githubusercontent.com/u/9087223?v=4" width="70px;" alt=""/><br /><sub><b>Scott P.</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3Askewty" title="Bug reports">🐛</a> <a href="#ideas-skewty" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/Lantizia"><img src="https://avatars1.githubusercontent.com/u/10448369?v=4" width="70px;" alt=""/><br /><sub><b>Lantizia</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3ALantizia" title="Bug reports">🐛</a> <a href="#ideas-Lantizia" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://iklive.eu"><img src="https://avatars1.githubusercontent.com/u/6315832?v=4" width="70px;" alt=""/><br /><sub><b>TCB13</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/commits?author=TCB13" title="Code">💻</a> <a href="#ideas-TCB13" title="Ideas, Planning, & Feedback">🤔</a> <a href="#plugin-TCB13" title="Plugin/utility libraries">🔌</a> <a href="#translation-TCB13" title="Translation">🌍</a></td>
    <td align="center"><a href="https://github.com/gohrner"><img src="https://avatars0.githubusercontent.com/u/26199042?v=4" width="70px;" alt=""/><br /><sub><b>gohrner </b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3Agohrner" title="Bug reports">🐛</a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/Tank-Missile"><img src="https://avatars0.githubusercontent.com/u/5893370?v=4" width="70px;" alt=""/><br /><sub><b>Tank-Missile</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3ATank-Missile" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/tkurbad"><img src="https://avatars1.githubusercontent.com/u/158030?v=4" width="70px;" alt=""/><br /><sub><b>Torsten Kurbad</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3Atkurbad" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/gerroon"><img src="https://avatars1.githubusercontent.com/u/8519469?v=4" width="70px;" alt=""/><br /><sub><b>gerroon</b></sub></a><br /><a href="https://github.com/marcelklehr/floccus/issues?q=author%3Agerroon" title="Bug reports">🐛</a></td>
  </tr>
</table>

<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification.

## Contribute

All contributions, code, feedback and strategic advice, are welcome. If you have a question you can contact me directly via email or simply [open an issue](https://github.com/marcelklehr/floccus/issues/new) on the repository. I'm also always happy for people helping me test new features -- see the issues for announcements of beta versions.

### Translating

Translations can now be provided over at [transifex](https://www.transifex.com/floccus/floccus/).

![](https://www.transifex.com/projects/p/floccus/resource/messages-json--develop/chart/image_png)

### Development

#### Setting up a dev environment

- Clone this repository.
- Install node.js and npm
- In the root of your floccus repo, run `npm install && npm install -g gulp`
- Run `gulp` to build
- Install firefox developer edition and prepare it as follows: https://developer.mozilla.org/en-US/Add-ons/Setting_up_extension_development_environment

#### Building

- `gulp`

#### Releasing

- `gulp release`

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
