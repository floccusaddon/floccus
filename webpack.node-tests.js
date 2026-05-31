/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path')
const webpack = require('webpack')

module.exports = {
  mode: 'development',
  target: 'node',
  devtool: 'inline-source-map',
  entry: {
    'fake-tests': path.join(__dirname, 'src', 'entries', 'test-node.js'),
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'node-tests'),
    filename: '[name].js',
  },
  externals: {
    mocha: 'commonjs mocha',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            cacheDirectory: true,
            presets: [
              [
                '@babel/preset-env',
                {
                  useBuiltIns: 'usage',
                  corejs: { version: '3.19', proposals: true },
                  shippedProposals: true,
                },
              ],
            ],
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
    alias: {
      '@capacitor/preferences': path.resolve(
        __dirname,
        'src',
        'test',
        'node-shims',
        'capacitor-preferences.js'
      ),
      '@capacitor/share': path.resolve(
        __dirname,
        'src',
        'test',
        'node-shims',
        'capacitor-share.js'
      ),
      '@capacitor/filesystem': path.resolve(
        __dirname,
        'src',
        'test',
        'node-shims',
        'capacitor-filesystem.js'
      ),
      '@sentry/browser': path.resolve(
        __dirname,
        'src',
        'test',
        'node-shims',
        'sentry-browser.js'
      ),
    },
  },
  plugins: [
    new webpack.DefinePlugin({
      BROWSERSLIST_REGEX: require('./supportedBrowsers'),
      IS_BROWSER: 'false',
    }),
  ],
}

