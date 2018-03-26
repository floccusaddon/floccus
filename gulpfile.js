var gulp = require('gulp')
var browserify = require('browserify')
var babelify = require('babelify')
var tap = require('gulp-tap')

gulp.task('default', ['html', 'js', '3rd-party'])

gulp.task('js', function () {
  return gulp.src('src/entries/*.js', {read: false}) // no need of reading file because browserify does.
    // transform file objects using gulp-tap plugin
    .pipe(tap(function (file) {
      // replace file contents with browserify's bundle stream
      file.contents = browserify(file.path, {
        debug: true,
      })
        .transform(babelify, {
          presets: ['es2015']
          , plugins: [
            'transform-object-rest-spread'
            , 'syntax-jsx'
            , 'transform-react-jsx'
            , 'transform-async-to-generator'
          ]
        })
        .bundle()
    }))
    .pipe(gulp.dest('./dist/js/'))
})

gulp.task('html', function () {
  return gulp.src('./views/*.html').pipe(gulp.dest('./dist/html/'))
})

gulp.task('3rd-party', ['polyfill', 'mocha'])

gulp.task('polyfill', function () {
  return gulp.src('./node_modules/babel-polyfill/dist/polyfill.js').pipe(gulp.dest('./dist/js/'))
})

gulp.task('mocha', ['mochajs', 'mochacss'])

gulp.task('mochajs', function () {
  return gulp.src('./node_modules/mocha/mocha.js').pipe(gulp.dest('./dist/js/'))
})
gulp.task('mochacss', function () {
  return gulp.src('./node_modules/mocha/mocha.css').pipe(gulp.dest('./dist/css/'))
})
