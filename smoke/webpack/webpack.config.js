import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  mode: 'production',
  entry: './main.js',
  output: {
    path: `${here}dist`,
    filename: 'main.js',
    publicPath: '',
    assetModuleFilename: '[name]-[contenthash][ext]',
  },
  experiments: { topLevelAwait: true },
};
