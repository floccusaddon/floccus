const path = require('path')

module.exports = {
  entry: {
    "background-script": path.join(__dirname, 'src', 'entries', 'background-script.js'),
    options: path.join(__dirname, 'src', 'entries', 'options.js'),
    test: path.join(__dirname, 'src', 'entries', 'test.js')
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'js'),
    publicPath: '/dist/js/',
    filename: `[name].js`
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  chrome: "73",
                  firefox: "68"
                },
                useBuiltIns: 'usage'
              }],
              ['@babel/preset-react', {
                'pragma': 'h',
              }]
            ]
          }
        }
      }
    ]
  },
  plugins: [],
  resolve: {
    extensions: ['*', '.js']
  }
}
