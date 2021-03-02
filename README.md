# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus

![](https://raw.githubusercontent.com/marcelklehr/floccus/develop/img/screen_chrome_wide.png)

> Sync your bookmarks across browsers via Nextcloud, WebDAV or Google Drive

[![Tests](https://github.com/marcelklehr/floccus/workflows/Tests/badge.svg)](https://github.com/marcelklehr/floccus/actions?query=workflow%3ATests)

- 📂 Sync any local bookmarks folder to any server-side folder
- ⚛ Use any browser that is compatible wit hthe web extension API
- 💼 Create as many sync profiles as you like
- 🚚 Control sync strategy, i.e. uni- or bidirectional syncing
- ⏳ Control sync interval
- 📦 Easily export your configuration
- 🔒 Keep your credentials secure with an encryption passphrase

[![Chrome Webstore](https://storage.googleapis.com/chrome-gcs-uploader.appspot.com/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/tbyBjqi7Zu733AAKA5n4.png)](https://chrome.google.com/webstore/detail/floccus/fnaicdffflnofjppbagibeoednhnbjhg)|[![Mozilla Addons](https://addons.cdn.mozilla.net/static/img/addons-buttons/AMO-button_2.png)](https://addons.mozilla.org/en-US/firefox/addon/floccus/)|[<img alt="Microsoft Edge" src="https://developer.microsoft.com/en-us/store/badges/images/English_get-it-from-MS.png" height="45" />](https://microsoftedge.microsoft.com/addons/detail/gjkddcofhiifldbllobcamllmanombji)|
|---|-----|---|
|<img align="left" src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img align="right" src="https://img.shields.io/chrome-web-store/rating/fnaicdffflnofjppbagibeoednhnbjhg.svg">| <img align="left" src="https://img.shields.io/amo/users/floccus.svg"> <img align="right" src="https://img.shields.io/amo/rating/floccus.svg">|[![](https://img.shields.io/badge/dynamic/json?label=rating&suffix=/5&query=%24.averageRating&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fgjkddcofhiifldbllobcamllmanombji)](https://microsoftedge.microsoft.com/addons/detail/floccus-bookmarks-sync/gjkddcofhiifldbllobcamllmanombji)|

## Table of contents
 * [Donate](#Donate)
 * [Community](#Community)
 * [Install](#Install)
   * [Nextcloud](#Nextcloud)
   * [Chrome](#Chrome)
   * [Firefox](#Firefox)
   * [Android](#Android)
   * [Permissions](#Permissions)
 * [Considerations](#Considerations)
 * [What's with the name?](#whats-with-the-name)
 * [Contributors](#Contributors)
 * [Contribute](#Contribute)
 * [Backers](#Backers)
 * [Sponsors](#Sponsors)
 * [License](#License)

## Donate

If you'd like to support the creation and maintenance of this software, please consider donating. :)

| [<img src="https://img.shields.io/badge/paypal-donate-blue.svg?logo=paypal&style=for-the-badge">](https://www.paypal.me/marcelklehr1) | [<img src="http://img.shields.io/liberapay/receives/marcelklehr.svg?logo=liberapay&style=for-the-badge">](https://liberapay.com/marcelklehr/donate) | [![](https://opencollective.com/floccus/tiers/backer.svg?avatarHeight=36)](https://opencollective.com/floccus) | [<img src="https://img.shields.io/badge/github-sponsors-violet.svg?logo=github&style=for-the-badge">](https://github.com/sponsors/marcelklehr) |
| :-----------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------: |

## Community

Talk to us on [gitter](https://gitter.im/marcelklehr/floccus) or in the [official Nextcloud Bookmarks talk channel](https://cloud.nextcloud.com/call/u52jcby9)! :wave:

## Install
The following sync methods are available:

- **Google Drive**: If you have a Google account you can sync your bookmarks via an encrypted file in your Drive.
- **WebDAV**: If you have a WebDAV server at hand, like any version of nextcloud/owncloud, box.com or with any other WebDAV server, commercial or self-hosted.
- **Nextcloud Bookmarks**: Nextcloud in particular also sports a dedicated bookmarks app, which allows you to also access your bookmarks via a nice web UI.
- **Local file and more**: You can also just sync with a local file, using [the companion desktop app LoFloccus](https://github.com/TCB13/LoFloccus). You can then also sync that file to other computers using your favorite file syncing solution, like Dropbox, Syncthing, rsync, etc. You can also create a WebDAV Server on the local machine using Docker in GNU/Linux, check out the project [Floccus-WebDavDocker](https://github.com/marlluslustosa/Floccus-WebDavDocker).

Once your server or the LoFloccus app is ready, read on for the browser of your choosing.

**Note:** It is recommended to not enable native bookmark synchronization built into your browser, as it is known to cause issues.

### Nextcloud
Floccus is regularly tested with the following setups:

|Nextcloud|Bookmarks|
|---|---|
|v17|v1.1.2|
|v17|v2.3.4|
|v18|v2.3.4|
|v19|v3.4.3|
|v20|v4.x|

Syncing via WebDAV should work with any Nextcloud version.

### Chrome

You can [install it via the Chrome Web store](https://chrome.google.com/webstore/detail/floccus-nextcloud-sync/fnaicdffflnofjppbagibeoednhnbjhg)

Alternatively, you can still install it by [downloading the Chrome package from the latest release](https://github.com/marcelklehr/floccus/releases/) and dropping it into Chrome's extension page.

### Firefox

You can [install it via AMO](https://addons.mozilla.org/en-US/firefox/addon/floccus/).

(Note that AMO has to review all new releases, though, so you might need to wait a bit before you can install the latest release on firefox.)

### Android

Floccus is not supported by Firefox for Android [yet](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/bookmarks#Browser_compatibility). **But**, why wait for mozilla, if you can use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser), which supports floccus! Install instructions are the same as for Chrome.

### Permissions

Floccus requests the following permissions:

| Permission           | Explanation                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage, unlimitedStorage             | Necessary for maintaining a cache and mappings between server and browser bookmarks                                                                                                                                                                                                                                                                                  |
| alarms               | Necessary for triggering synchronization in regular intervals                                                                                                                                                                                                                                                                                                        |
| bookmarks            | Necessary for creating and reading bookmarks                                                                                                                                                                                                                                                                                                                         |
| Unlimited web access | Necessary for accessing your self-hosted server. This cannot be limited, because everybody's server has a different URL. Unfortunately, the way webextensions work currently, floccus also gets access to all the data the browser has collected on those websites. However, floccus makes no use of that data and doesn't in any way collect information about you. |

### Limitations

- Note that currently you cannot sync the same folder with multiple nextcloud accounts in order to avoid data corruption. If you sync the root folder with one account and sync a sub folder with a different account, that sub-folder will not be synced with the account connected to the root folder anymore.

### Troubleshooting

- **Emojis**: MySQL doesn't support emojis out of the box, so if you're syncing to nextcloud and getting Error code 500 from nextcloud, check the nextcloud log for SQL errors and [proceed as explained in the nextcloud docs if you get charset errors](https://docs.nextcloud.com/server/stable/admin_manual/configuration_database/mysql_4byte_support.html).

If you need help sorting out problems, try the gitter chat room: <https://gitter.im/marcelklehr/floccus>

## Considerations

Is this a good idea? I think so. If you'd like to know more, check out [the considerations file](./CONSIDERATIONS.md)

## What's with the name?

[Cirrus floccus](https://en.wikipedia.org/wiki/Cirrus_floccus) is a type of cloud, that <del>can sync your browser data</del> looks very nice.

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
