import assert from 'node:assert/strict';
import { verifyWebBasicAuth, webAuthConfigured } from './web-auth.ts';

const env = {
    KAUIK_WEB_USERNAME: 'savanna',
    KAUIK_WEB_PASSWORD: 'a-long-password',
} as NodeJS.ProcessEnv;
const header = `Basic ${Buffer.from('savanna:a-long-password').toString('base64')}`;

assert.equal(webAuthConfigured({}), false);
assert.equal(webAuthConfigured(env), true);
assert.equal(verifyWebBasicAuth(undefined, {}), true);
assert.equal(verifyWebBasicAuth(header, env), true);
assert.equal(
    verifyWebBasicAuth(
        `Basic ${Buffer.from('savanna:wrong').toString('base64')}`,
        env,
    ),
    false,
);
assert.equal(verifyWebBasicAuth('Bearer nope', env), false);

console.log('ALL GREEN');
