# ![](https://raw.githubusercontent.com/marcelklehr/floccus/master/icons/logo.png) Floccus

![](https://raw.githubusercontent.com/marcelklehr/floccus/develop/img/screen_chrome_wide.png)
> Sync your bookmarks privately across browsers and devices

[![Tests](https://github.com/marcelklehr/floccus/workflows/Tests/badge.svg)](https://github.com/marcelklehr/floccus/actions?query=workflow%3ATests) <img src="https://img.shields.io/chrome-web-store/users/fnaicdffflnofjppbagibeoednhnbjhg.svg"> <img src="https://img.shields.io/amo/users/floccus.svg">

- 🔖 Syncs your real, native browser bookmarks directly
- ☸ Sync via [Nextcloud Bookmarks](https://github.com/nextcloud/bookmarks), Google Drive, any Git server (like GitHub, Gitlab, Gitea, etc.) or [any WebDAV-compatible service](https://community.cryptomator.org/t/webdav-urls-of-common-cloud-storage-services/75)
- ⚛ Use any browser that supports Web extensions (e.g. Firefox, Chrome, Edge, Opera, Brave, Vivaldi, ...; Safari [not yet](https://github.com/floccusaddon/floccus/issues/23))
- 📲 Install the floccus Android app to access your bookmarks on your phone
- 💼 Create as many sync profiles as you need
- 🚚 Control sync strategy (i.e. uni- or bidirectional), ⏳ sync interval and 📂 synced folder
- 📦 Easily export your configuration
- 🔒 Keep your credentials secure with an encryption passphrase


[![Download now](https://img.shields.io/badge/Download-now-limegreen.svg?&style=for-the-badge)](https://floccus.org/download)

This is the SHA-256 fingerprint of the certificate used to sign the floccus APKs:

```
ffed2778ff07371e6367b6dcf5d7c1327c57ff7158b8444029182a9aa2dd7085
```


If you'd like to support the creation and maintenance of this software, please consider donating. :)

| [<img src="https://img.shields.io/badge/Open%20Collective-sponsor-lightblue.svg?logo=opencollective&style=for-the-badge" alt="Open Collective">](https://opencollective.com/floccus) | [<img src="https://img.shields.io/badge/github-sponsor-violet.svg?logo=github&style=for-the-badge">](https://github.com/sponsors/marcelklehr) | [<img src="https://img.shields.io/badge/LiberaPay-sponsor-yellow.svg?logo=liberapay&style=for-the-badge">](https://liberapay.com/marcelklehr/donate)   | [<img src="https://img.shields.io/badge/paypal-donate-blue.svg?logo=paypal&style=for-the-badge">](https://www.paypal.me/marcelklehr1)  |
|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:| :-------------------------------------------------------------------------------------------------------------------------------------------------: |:--:|:---:|

## 🎬 Getting started
If you don't know how to start with Floccus, [read these guides](https://floccus.org/guides).

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
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/bernd-wechner"><img src="https://avatars2.githubusercontent.com/u/7296506?v=4?s=70" width="70px;" alt="Bernd Wechner"/><br /><sub><b>Bernd Wechner</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Abernd-wechner" title="Bug reports">🐛</a> <a href="#ideas-bernd-wechner" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/floccusaddon/floccus/commits?author=bernd-wechner" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/jlbprof"><img src="https://avatars0.githubusercontent.com/u/9746421?v=4?s=70" width="70px;" alt="jlbprof"/><br /><sub><b>jlbprof</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=jlbprof" title="Code">💻</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Ajlbprof" title="Bug reports">🐛</a> <a href="https://github.com/floccusaddon/floccus/commits?author=jlbprof" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/TeutonJon78"><img src="https://avatars2.githubusercontent.com/u/1771400?v=4?s=70" width="70px;" alt="TeutonJon78"/><br /><sub><b>TeutonJon78</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ATeutonJon78" title="Bug reports">🐛</a> <a href="#ideas-TeutonJon78" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/skewty"><img src="https://avatars1.githubusercontent.com/u/9087223?v=4?s=70" width="70px;" alt="Scott P."/><br /><sub><b>Scott P.</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Askewty" title="Bug reports">🐛</a> <a href="#ideas-skewty" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Lantizia"><img src="https://avatars1.githubusercontent.com/u/10448369?v=4?s=70" width="70px;" alt="Lantizia"/><br /><sub><b>Lantizia</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ALantizia" title="Bug reports">🐛</a> <a href="#ideas-Lantizia" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://iklive.eu"><img src="https://avatars1.githubusercontent.com/u/6315832?v=4?s=70" width="70px;" alt="TCB13"/><br /><sub><b>TCB13</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=TCB13" title="Code">💻</a> <a href="#ideas-TCB13" title="Ideas, Planning, & Feedback">🤔</a> <a href="#plugin-TCB13" title="Plugin/utility libraries">🔌</a> <a href="#translation-TCB13" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/gohrner"><img src="https://avatars0.githubusercontent.com/u/26199042?v=4?s=70" width="70px;" alt="gohrner "/><br /><sub><b>gohrner </b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Agohrner" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Tank-Missile"><img src="https://avatars0.githubusercontent.com/u/5893370?v=4?s=70" width="70px;" alt="Tank-Missile"/><br /><sub><b>Tank-Missile</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3ATank-Missile" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/tkurbad"><img src="https://avatars1.githubusercontent.com/u/158030?v=4?s=70" width="70px;" alt="Torsten Kurbad"/><br /><sub><b>Torsten Kurbad</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Atkurbad" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/gerroon"><img src="https://avatars1.githubusercontent.com/u/8519469?v=4?s=70" width="70px;" alt="gerroon"/><br /><sub><b>gerroon</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3Agerroon" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://biciklijade.com/"><img src="https://avatars.githubusercontent.com/u/156656?v=4?s=70" width="70px;" alt="Matija Nalis"/><br /><sub><b>Matija Nalis</b></sub></a><br /><a href="#ideas-mnalis" title="Ideas, Planning, & Feedback">🤔</a> <a href="#question-mnalis" title="Answering Questions">💬</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Amnalis" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/marcelklehr"><img src="https://avatars.githubusercontent.com/u/986878?v=4?s=70" width="70px;" alt="Marcel Klehr"/><br /><sub><b>Marcel Klehr</b></sub></a><br /><a href="#question-marcelklehr" title="Answering Questions">💬</a> <a href="https://github.com/floccusaddon/floccus/commits?author=marcelklehr" title="Code">💻</a> <a href="#content-marcelklehr" title="Content">🖋</a> <a href="#design-marcelklehr" title="Design">🎨</a> <a href="https://github.com/floccusaddon/floccus/commits?author=marcelklehr" title="Documentation">📖</a> <a href="#infra-marcelklehr" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#maintenance-marcelklehr" title="Maintenance">🚧</a> <a href="#projectManagement-marcelklehr" title="Project Management">📆</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/binsee"><img src="https://avatars.githubusercontent.com/u/5285894?v=4?s=70" width="70px;" alt="binsee"/><br /><sub><b>binsee</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=binsee" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://daitem.io/"><img src="https://avatars.githubusercontent.com/u/8190979?v=4?s=70" width="70px;" alt="Marc Shapiro"/><br /><sub><b>Marc Shapiro</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=mlshapiro" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://marllus.com/"><img src="https://avatars.githubusercontent.com/u/29416568?v=4?s=70" width="70px;" alt="Marllus Lustosa"/><br /><sub><b>Marllus Lustosa</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=marlluslustosa" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://android.izzysoft.de/"><img src="https://avatars.githubusercontent.com/u/6781438?v=4?s=70" width="70px;" alt="Izzy"/><br /><sub><b>Izzy</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/issues?q=author%3AIzzySoft" title="Bug reports">🐛</a> <a href="#ideas-IzzySoft" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-IzzySoft" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/sunjam"><img src="https://avatars.githubusercontent.com/u/1787238?v=4?s=70" width="70px;" alt="sunjam"/><br /><sub><b>sunjam</b></sub></a><br /><a href="#ideas-sunjam" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/floccusaddon/floccus/commits?author=sunjam" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dsiminiuk"><img src="https://avatars.githubusercontent.com/u/5713547?v=4?s=70" width="70px;" alt="Danny Siminiuk"/><br /><sub><b>Danny Siminiuk</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=dsiminiuk" title="Tests">⚠️</a> <a href="#ideas-dsiminiuk" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Seirade"><img src="https://avatars.githubusercontent.com/u/45798662?v=4?s=70" width="70px;" alt="Seirade"/><br /><sub><b>Seirade</b></sub></a><br /><a href="#ideas-Seirade" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3ASeirade" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/pinpontitit"><img src="https://avatars.githubusercontent.com/u/100489443?v=4?s=70" width="70px;" alt="pinpontitit"/><br /><sub><b>pinpontitit</b></sub></a><br /><a href="#ideas-pinpontitit" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Apinpontitit" title="Bug reports">🐛</a> <a href="https://github.com/floccusaddon/floccus/commits?author=pinpontitit" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://dmotte.github.io/"><img src="https://avatars.githubusercontent.com/u/37443982?v=4?s=70" width="70px;" alt="Motte"/><br /><sub><b>Motte</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=dmotte" title="Code">💻</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Admotte" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/macrogreg"><img src="https://avatars.githubusercontent.com/u/20691812?v=4?s=70" width="70px;" alt="macrogreg"/><br /><sub><b>macrogreg</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=macrogreg" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://www.artificialworlds.net"><img src="https://avatars.githubusercontent.com/u/76812?v=4?s=70" width="70px;" alt="Andy Balaam"/><br /><sub><b>Andy Balaam</b></sub></a><br /><a href="https://github.com/floccusaddon/floccus/commits?author=andybalaam" title="Code">💻</a> <a href="https://github.com/floccusaddon/floccus/issues?q=author%3Aandybalaam" title="Bug reports">🐛</a></td>
    </tr>
  </tbody>
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
- Install the [latest LTS version of node.js](https://nodejs.org/en/download/).
- In the root of your floccus repo, run `npm install`.
- Run `npm run build` to build.
- Find out more on how to develop browser extensions here: <https://extensionworkshop.com/>.

For building the android app you'll need Android Studio

- Open the `android/` folder in Android studio and build the App like any other Android app.
- `npm run build` and `npm run watch` will push changes to `android/` as necessary.

#### Building

- `npm run build`

Run the following to automatically compile changes as you make them:

- `npm run watch`

#### Releasing

- `npm run build-release`

#### Windows-specific considerations

Follow the above general guidance on setting up a dev environment.  
There are Windows-specific versions of some npm scripts:
 - build: `npm run build-win`
 - build-release: `npm run build-release-win`
 - watch: `watch-win`

When building for the first time you may get an error about `gulp` not being found.  
You can install gulp globally on your system by executing `npm install -g gulp` from your repo root.
It is recommended that you do this proactively after executing `npm install` in the repo root for the first time.

#### Running the browser extension and corresponding tests locally

- Build the browser extension:  
`npm run build-release`  
(`npm run build-release-win` if you use Windows)

- After a successful build, the extension package will be found in:  
`RepoRoot/builds/`

- The following steps use _Firefox_ as an example; other browsers work similarly.  
The Firefox extension package is a file with an `.xpi`-extension. It is a simple archive. To modify it, you can rename it to `.zip`, make the changes, and then rename it back to `.xpi`. Many archive-related tools know this and allow you to work with the `.xpi`-file directly (e.g. [Total Commander](https://www.ghisler.com/download.htm)).

- Enable the extension package for local testing:  
By default, tests are not included into the release archive. To run tests in your local browser, copy the file  
`RepoRoot/dist/js/test.js`  
into the release package, so that it is located at  
`FloccusPackage.xpi/dist/js/test.js`

- Open Firefox using a dedicated test-profile:  
**If you use your main profile for testing, the test scripts will likely destroy your existing bookmarks and open tabs!**  
To interact with profiles, go to this address:  
`about:profiles`

- Load the extension:  
In the a dedicated Firefox profile window, go to  
`about:debugging`  
Select "This Firefox", and then under "Temporary Extensions", select "Load Temporary Add-on...". Then select the `.xpi`-file you prepared earlier.  
(Remember to unload the extension if you need to modify/rebuild the extension package.)

- The extension is now loaded. You can access it via the browser's extensions menu. 

- Run tests:  
After loading the extension, click on "Manifest URL". It will open a new tab with the URL
`moz-extension://SomeGuid/manifest.json`
Modify the URL to read  
`moz-extension://SomeGuid/dist/html/test.html`  
, keeping the same GUID and press enter. The test run should start automatically.

- Debug or pause tests:  
Press `F12` to open developer tools.  
On the "Debugger" tab, you can pause the execution, set breakpoints and step through the code.

Happy developing and thank you for your contributions!


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
