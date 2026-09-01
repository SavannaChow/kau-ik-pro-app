import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

assert.equal(loadConfig({}).host, '127.0.0.1');
assert.equal(
    loadConfig({ KAUIK_HOST: '0.0.0.0', PORT: '8088' }).host,
    '0.0.0.0',
);
assert.equal(loadConfig({ PORT: '8088' }).port, 8088);

console.log('ALL GREEN');
