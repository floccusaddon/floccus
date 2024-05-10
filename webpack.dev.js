const merge = require('webpack-merge')
const common = require('./webpack.common.js')
const webpack = require('webpack')

module.exports = merge(common, {
  mode: 'development',
  devtool: 'cheap-module-source-map',
  optimization: {
    splitChunks: { chunks: 'async' },
  },
  plugins: [
    new webpack.DefinePlugin({
      'DEBUG': JSON.stringify(true)
    })
  ]
})
