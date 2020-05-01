const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')
const VuetifyLoaderPlugin = require('vuetify-loader/lib/plugin')

module.exports = {
  entry: {
    'background-script': path.join(
      __dirname,
      'src',
      'entries',
      'background-script.js'
    ),
    options: path.join(__dirname, 'src', 'entries', 'options.js'),
    test: path.join(__dirname, 'src', 'entries', 'test.js')
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'js'),
    publicPath: '/dist/js/',
    filename: `[name].js`,
  },
  module: {
    rules: [
      {
        test: /\.(js|vue)$/,
        use: 'eslint-loader',
        exclude: /node_modules/,
        enforce: 'pre',
      },
      {
        test: /\.css$/,
        use: ['vue-style-loader', 'css-loader'],
      },
      {
        test: /\.s(c|a)ss$/,
        use: [
          'vue-style-loader',
          'css-loader',
          {
            loader: 'sass-loader',
            // Requires sass-loader@^8.0.0
            options: {
              implementation: require('sass'),
              sassOptions: {
                fiber: require('fibers'),
                indentedSyntax: true, // optional
              },
            },
          },
        ],
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: '> 5%, not dead',
                  useBuiltIns: 'usage',
                  modules: false,
                },
              ],
            ],
          },
        },
      },
    ],
  },
  plugins: [new VueLoaderPlugin(), new VuetifyLoaderPlugin()],
  resolve: {
    extensions: ['*', '.js', '.vue'],
  },
}
