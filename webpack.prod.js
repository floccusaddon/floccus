const merge = require('webpack-merge')
const common = require('./webpack.common.js')
const webpack = require('webpack')

module.exports = common.map(common => merge(common, {
  mode: 'production',
  // The native build's maps would only bloat the app package
  devtool: common.entry.native ? false : 'source-map',
  optimization: {
    splitChunks: { chunks: 'all' },
  },
  plugins: [
    new webpack.DefinePlugin({
      DEBUG: JSON.stringify(true)
    }),
  ]
}))
