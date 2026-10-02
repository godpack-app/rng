import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Check } from 'typebox/value';
import { createApp } from '../src/app.js';
import { ChainError, RngChain, genesisHead } from '../src/chain.js';
import { RngPublicEntrySchema, type RngCheckpoint } from '../src/models/rng.js';
import { MemoryStore } from './support/memory-store.js';
import type { DocumentStore, DocumentTransaction } from '../src/chain.js';

const API_KEY = 'test-api-key';

async function withApp<T>(
  app: ReturnType<typeof createApp>,
  action: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP address');
    }

    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createTestApp(store = new MemoryStore()) {
  return createApp({ chain: new RngChain(store), apiKey: API_KEY });
}

function draw(baseUrl: string, key: string, count: number): Promise<Response> {
  return fetch(`${baseUrl}/v1/draw-batches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Idempotency-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ count }),
  });
}

class ThrowingStore implements DocumentStore {
  constructor(private readonly error: unknown) {}

  async get(): Promise<unknown> {
    throw this.error;
  }

  async getMany(): Promise<readonly unknown[]> {
    throw this.error;
  }

  async runTransaction<T>(
    _callback: (transaction: DocumentTransaction) => Promise<T>,
  ): Promise<T> {
    throw this.error;
  }
}

test('the app requires an API key', () => {
  assert.throws(() => createApp({ chain: new RngChain(new MemoryStore()), apiKey: '' }));
});

test('write authentication rejects missing, malformed, and incorrect keys', async () => {
  await withApp(createTestApp(), async (baseUrl) => {
    for (const authorization of [undefined, API_KEY, 'Bearer short', 'Bearer test-api-kex']) {
      const response = await fetch(`${baseUrl}/v1/draw-batches`, {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'unauthorized' });
    }
  });
});

test('a batch responds after commit and replays with the same evidence', async () => {
  const checkpoints: RngCheckpoint[] = [];
  const chain = new RngChain(new MemoryStore());
  const app = createApp({
    chain,
    apiKey: API_KEY,
    onCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  });

  await withApp(app, async (baseUrl) => {
    const first = await draw(baseUrl, 'opening-1', 2);
    const firstBody: unknown = await first.json();
    const replay = await draw(baseUrl, 'opening-1', 2);
    const replayBody: unknown = await replay.json();

    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.ok(firstBody && typeof firstBody === 'object' && 'entries' in firstBody);
    assert.ok(Array.isArray(firstBody.entries));
    assert.equal(firstBody.entries.length, 2);

    for (const [index, entry] of firstBody.entries.entries()) {
      assert.ok(Check(RngPublicEntrySchema, entry));
      assert.equal(entry.batch_index, index);
      assert.equal(entry.probability, entry.random_u53 / 2 ** 53);
    }

    assert.ok(replayBody && typeof replayBody === 'object' && 'entries' in replayBody);
    assert.deepEqual(replayBody.entries, firstBody.entries);
    assert.ok('replayed' in firstBody && 'replayed' in replayBody);
    assert.equal(firstBody.replayed, false);
    assert.equal(replayBody.replayed, true);
    assert.ok('anchor_status' in firstBody);
    assert.equal(firstBody.anchor_status, 'pending');
    assert.equal(checkpoints.length, 1);

    const head = await fetch(`${baseUrl}/v1/head`);
    assert.equal(head.status, 200);
    assert.deepEqual(await head.json(), await chain.head());

    const conflict = await draw(baseUrl, 'opening-1', 1);
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: 'idempotency_conflict' });
  });
});

test('write validation rejects malformed bodies, missing keys, and invalid keys', async () => {
  await withApp(createTestApp(), async (baseUrl) => {
    for (const body of ['{}', '{"count":0}', '{"count":129}', '{"count":1,"extra":true}']) {
      const response = await fetch(`${baseUrl}/v1/draw-batches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body,
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid_request' });
    }

    const noKey = await fetch(`${baseUrl}/v1/draw-batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: '{"count":1}',
    });
    assert.deepEqual(await noKey.json(), { error: 'missing_idempotency_key' });

    const badKey = await draw(baseUrl, 'invalid key', 1);
    assert.equal(badKey.status, 400);
    assert.deepEqual(await badKey.json(), { error: 'invalid_request' });
  });
});

test('public reads expose ordered entries, pagination, head, and pending checkpoint', async () => {
  await withApp(createTestApp(), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const genesis = await fetch(`${baseUrl}/v1/head`);
    assert.deepEqual(await genesis.json(), genesisHead);

    const noCheckpoint = await fetch(`${baseUrl}/v1/checkpoints/latest`);
    assert.deepEqual(await noCheckpoint.json(), { checkpoint: null });

    assert.equal((await draw(baseUrl, 'read-test', 3)).status, 201);

    const page = await fetch(`${baseUrl}/v1/entries?after=1&limit=2`);
    const pageBody: unknown = await page.json();
    assert.ok(pageBody && typeof pageBody === 'object' && 'entries' in pageBody);
    assert.ok(Array.isArray(pageBody.entries));
    assert.deepEqual(pageBody.entries.map((entry) => entry.sequence), [2, 3]);
    assert.ok('next_after' in pageBody);
    assert.equal(pageBody.next_after, 3);

    const defaultPage = await fetch(`${baseUrl}/v1/entries`);
    const defaultBody: unknown = await defaultPage.json();
    assert.ok(defaultBody && typeof defaultBody === 'object' && 'entries' in defaultBody);
    assert.ok(Array.isArray(defaultBody.entries));
    assert.equal(defaultBody.entries.length, 3);

    const empty = await fetch(`${baseUrl}/v1/entries?after=3`);
    assert.deepEqual(await empty.json(), { entries: [], next_after: 3 });

    const one = await fetch(`${baseUrl}/v1/entries/2`);
    const oneBody: unknown = await one.json();
    assert.ok(Check(RngPublicEntrySchema, oneBody));
    assert.equal(oneBody.sequence, 2);

    const missing = await fetch(`${baseUrl}/v1/entries/4`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not_found' });

    const checkpoint = await fetch(`${baseUrl}/v1/checkpoints/latest`);
    const checkpointBody: unknown = await checkpoint.json();
    assert.ok(checkpointBody && typeof checkpointBody === 'object' && 'checkpoint' in checkpointBody);
    assert.ok(checkpointBody.checkpoint && typeof checkpointBody.checkpoint === 'object');
    assert.ok('status' in checkpointBody.checkpoint);
    assert.equal(checkpointBody.checkpoint.status, 'pending');
  });
});

test('read parameters reject invalid integers and limits', async () => {
  await withApp(createTestApp(), async (baseUrl) => {
    const invalidQueries = [
      'after=-1',
      'after=01',
      'after=x',
      'after=9007199254740992',
      'limit=0',
      'limit=101',
    ];

    for (const query of invalidQueries) {
      const response = await fetch(`${baseUrl}/v1/entries?${query}`);
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: 'invalid_pagination' });
    }

    for (const sequence of ['0', '-1', '01', 'x', '9007199254740992']) {
      const response = await fetch(`${baseUrl}/v1/entries/${sequence}`);
      assert.equal(response.status, 400, sequence);
      assert.deepEqual(await response.json(), { error: 'invalid_sequence' });
    }
  });
});

test('HTTP parser errors use JSON error codes', async () => {
  await withApp(createTestApp(), async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/v1/draw-batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'invalid_json' });

    const oversized = await fetch(`${baseUrl}/v1/draw-batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, padding: 'x'.repeat(5000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'invalid_request' });
  });
});

test('storage failures map to temporary or internal errors', async () => {
  const cases: Array<{ error: unknown; status: number; code: string }> = [
    { error: { code: 10 }, status: 503, code: 'temporarily_unavailable' },
    { error: { code: 14 }, status: 503, code: 'temporarily_unavailable' },
    { error: new ChainError('CORRUPT_CHAIN', 'bad head'), status: 500, code: 'corrupt_chain' },
    { error: new Error('unexpected'), status: 500, code: 'internal_error' },
  ];

  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    for (const item of cases) {
      const app = createApp({
        chain: new RngChain(new ThrowingStore(item.error)),
        apiKey: API_KEY,
      });

      await withApp(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/head`);
        assert.equal(response.status, item.status);
        assert.deepEqual(await response.json(), { error: item.code });
      });
    }
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.[0], 'RNG request failed');
});

test('checkpoint publishing errors do not change a committed draw response', async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const app = createApp({
      chain: new RngChain(new MemoryStore()),
      apiKey: API_KEY,
      onCheckpoint: async () => {
        throw new Error('publisher unavailable');
      },
    });

    await withApp(app, async (baseUrl) => {
      const response = await draw(baseUrl, 'publisher-test', 1);
      assert.equal(response.status, 201);
      const body: unknown = await response.json();
      assert.ok(body && typeof body === 'object' && 'anchor_status' in body);
      assert.equal(body.anchor_status, 'pending');
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.[0], 'Checkpoint publisher failed');
});

test('the explorer shows an empty chain and defaults to the latest draw', async () => {
  const chain = new RngChain(new MemoryStore());
  const app = createApp({ chain, apiKey: API_KEY });

  await withApp(app, async (baseUrl) => {
    const empty = await fetch(baseUrl);
    assert.equal(empty.status, 200);
    assert.match(empty.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    const emptyHtml = await empty.text();
    assert.match(emptyHtml, /<html lang="zh-Hant">/);
    assert.match(emptyHtml, /GodPack 亂數鏈/);
    assert.match(emptyHtml, /--godpack-accent: #f7ba0b/);
    assert.match(emptyHtml, /目前沒有紀錄/);
    assert.doesNotMatch(emptyHtml, /eyebrow|class="intro"|class="form-help"/);

    await chain.append(3, 'explorer-latest');
    const latest = await fetch(baseUrl);
    const html = await latest.text();
    assert.match(html, /紀錄 #3/);
    assert.match(html, /前 20 筆/);
    assert.match(html, /後 20 筆/);
    assert.match(html, /沒有更新的紀錄/);
  });
});

test('the explorer retrieves exactly 20 entries before and after a sequence', async () => {
  const chain = new RngChain(new MemoryStore());
  await chain.append(50, 'explorer-window');
  const target = await chain.entry(25);
  assert.ok(target);

  await withApp(createApp({ chain, apiKey: API_KEY }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/?sequence=25`);
    const html = await response.text();
    const linkedSequences = [...html.matchAll(/href="\/\?sequence=(\d+)"/g)]
      .map((match) => Number(match[1]));

    assert.equal(response.status, 200);
    assert.match(html, /紀錄 #25/);
    assert.match(html, new RegExp(target.hash));
    assert.deepEqual(linkedSequences, [
      ...Array.from({ length: 20 }, (_, index) => index + 5),
      ...Array.from({ length: 20 }, (_, index) => index + 26),
    ]);
  });
});

test('the explorer checks an optional hash and reports a mismatch', async () => {
  const chain = new RngChain(new MemoryStore());
  await chain.append(1, 'explorer-hash');
  const target = await chain.entry(1);
  assert.ok(target);
  const wrongHash = `${target.hash.startsWith('0') ? '1' : '0'}${target.hash.slice(1)}`;

  await withApp(createApp({ chain, apiKey: API_KEY }), async (baseUrl) => {
    const matching = await fetch(`${baseUrl}/?sequence=1&hash=${target.hash.toUpperCase()}`);
    assert.match(await matching.text(), /雜湊相符/);

    const mismatching = await fetch(`${baseUrl}/?sequence=1&hash=${wrongHash}`);
    assert.equal(mismatching.status, 200);
    assert.match(await mismatching.text(), /雜湊不符/);
  });
});

test('the explorer validates inputs and escapes reflected text', async () => {
  const chain = new RngChain(new MemoryStore());
  await chain.append(1, 'explorer-errors');

  await withApp(createApp({ chain, apiKey: API_KEY }), async (baseUrl) => {
    const invalidSequence = await fetch(`${baseUrl}/?sequence=0`);
    assert.equal(invalidSequence.status, 400);
    assert.match(await invalidSequence.text(), /有效的正整數序號/);

    const future = await fetch(`${baseUrl}/?sequence=2`);
    assert.equal(future.status, 404);
    assert.match(await future.text(), /尚未建立/);

    const invalidHash = await fetch(`${baseUrl}/?sequence=1&hash=bad`);
    assert.equal(invalidHash.status, 400);
    assert.match(await invalidHash.text(), /64 位十六進位雜湊/);

    const hashOnly = await fetch(`${baseUrl}/?hash=${'0'.repeat(64)}`);
    assert.equal(hashOnly.status, 400);
    assert.match(await hashOnly.text(), /請輸入序號以核對雜湊/);

    const injection = await fetch(`${baseUrl}/?sequence=${encodeURIComponent('"<script>&\'')}`);
    const html = await injection.text();
    assert.equal(injection.status, 400);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&quot;&lt;script&gt;&amp;&#39;/);

    assert.equal((await fetch(`${baseUrl}/?sequence=1&sequence=2`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/?sequence=1&hash=x&hash=y`)).status, 400);
  });
});
