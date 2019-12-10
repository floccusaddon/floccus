var gulp = require('gulp')
var fs = require('fs')
var browserify = require('browserify')
var babelify = require('babelify')
var tap = require('gulp-tap')
var gulpZip = require('gulp-zip')
var crx3 = require('crx3')
var webstoreClient = require('chrome-webstore-upload')

const VERSION = require('./package.json').version
const paths = {
  zip: [
    './**',
    // '!dist/js/test.js', // only for releases
    '!builds/**',
    '!src/**',
    '!node_modules/**',
    '!img/**',
    '!ISSUE_TEMPLATE.md',
    '!gulpfile.js',
    '!key.pem'
  ],
  views: './views/*.html',
  entries: 'src/entries/*.js',
  js: 'src/**',
  builds: './builds/'
}
const WEBSTORE_ID = 'fnaicdffflnofjppbagibeoednhnbjhg'

let WEBSTORE_CREDENTIALS
let webstore
try {
  WEBSTORE_CREDENTIALS = require('./builds/google-api.json')
  webstore = webstoreClient(
    Object.assign({}, WEBSTORE_CREDENTIALS, {
      extensionId: WEBSTORE_ID
    })
  )
} catch (e) {}

const js = function() {
  return (
    gulp
      .src(paths.entries, { read: false }) // no need of reading file because browserify does.
      // transform file objects using gulp-tap plugin
      .pipe(
        tap(function(file) {
          // replace file contents with browserify's bundle stream
          file.contents = browserify(file.path, {
            debug: true
          })
            .transform(babelify, {
              global: true,
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { pragma: 'h' }]
              ]
            })
            .bundle()
        })
      )
      .pipe(gulp.dest('./dist/js/'))
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
      crxPath: `${paths.builds}/floccus-build-v${VERSION}.crx`
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
  let jsWatcher = gulp.watch(paths.js, js)
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
exports.watch = gulp.series(main, watch)
exports.publish = publish
/*
 * Define default task that can be called by just running `gulp` from cli
 */
exports.default = main
