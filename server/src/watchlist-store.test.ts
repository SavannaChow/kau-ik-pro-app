import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WatchlistStore } from './watchlist-store.ts';

const file = join(mkdtempSync(join(tmpdir(), 'kauik-watchlists-')), 'watchlists.json');
const store = new WatchlistStore(file);

const mine = store.create('我的自選', []);
const dividend = store.create('高股息', [
    { security_type: 'STK', exchange: 'TSE', code: '0056' },
]);

assert.equal(store.all().length, 2);
assert.equal(store.rename(dividend.id, '存股'), dividend);
assert.equal(store.all()[1]?.name, '存股');
assert.equal(store.delete(dividend.id), true);
assert.equal(store.delete(dividend.id), false);
assert.deepEqual(store.all().map((list) => list.id), [mine.id]);

const persisted = JSON.parse(readFileSync(file, 'utf8')) as { name: string }[];
assert.deepEqual(persisted.map((list) => list.name), ['我的自選']);

console.log('  ok   watchlist create, rename, delete and persistence');
