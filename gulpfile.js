const gulp = require('gulp')
const rollupEach = require('gulp-rollup-each')
const resolve = require('rollup-plugin-node-resolve')
const commonjs = require('rollup-plugin-commonjs')
const json = require('rollup-plugin-json')
const jsx = require('rollup-plugin-jsx')
const builtins = require('rollup-plugin-node-builtins')
const globals = require('rollup-plugin-node-globals')
const acornJsx = require('acorn-jsx')
const createZip = require('gulp-zip')
const createCrx = require('./lib/gulp-crx')
const run = require('gulp-run-command').main
const webstoreClient = require('chrome-webstore-upload')
const fs = require('fs')
const path = require('path')

const VERSION = require('./package.json').version
const paths = {
  zip: [
    '**',
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

const js = async() => {
  return (
    gulp
      .src(paths.entries, { read: false }) // no need of reading file because browserify does.
      // transform file objects using gulp-tap plugin
      .pipe(
        rollupEach(
          {
            // inputOptions
            plugins: [
              resolve({ preferBuiltins: false }),
              commonjs(),
              builtins(),
              json(),
              globals(),
              jsx({ factory: 'h' })
            ],
            isCache: true, // enable Rollup cache
            acornInjectPlugins: [acornJsx()]
          },
          file => {
            return {
              format: 'iife',
              name: path.basename(file.path, '.js')
            }
          }
        )
      )
      .pipe(gulp.dest('./dist/js/'))
  )
}

const html = () => {
  return gulp.src(paths.views).pipe(gulp.dest('./dist/html/'))
}

const mochajs = () => {
  return gulp.src('./node_modules/mocha/mocha.js').pipe(gulp.dest('./dist/js/'))
}
const mochacss = () => {
  return gulp
    .src('./node_modules/mocha/mocha.css')
    .pipe(gulp.dest('./dist/css/'))
}

const mocha = gulp.parallel(mochajs, mochacss)
const thirdparty = mocha

const main = gulp.parallel(html, js, thirdparty)

const zip = gulp.series(main, function() {
  return gulp
    .src(paths.zip)
    .pipe(createZip(`floccus-build-v${VERSION}.zip`))
    .pipe(gulp.dest(paths.builds))
})

const xpi = gulp.series(main, function() {
  return gulp
    .src(paths.zip)
    .pipe(createZip(`floccus-build-v${VERSION}.xpi`))
    .pipe(gulp.dest(paths.builds))
})

const crx = gulp.series(main, function() {
  return gulp
    .src(paths.zip)
    .pipe(
      createCrx({
        privateKey: fs.readFileSync('./key.pem', 'utf8'),
        filename: `floccus-build-v${VERSION}.crx`
      })
    )
    .pipe(gulp.dest(paths.builds))
})

const keygen = function() {
  return run(
    'openssl genpkey' +
      ' -algorithm RSA -out ./key.pem -pkeyopt rsa_keygen_bits:2048'
  )
}

const pushWebstore = function() {
  return webstore
    .uploadExisting(
      fs.createReadStream(`${paths.builds}floccus-build-v${VERSION}.zip`)
    )
    .then(function() {
      return webstore.publish('main')
    })
}
const release = gulp.parallel(zip, xpi, crx)

const watch = function() {
  gulp.watch(paths.js, js)
  gulp.watch(paths.views, html)
}

module.exports = {
  keygen,
  pushWebstore,
  release,
  default: main,
  watch
}
