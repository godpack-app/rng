import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChainError,
  RngChain,
  entryHash,
  generateRandomValues,
  genesisHead,
  probability,
  verifyEntries,
  type DocumentStore,
  type DocumentTransaction,
} from '../src/chain.js';
import { RNG_VALUE_RANGE } from '../src/models/rng.js';

class MemoryStore implements DocumentStore {
  private readonly documents = new Map<string, unknown>();
  private tail: Promise<void> = Promise.resolve();

  async get(path: string): Promise<unknown> {
    return this.documents.get(path);
  }

  async getMany(paths: readonly string[]): Promise<readonly unknown[]> {
    return paths.map((path) => this.documents.get(path));
  }

  runTransaction<T>(callback: (transaction: DocumentTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const writes = new Map<string, unknown>();
      const transaction: DocumentTransaction = {
        get: async (path) => this.documents.get(path),
        create: (path, value) => {
          if (this.documents.has(path) || writes.has(path)) {
            throw new Error(`Document already exists: ${path}`);
          }

          writes.set(path, value);
        },
        set: (path, value) => {
          writes.set(path, value);
        },
      };

      const result = await callback(transaction);

      for (const [path, value] of writes) {
        this.documents.set(path, value);
      }

      return result;
    };

    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);

    return result;
  }
}

class RetryOnceStore extends MemoryStore {
  readonly firstAttemptEntries: unknown[] = [];
  private retry = true;

  override async runTransaction<T>(
    callback: (transaction: DocumentTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.retry) {
      this.retry = false;

      await callback({
        get: (path) => this.get(path),
        create: (path, value) => {
          if (path.startsWith('rngEntries/')) {
            this.firstAttemptEntries.push(value);
          }
        },
        set: () => undefined,
      });
    }

    return super.runTransaction(callback);
  }
}

test('a batch commits consecutive linked probabilities', async () => {
  const chain = new RngChain(new MemoryStore());
  const first = await chain.append(3, 'batch-one');
  const second = await chain.append(2, 'batch-two');
  const entries = await chain.entries(0, 10);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, false);
  assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2, 3, 4, 5]);
  assert.deepEqual(verifyEntries(entries), await chain.head());
  assert.equal((await chain.checkpoint())?.hash, entries.at(-1)?.hash);

  for (const entry of entries) {
    assert.ok(entry.random_u53 >= 0 && entry.random_u53 < RNG_VALUE_RANGE);
    assert.ok(probability(entry) >= 0 && probability(entry) < 1);
  }
});

test('concurrent batches preserve a single chain and idempotent retries', async () => {
  const chain = new RngChain(new MemoryStore());
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => chain.append(4, `request-${index}`)),
  );
  const entries = await chain.entries(0, 100);

  assert.equal(entries.length, 80);
  assert.deepEqual(verifyEntries(entries), await chain.head());

  const replay = await chain.append(4, 'request-0');
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.entries, results[0]?.entries);
  assert.equal((await chain.head()).sequence, 80);

  await assert.rejects(
    chain.append(5, 'request-0'),
    (error) => error instanceof ChainError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('a retried transaction uses the original random values', async () => {
  const store = new RetryOnceStore();
  const chain = new RngChain(store);
  const result = await chain.append(3, 'retry-test');

  assert.deepEqual(store.firstAttemptEntries, result.entries);
  assert.deepEqual(verifyEntries(await chain.entries(0, 3)), await chain.head());
});

test('public pages are ordered and a changed value fails verification', async () => {
  const chain = new RngChain(new MemoryStore());
  await chain.append(5, 'page-test');

  const page = await chain.entries(2, 2);
  assert.deepEqual(page.map((entry) => entry.sequence), [3, 4]);
  assert.equal((await chain.entry(4))?.hash, page[1]?.hash);
  assert.equal(await chain.entry(6), null);
  assert.deepEqual(await chain.entries(5, 2), []);

  const all = await chain.entries(0, 5);
  const tampered = all.map((entry) => ({ ...entry }));
  const changed = tampered[2];

  if (!changed) {
    throw new Error('Expected a third entry');
  }

  changed.random_u53 = (changed.random_u53 + 1) % RNG_VALUE_RANGE;

  assert.throws(
    () => verifyEntries(tampered, genesisHead),
    (error) => error instanceof ChainError && error.code === 'CORRUPT_CHAIN',
  );
});

test('random generation validates the batch size', () => {
  assert.equal(generateRandomValues(8).length, 8);
  assert.throws(() => generateRandomValues(0), ChainError);
  assert.throws(() => generateRandomValues(129), ChainError);
});

test('the published hash example remains stable', () => {
  assert.equal(
    entryHash({
      version: 1,
      sequence: 1,
      batch_id: '550e8400-e29b-41d4-a716-446655440000',
      batch_index: 0,
      random_u53: 123456789,
      previous_hash: '0'.repeat(64),
      created_at: '2026-10-01T12:00:00.000Z',
    }),
    'ee694f2909f98df72169fb24049bbada27bd4d7387c48efdfda746ef9d71a24b',
  );
});
