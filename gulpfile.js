var gulp = require('gulp')
var fs = require('fs')
var webpack = require('webpack')
var config = require('./webpack.prod')
var devConfig = require('./webpack.dev')
var gulpZip = require('gulp-zip')
var crx3 = require('crx3')
var webstoreClient = require('chrome-webstore-upload')

const VERSION = require('./package.json').version
const paths = {
  zip: [
    './**',
    (process.env['CI'] ? '' : '!') + 'dist/js/test.js',
    '!builds/**',
    '!src/**',
    '!node_modules/**',
    '!img/**',
    '!ISSUE_TEMPLATE.md',
    '!gulpfile.js',
    '!key.pem',
  ],
  views: './html/*.html',
  entries: 'src/entries/*.js',
  js: 'src/**',
  builds: './builds/',
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

const html = function() {
  return gulp.src(paths.views).pipe(gulp.dest('./dist/html/'))
}

const polyfill = function() {
  return gulp
    .src('./node_modules/babel-polyfill/dist/polyfill.js')
    .pipe(gulp.dest('./dist/js/'))
}

const mochajs = function() {
  return gulp.src('./node_modules/mocha/mocha.js').pipe(gulp.dest('./dist/js/'))
}
const mochacss = function() {
  return gulp
    .src('./node_modules/mocha/mocha.css')
    .pipe(gulp.dest('./dist/css/'))
}

const mocha = gulp.parallel(mochajs, mochacss)

const thirdparty = gulp.parallel(polyfill, mocha)

const main = gulp.series(html, js, thirdparty)

const dev = gulp.series(html, devjs, thirdparty)

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

const release = gulp.series(main, zip, xpi, crx)

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
  let jsWatcher = gulp.watch(paths.js, dev)
  let viewsWatcher = gulp.watch(paths.views, html)

  jsWatcher.on('change', onWatchEvent)
  viewsWatcher.on('change', onWatchEvent)
}

function onWatchEvent(event) {
  console.log(
    'File ' + event.path + ' was ' + event.type + ', running tasks...'
  )
}

exports.html = html
exports.js = js
exports.mocha = mocha
exports.watch = watch
exports.release = release
exports.watch = gulp.series(dev, watch)
exports.publish = publish
exports.dev = dev
/*
 * Define default task that can be called by just running `gulp` from cli
 */
exports.default = main
