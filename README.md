# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus

![](https://raw.githubusercontent.com/marcelklehr/floccus/develop/img/screen_chrome_wide.png)
> Sync your bookmarks privately across browsers

[![Tests](https://github.com/marcelklehr/floccus/workflows/Tests/badge.svg)](https://github.com/marcelklehr/floccus/actions?query=workflow%3ATests) <img src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img src="https://img.shields.io/amo/users/floccus.svg">

- 🔖 Syncs your real, native browser bookmarks directly
- ☸ Sync via [Nextcloud Bookmarks](https://github.com/nextcloud/bookmarks), Google Drive or [any WebDAV-compatible service](https://community.cryptomator.org/t/webdav-urls-of-common-cloud-storage-services/75)
- ⚛ Use any browser that supports Web extensions (e.g. Firefox, Chrome, Edge, Opera, Brave, Vivaldi, ...; Safari [not yet](https://github.com/floccusaddon/floccus/issues/23))
- 💼 Create as many sync profiles as you need
- 🚚 Control sync strategy (i.e. uni- or bidirectional), ⏳ sync interval and 📂 synced folder
- 📦 Easily export your configuration
- 🔒 Keep your credentials secure with an encryption passphrase

<p>&nbsp;</p>
<div style="text-align: center"><a href="https://floccus.org/download"><img src="https://img.shields.io/badge/Download-now-limegreen.svg?&style=for-the-badge"></a></div>
<p>&nbsp;</p>

If you'd like to support the creation and maintenance of this software, please consider donating. :)

| [<img src="https://img.shields.io/badge/Open%20Collective-sponsor-lightblue.svg?logo=opencollective&style=for-the-badge" alt="Open Collective">](https://opencollective.com/floccus) | [<img src="https://img.shields.io/badge/github-sponsor-violet.svg?logo=github&style=for-the-badge">](https://github.com/sponsors/marcelklehr) | [<img src="https://img.shields.io/badge/LiberaPay-sponsor-yellow.svg?logo=liberapay&style=for-the-badge">](https://liberapay.com/marcelklehr/donate)   | [<img src="https://img.shields.io/badge/paypal-donate-blue.svg?logo=paypal&style=for-the-badge">](https://www.paypal.me/marcelklehr1)  |
|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:| :-------------------------------------------------------------------------------------------------------------------------------------------------: |:--:|:---:|

## 🎬 Getting started
If you don't know how to start with Floccus, [read this guide](https://floccus.org/start).

If you need help, talk to us on [gitter](https://gitter.im/marcelklehr/floccus), matrix ([`#marcelklehr_floccus:gitter.im`](https://matrix.to/#/#marcelklehr_floccus:gitter.im?utm_source=gitter)), in the [official Nextcloud Bookmarks talk channel](https://cloud.nextcloud.com/call/u52jcby9), or drop [me](https://marcelklehr.de) a mail! :wave:

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
    <td align="center"><a href="https://github.com/bernd-wechner"><img src="https://avatars2.githubusercontent.com/u/7296506?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Bernd Wechner</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Abernd-wechner" title="Bug reports">🐛</a> <a href="#ideas-bernd-wechner" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/floccusaddon/floccus/commits?author=bernd-wechner" title="Tests">⚠️</a></td>
    <td align="center"><a href="https://github.com/jlbprof"><img src="https://avatars0.githubusercontent.com/u/9746421?v=4?s=70" width="70px;" alt=""/><br /><sub><b>jlbprof</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=jlbprof" title="Code">💻</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Ajlbprof" title="Bug reports">🐛</a> <a href="https://github.com/floccusaddon/floccus/commits?author=jlbprof" title="Tests">⚠️</a></td>
    <td align="center"><a href="https://github.com/TeutonJon78"><img src="https://avatars2.githubusercontent.com/u/1771400?v=4?s=70" width="70px;" alt=""/><br /><sub><b>TeutonJon78</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ATeutonJon78" title="Bug reports">🐛</a> <a href="#ideas-TeutonJon78" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/skewty"><img src="https://avatars1.githubusercontent.com/u/9087223?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Scott P.</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Askewty" title="Bug reports">🐛</a> <a href="#ideas-skewty" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/Lantizia"><img src="https://avatars1.githubusercontent.com/u/10448369?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Lantizia</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ALantizia" title="Bug reports">🐛</a> <a href="#ideas-Lantizia" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://iklive.eu"><img src="https://avatars1.githubusercontent.com/u/6315832?v=4?s=70" width="70px;" alt=""/><br /><sub><b>TCB13</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=TCB13" title="Code">💻</a> <a href="#ideas-TCB13" title="Ideas, Planning, & Feedback">🤔</a> <a href="#plugin-TCB13" title="Plugin/utility libraries">🔌</a> <a href="#translation-TCB13" title="Translation">🌍</a></td>
    <td align="center"><a href="https://github.com/gohrner"><img src="https://avatars0.githubusercontent.com/u/26199042?v=4?s=70" width="70px;" alt=""/><br /><sub><b>gohrner </b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Agohrner" title="Bug reports">🐛</a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/Tank-Missile"><img src="https://avatars0.githubusercontent.com/u/5893370?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Tank-Missile</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ATank-Missile" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/tkurbad"><img src="https://avatars1.githubusercontent.com/u/158030?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Torsten Kurbad</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Atkurbad" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/gerroon"><img src="https://avatars1.githubusercontent.com/u/8519469?v=4?s=70" width="70px;" alt=""/><br /><sub><b>gerroon</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Agerroon" title="Bug reports">🐛</a></td>
    <td align="center"><a href="http://biciklijade.com/"><img src="https://avatars.githubusercontent.com/u/156656?v=4?s=70" width="70px;" alt=""/><br /><sub><b>Matija Nalis</b></sub></a><br /><a href="#ideas-mnalis" title="Ideas, Planning, & Feedback">🤔</a> <a href="#question-mnalis" title="Answering Questions">💬</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Amnalis" title="Bug reports">🐛</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
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
