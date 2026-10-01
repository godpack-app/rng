import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChainError,
  RngChain,
  entryHash,
  genesisHead,
} from '../src/chain.js';
import { MemoryStore } from './support/memory-store.js';

function onlyPath(store: MemoryStore, prefix: string): string {
  const paths = store.paths(prefix);
  assert.equal(paths.length, 1);
  const path = paths[0];
  assert.ok(path);
  return path;
}

function isCorruptChain(error: unknown): boolean {
  return error instanceof ChainError && error.code === 'CORRUPT_CHAIN';
}

class ShortReadStore extends MemoryStore {
  override async getMany(paths: readonly string[]): Promise<readonly unknown[]> {
    return (await super.getMany(paths)).slice(0, -1);
  }
}

class ReorderedReadStore extends MemoryStore {
  override async getMany(paths: readonly string[]): Promise<readonly unknown[]> {
    return [...await super.getMany(paths)].reverse();
  }
}

test('invalid append values and idempotency keys are rejected', async () => {
  const chain = new RngChain(new MemoryStore());

  for (const count of [0, 129, 1.5, Number.NaN]) {
    await assert.rejects(
      chain.append(count, 'valid-key'),
      (error) => error instanceof ChainError && error.code === 'INVALID_REQUEST',
    );
  }

  for (const key of ['', 'a b', 'x'.repeat(129)]) {
    await assert.rejects(
      chain.append(1, key),
      (error) => error instanceof ChainError && error.code === 'INVALID_REQUEST',
    );
  }
});

test('a corrupt or exhausted head cannot be used for reads or new draws', async () => {
  const store = new MemoryStore();
  const chain = new RngChain(store);
  store.setRaw('rngChain/head', { invalid: true });

  await assert.rejects(chain.head(), isCorruptChain);
  await assert.rejects(chain.append(1, 'bad-head'), isCorruptChain);

  store.setRaw('rngChain/head', {
    ...genesisHead,
    sequence: Number.MAX_SAFE_INTEGER,
  });
  await assert.rejects(chain.append(1, 'exhausted'), isCorruptChain);
});

test('a malformed saved receipt cannot be replayed', async () => {
  const store = new MemoryStore();
  const chain = new RngChain(store);
  await chain.append(1, 'receipt-test');
  store.setRaw(onlyPath(store, 'rngRequests/'), { invalid: true });

  await assert.rejects(chain.append(1, 'receipt-test'), isCorruptChain);
});

test('a missing or corrupt entry fails direct reads and replay', async () => {
  const store = new MemoryStore();
  const chain = new RngChain(store);
  await chain.append(1, 'entry-test');
  const path = onlyPath(store, 'rngEntries/');
  const original = await store.get(path);

  store.deleteRaw(path);
  await assert.rejects(chain.entry(1), isCorruptChain);

  store.setRaw(path, { invalid: true });
  await assert.rejects(chain.entry(1), isCorruptChain);
  await assert.rejects(chain.append(1, 'entry-test'), isCorruptChain);

  store.setRaw(path, original);
  assert.equal((await chain.entry(1))?.sequence, 1);
});

test('an entry stored under the wrong sequence is rejected', async () => {
  const store = new MemoryStore();
  const chain = new RngChain(store);
  const result = await chain.append(1, 'wrong-sequence');
  const original = result.entries[0];
  assert.ok(original);
  const altered = { ...original, sequence: 2 };
  store.setRaw(onlyPath(store, 'rngEntries/'), {
    ...altered,
    hash: entryHash(altered),
  });

  await assert.rejects(chain.entry(1), isCorruptChain);
});

test('a replay requires the full original batch and matching evidence', async () => {
  const shortStore = new ShortReadStore();
  const shortChain = new RngChain(shortStore);
  await shortChain.append(2, 'short-replay');
  await assert.rejects(shortChain.append(2, 'short-replay'), isCorruptChain);

  const store = new MemoryStore();
  const chain = new RngChain(store);
  const result = await chain.append(1, 'altered-replay');
  const original = result.entries[0];
  assert.ok(original);
  const altered = { ...original, batch_id: '550e8400-e29b-41d4-a716-446655440000' };
  store.setRaw(onlyPath(store, 'rngEntries/'), {
    ...altered,
    hash: entryHash(altered),
  });
  await assert.rejects(chain.append(1, 'altered-replay'), isCorruptChain);
});

test('invalid direct read parameters and incomplete pages are rejected', async () => {
  const chain = new RngChain(new MemoryStore());

  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(chain.entry(sequence), (error) => error instanceof ChainError);
  }

  const invalidPages: Array<[number, number]> = [[-1, 1], [0, 0], [0, 101], [1.5, 1]];

  for (const [after, limit] of invalidPages) {
    await assert.rejects(chain.entries(after, limit), (error) => error instanceof ChainError);
  }

  const shortStore = new ShortReadStore();
  const shortChain = new RngChain(shortStore);
  await shortChain.append(2, 'short-page');
  await assert.rejects(shortChain.entries(0, 2), isCorruptChain);

  const reversedStore = new ReorderedReadStore();
  const reversedChain = new RngChain(reversedStore);
  await reversedChain.append(2, 'reversed-page');
  await assert.rejects(reversedChain.entries(0, 2), isCorruptChain);
});

test('a checkpoint must match the committed head', async () => {
  const store = new MemoryStore();
  const chain = new RngChain(store);
  await chain.append(1, 'checkpoint-test');
  store.setRaw(onlyPath(store, 'rngCheckpoints/'), { invalid: true });

  await assert.rejects(chain.checkpoint(), isCorruptChain);
});
