const {
  sentryWebpackPlugin
} = require("@sentry/webpack-plugin")
const merge = require('webpack-merge')
const common = require('./webpack.common.js')
const webpack = require('webpack')
const packageJSON = require('./package.json')

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  optimization: {
    splitChunks: { chunks: 'all' },
  },
  plugins: [
    new webpack.DefinePlugin({
      DEBUG: JSON.stringify(false)
    }),
    sentryWebpackPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "marcel-klehr",
      project: "floccus",
      release: {
        name: packageJSON.version
      }
    }),
  ]
})
