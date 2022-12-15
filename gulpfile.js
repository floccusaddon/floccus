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
  ],
  views: './html/*.html',
  nativeHTML: './html/index.html',
  entries: 'src/entries/*.js',
  js: 'src/**',
  builds: './builds/',
  locales: '_locales/**/messages.json',
  icons: 'icons/*',
  dist: './dist/**'
}
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

const locales = function() {
  return gulp.src(paths.locales).pipe(rename(function(file) {
    // Returns a completely new object, make sure you return all keys needed!
    return {
      dirname: '.',
      basename: path.basename(file.dirname),
      extname: '.json'
    }
  })).pipe(gulp.dest('./dist/_locales/'))
}

const icons = function() {
  return gulp.src(paths.icons).pipe(gulp.dest('./dist/icons/'))
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

const mocha = gulp.parallel(mochajs, mochacss)

const thirdparty = gulp.parallel(mocha)

const assets = gulp.parallel(html, thirdparty, locales, icons)

const build = gulp.parallel(assets, js)

const main = gulp.series(build, native)

const zip = function() {
  return gulp
    .src(paths.zip, { buffer: false })
    .pipe(gulpZip(`floccus-build-v${VERSION}.zip`))
    .pipe(gulp.dest(paths.builds))
}

const xpi = function() {
  return gulp
    .src(paths.zip, { buffer: false })
    .pipe(gulpZip(`floccus-build-v${VERSION}.xpi`))
    .pipe(gulp.dest(paths.builds))
}

const crx = function() {
  return crx3(
    fs.createReadStream(`${paths.builds}/floccus-build-v${VERSION}.zip`),
    {
      keyPath: 'key.pem',
      crxPath: `${paths.builds}/floccus-build-v${VERSION}.crx`,
    }
  )
}

const release = gulp.series(main, gulp.parallel(zip, xpi), crx)

const publish = gulp.series(main, zip, function() {
  return webstore
    .uploadExisting(
      fs.createReadStream(`${paths.builds}floccus-build-v${VERSION}.zip`)
    )
    .then(function() {
      return webstore.publish('default')
    })
})

const watch = function() {
  let jsWatcher = gulp.watch(paths.js, assets)
  let viewsWatcher = gulp.watch(paths.views, html)
  let localeWatcher = gulp.watch(paths.locales, locales)
  let nativeWatcher = gulp.watch(paths.dist, native)

  jsWatcher.on('change', onWatchEvent)
  viewsWatcher.on('change', onWatchEvent)
  localeWatcher.on('change', onWatchEvent)
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
exports.watch = watch
exports.release = release
exports.watch = gulp.series(main, watch)
exports.publish = publish
exports.build = build
exports.locales = locales
exports.native = native
/*
 * Define default task that can be called by just running `gulp` from cli
 */
exports.default = main
