import * as path from 'path';

const packageJson = require(path.resolve(__dirname, '..', 'package.json'));

export const APP_VERSION = packageJson.version;
export const APP_NODE_ENGINE = packageJson.engines?.node || '>=18.0.0';
