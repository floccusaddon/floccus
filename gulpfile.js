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
    './**',
    (process.env['CI'] ? './' : '!') + 'dist/js/test.js',
    '!builds/**',
    '!src/**',
    '!node_modules/**',
    '!img/**',
    '!ISSUE_TEMPLATE.md',
    '!gulpfile.js',
    '!key.pem',
    '!android/**',
    '!ios/**',
    '!manifest*.json'
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

const js = function() {
  return new Promise((resolve) =>
    webpack(config, (err, stats) => {
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

const html = function() {
  return Promise.all([
    gulp.src(paths.nativeHTML).pipe(gulp.dest('./dist/')),
    gulp.src(paths.views).pipe(gulp.dest('./dist/html/')),
  ])
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
  fs.rmSync(paths.distJs, {recursive: true})
}

const mocha = gulp.parallel(mochajs, mochacss)

const thirdparty = gulp.parallel(mocha)

const assets = gulp.parallel(html, thirdparty, icons)

const build = gulp.series(cleanJs, js, assets)

const main = gulp.series(build, native)

const chromeZip = function() {
  return gulp
    .src(paths.chromeZip, { buffer: false })
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
    .src(paths.firefoxZip, { buffer: false })
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
    .src(paths.firefoxZip, { buffer: false })
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
  let viewsWatcher = gulp.watch(paths.views, html)
  let nativeWatcher = gulp.watch(paths.dist, native)

  jsWatcher.on('change', onWatchEvent)
  viewsWatcher.on('change', onWatchEvent)
  nativeWatcher.on('change', onWatchEvent)

  webpack(devConfig).watch({}, (err, stats) => {
    if (err) {
      console.log(err)
    }
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

exports.html = html
exports.js = js
exports.mocha = mocha
exports.release = release
exports.watch = gulp.series(cleanJs,gulp.parallel(assets, devjs), native, watch)
exports.publish = publish
exports.build = build
exports.native = native
exports.package = gulp.parallel(firefoxZip, chromeZip, xpi)
/*
 * Define default task that can be called by just running `gulp` from cli
 */
exports.default = main
