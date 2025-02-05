var gulp = require('gulp')
var fs = require('fs')
var webpack = require('webpack')
var config = require('./webpack.prod')
var devConfig = require('./webpack.dev')
var gulpZip = require('gulp-zip')
var crx3 = require('crx3')
var webstoreClient = require('chrome-webstore-upload')
var rename = require('gulp-rename')
var path = require('path')

// Provide a dummy credential file for third-party builders
try {
  fs.accessSync('./google-api.credentials.json')
} catch (e) {
  fs.writeFileSync('./google-api.credentials.json', JSON.stringify({
    'web': {
      'client_id': 'yourappidhere.apps.googleusercontent.com',
      'project_id': 'YOUR PROJECT ID HERE',
      'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
      'token_uri': 'https://oauth2.googleapis.com/token',
      'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs',
      'client_secret': 'YOUR CLIENT SECRET HERE',
      'redirect_uris': [
        'https://yourappidhere.chromiumapp.org/',
        'https://yourappidhere.extensions.allizom.org/'
      ]
    }
  }))
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION = require('./package.json').version
const paths = {
  zip: [
    (process.env['CI'] ? './' : '!') + './dist/js/test.js',
    './dist/**',
    './icons/**',
    './lib/**',
    './_locales/**',
    'LICENSE.txt',
    'PRIVACY_POLICY.md',
    'README.md',
  ],
  views: './html/*.html',
  nativeHTML: './html/index.html',
  entries: 'src/entries/*.js',
  js: 'src/**',
  builds: './builds/',
  icons: 'icons/*',
  dist: './dist/**',
  distJs: './dist/js',
}

paths.chromeZip = [...paths.zip, 'manifest.chrome.json']
paths.firefoxZip = [...paths.zip, 'manifest.firefox.json']

const WEBSTORE_ID = 'fnaicdffflnofjppbagibeoednhnbjhg'

let WEBSTORE_CREDENTIALS
let webstore
try {
  WEBSTORE_CREDENTIALS = require('./builds/google-api.json')
  webstore = webstoreClient(
    Object.assign({}, WEBSTORE_CREDENTIALS, {
      extensionId: WEBSTORE_ID,
    })
  )
} catch (e) {
  // noop
}

const icons = function() {
  return gulp.src(paths.icons).pipe(gulp.dest('./dist/icons/'))
}

const devjs = function() {
  return new Promise((resolve) =>
    webpack(devConfig, (err, stats) => {
      if (err) console.log('Webpack', err)

      console.log(
        stats.toString({
          /* stats options */
        })
      )

      resolve()
    })
  )
}

const js = async function() {
  fs.mkdirSync(paths.distJs,{ recursive: true })
  await new Promise((resolve) =>
    webpack(config, (err, stats) => {
      console.log(
        stats.toString({
          /* stats options */
        })
      )

      if (err) {
        console.log('Webpack', err)
        return
      }
      const statsJson = stats.toJson()
      html(statsJson)
      resolve()
    })
  )
}

const html = function(statsJson) {
  fs.mkdirSync('dist/html/', { recursive: true })
  let html, scripts, bgScript, addition
  ;['index.html', 'options.html', 'background.html', 'test.html'].forEach(htmlFile => {
    switch (htmlFile) {
      case 'index.html':
        html = fs.readFileSync('html/' + htmlFile, 'utf8')
        scripts = statsJson.entrypoints.native.assets.map(asset => `<script src="js/${asset.name}"></script>`).join('\n')
        html = html.replace('{{ scripts }}', scripts)
        fs.writeFileSync('dist/' + htmlFile, html)
        break
      case 'options.html':
        html = fs.readFileSync('html/' + htmlFile, 'utf8')
        scripts = statsJson.entrypoints.options.assets.map(asset => `<script src="../js/${asset.name}"></script>`).join('\n')
        html = html.replace('{{ scripts }}', scripts)
        console.log(statsJson.entrypoints.options.assets)
        fs.writeFileSync('dist/html/' + htmlFile, html)
        break
      case 'test.html':
        html = fs.readFileSync('html/' + htmlFile, 'utf8')
        scripts = statsJson.entrypoints.test.assets.map(asset => `<script src="../js/${asset.name}"></script>`).join('\n')
        html = html.replace('{{ scripts }}', scripts)
        fs.writeFileSync('dist/html/' + htmlFile, html)
        break
      case 'background.html':
        html = fs.readFileSync('html/' + htmlFile, 'utf8')
        scripts = statsJson.entrypoints['background-script'].assets.map(asset => `<script src="../js/${asset.name}"></script>`).join('\n')
        html = html.replace('{{ scripts }}', scripts)
        fs.writeFileSync('dist/html/' + htmlFile, html)

        bgScript = fs.readFileSync(paths.distJs + '/background-script.js', 'utf8')
        addition = `
if ("undefined"!=typeof self && 'importScripts' in self) {
  ${statsJson.entrypoints['background-script'].assets.map(asset => asset.name !== 'background-script.js' ? `self.importScripts('./${asset.name}')` : '').join('\n')}
}
`
        fs.writeFileSync(paths.distJs + '/background-script.js', addition + bgScript)

        break
    }
  })
}

const mochajs = function() {
  return gulp.src('./node_modules/mocha/mocha.js').pipe(gulp.dest('./dist/js/'))
}
const mochacss = function() {
  return gulp
    .src('./node_modules/mocha/mocha.css')
    .pipe(gulp.dest('./dist/css/'))
}

const native = async function() {
  const execa = (await import('execa')).execa
  const {stdout} = await execa('cap', ['sync'])
  console.log(stdout)
}

const cleanJs = async function() {
  try {
    fs.rmSync(paths.distJs, { recursive: true })
  } catch (e) {
    // noop
  }
}

const mocha = gulp.parallel(mochajs, mochacss)

const thirdparty = gulp.parallel(mocha)

const assets = gulp.parallel(thirdparty, icons)

const build = gulp.series(cleanJs, js, assets)

const main = gulp.series(build, native)

const chromeZip = function() {
  return gulp
    .src(paths.chromeZip, { buffer: false, base: './' })
    .pipe(rename((path) => {
      if (path.basename.startsWith('manifest') && path.extname === '.json') {
        path.basename = 'manifest'
      }
    }))
    .pipe(gulpZip(`floccus-build-v${VERSION}-chrome.zip`))
    .pipe(gulp.dest(paths.builds))
}

const firefoxZip = function() {
  return gulp
    .src(paths.firefoxZip, { buffer: false, base: './' })
    .pipe(rename((path) => {
      if (path.basename.startsWith('manifest') && path.extname === '.json') {
        path.basename = 'manifest'
      }
    }))
    .pipe(gulpZip(`floccus-build-v${VERSION}-firefox.zip`))
    .pipe(gulp.dest(paths.builds))
}

const xpi = function() {
  return gulp
    .src(paths.firefoxZip, { buffer: false, base: './' })
    .pipe(rename((path) => {
      if (path.basename.startsWith('manifest') && path.extname === '.json') {
        path.basename = 'manifest'
      }
    }))
    .pipe(gulpZip(`floccus-build-v${VERSION}.xpi`))
    .pipe(gulp.dest(paths.builds))
}

const crx = function() {
  return crx3(
    fs.createReadStream(`${paths.builds}/floccus-build-v${VERSION}-chrome.zip`),
    {
      keyPath: 'key.pem',
      crxPath: `${paths.builds}/floccus-build-v${VERSION}.crx`,
    }
  )
}

const release = gulp.series(main, gulp.parallel(firefoxZip, chromeZip, xpi), crx)

const publish = gulp.series(main, chromeZip, function() {
  return webstore
    .uploadExisting(
      fs.createReadStream(`${paths.builds}floccus-build-v${VERSION}-chrome.zip`)
    )
    .then(function() {
      return webstore.publish('default')
    })
})

const watch = function() {
  let jsWatcher = gulp.watch(paths.js, assets)
  let nativeWatcher = gulp.watch(paths.dist, native)

  jsWatcher.on('change', onWatchEvent)
  nativeWatcher.on('change', onWatchEvent)

  webpack(devConfig).watch({}, (err, stats) => {
    if (err) {
      console.log(err)
    }
    html({entrypoints: {
      native: {assets: [{name: 'native.js'}]},
      options: {assets: [{name: 'options.js'}]},
      'background-script': {assets: [{name: 'background-script.js'}]},
      'test': {assets: [{name: 'test.js'}]},
    }})

    console.log(stats.toString({
      chunks: false,
      colors: true
    }))
  })
}

function onWatchEvent(path) {
  console.log(
    'File ' + path + ' was changed, running tasks...'
  )
}

exports.assets = assets
exports.js = js
exports.mocha = mocha
exports.release = release
exports.watch = gulp.series(cleanJs,gulp.parallel(assets, devjs), native, watch)
exports.publish = publish
exports.build = build
exports.native = native
exports.package = gulp.series(gulp.parallel(firefoxZip, chromeZip, xpi), crx)
/*
 * Define default task that can be called by just running `gulp` from cli
 */
exports.default = main
