const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const manifestFile = isProduction ? 'manifest.prod.json' : 'manifest.dev.json';

  return {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? false : 'cheap-module-source-map',
    
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'content/index': './src/content/index.ts'
    },
    
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true
    },
    
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      alias: {
        '@api': path.resolve(__dirname, 'src/api'),
        '@types': path.resolve(__dirname, 'src/types'),
        '@content': path.resolve(__dirname, 'src/content'),
        '@background': path.resolve(__dirname, 'src/background'),
        '@config': path.resolve(__dirname, 'src/config')
      }
    },
    
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                configFile: 'tsconfig.json'
              }
            }
          ],
          exclude: /node_modules/
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: manifestFile,
            to: 'manifest.json'
          },
          {
            from: 'public',
            to: '.',
            globOptions: {
              ignore: ['**/.*']
            }
          }
        ]
      })
    ],
    
    optimization: {
      minimize: isProduction,
      splitChunks: false
    },
    
    // Chrome extension specific settings
    target: 'web',
    experiments: {
      outputModule: false
    },

    watchOptions: {
      ignored: /node_modules/,
      poll: 500
    }
  };
};
