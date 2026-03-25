const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')
const VuetifyLoaderPlugin = require('vuetify-loader/lib/plugin')
const webpack = require('webpack')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const common = {
  output: {
    path: path.resolve(__dirname, 'dist', 'js'),
    publicPath: '/dist/js/',
    filename: `[name].js`,
  },
  module: {
    rules: [
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
                fiber: false,
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
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          }
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
    extensions: ['.js', '.vue', '.ts', '.json'],
    fallback: {
      buffer: require.resolve('buffer'),
      process: require.resolve('process/browser.js'),
      stream: require.resolve('stream-browserify'),
    },
  },
  plugins: [
    new VueLoaderPlugin(),
    new VuetifyLoaderPlugin(),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser.js',
    }),
    new webpack.NormalModuleReplacementPlugin(
      /@sentry\/browser\/.*?lazyLoadIntegration/,
      path.resolve(__dirname, 'src/build-fixtures/lazyLoadIntegration.js')
    ),
    new webpack.DefinePlugin({
      BROWSERSLIST_REGEX: require('./supportedBrowsers')
    })
  ]
}

module.exports = [
  /* CSS-ONLY OPTIONS BUILD */
  {
    ...common,
    entry: path.join(__dirname, 'src', 'entries', 'options.js'),
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        {
          test: /\.s(c|a)ss$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            {
              loader: 'sass-loader',
              // Requires sass-loader@^8.0.0
              options: {
                implementation: require('sass'),
                sassOptions: {
                  fiber: false,
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
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            }
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
    plugins: [
      ...common.plugins,
      new webpack.DefinePlugin({
        IS_BROWSER: 'true'
      }),
      new MiniCssExtractPlugin({ filename: 'css/[name].css'})
    ],
    resolve: {
      extensions: ['.js', '.vue', '.ts', '.json'],
    },
  }, {
    /* BROWSER BUILD */
    ...common,
    entry: {
      'background-script': path.join(
        __dirname,
        'src',
        'entries',
        'background-script.js'
      ),
      options: path.join(__dirname, 'src', 'entries', 'options.js'),
      test: path.join(__dirname, 'src', 'entries', 'test.js'),
    },
    plugins: [
      ...common.plugins,
      new webpack.DefinePlugin({
        'IS_BROWSER': 'true'
      }),
    ]
  }, {
    /* NATIVE BUILD */
    ...common,
    entry: {
      native: path.join(__dirname, 'src', 'entries', 'native.js'),
    },
    plugins: [
      ...common.plugins,
      new webpack.DefinePlugin({
        IS_BROWSER: 'false'
      }),
    ],
  }
]
