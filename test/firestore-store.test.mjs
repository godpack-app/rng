import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FirestoreStore } from '../src/firestore-store.js';

class FakeFirestore {
  documents = new Map();
  getAllCalls = 0;

  doc(path) {
    return {
      path,
      get: async () => ({ data: () => this.documents.get(path) }),
    };
  }

  async getAll(...references) {
    this.getAllCalls++;
    return references.map((ref) => ({
      ref,
      data: () => this.documents.get(ref.path),
    }));
  }

  async runTransaction(callback) {
    const writes = new Map();
    const transaction = {
      get: async (ref) => ({ data: () => this.documents.get(ref.path) }),
      create: (ref, value) => {
        if (this.documents.has(ref.path) || writes.has(ref.path)) {
          throw new Error(`Document already exists: ${ref.path}`);
        }

        writes.set(ref.path, value);
      },
      set: (ref, value) => {
        writes.set(ref.path, value);
      },
    };

    const result = await callback(transaction);

    for (const [path, value] of writes) {
      this.documents.set(path, value);
    }

    return result;
  }
}

test('FirestoreStore reads individual and ordered documents', async () => {
  const database = new FakeFirestore();
  const store = new FirestoreStore(database);
  database.documents.set('records/first', { sequence: 1 });
  database.documents.set('records/second', { sequence: 2 });

  assert.deepEqual(await store.get('records/first'), { sequence: 1 });
  assert.equal(await store.get('records/missing'), undefined);
  assert.deepEqual(await store.getMany([]), []);
  assert.equal(database.getAllCalls, 0);
  assert.deepEqual(await store.getMany(['records/second', 'records/first']), [
    { sequence: 2 },
    { sequence: 1 },
  ]);
  assert.equal(database.getAllCalls, 1);
});

test('FirestoreStore forwards transaction reads and atomic writes', async () => {
  const database = new FakeFirestore();
  const store = new FirestoreStore(database);
  database.documents.set('chain/head', { sequence: 0 });

  const result = await store.runTransaction(async (transaction) => {
    assert.deepEqual(await transaction.get('chain/head'), { sequence: 0 });
    assert.equal(await transaction.get('chain/missing'), undefined);
    transaction.create('chain/entry', { sequence: 1 });
    transaction.set('chain/head', { sequence: 1 });
    assert.deepEqual(database.documents.get('chain/head'), { sequence: 0 });
    return 'committed';
  });

  assert.equal(result, 'committed');
  assert.deepEqual(database.documents.get('chain/entry'), { sequence: 1 });
  assert.deepEqual(database.documents.get('chain/head'), { sequence: 1 });
});
