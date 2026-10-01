import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function runServer(environment) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'test/support/check-server.mjs'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        RNG_API_KEY: 'test-api-key',
        PORT: undefined,
        FIRESTORE_DATABASE_ID: undefined,
        ...environment,
      },
    },
  );
}

test('startup requires an API key', () => {
  const result = runServer({ RNG_API_KEY: undefined });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RNG_API_KEY must be set/);
});

test('startup rejects invalid ports', () => {
  for (const port of ['0', '65536', '1.5', 'not-a-port']) {
    const result = runServer({ PORT: port });
    assert.equal(result.status, 1, port);
    assert.match(result.stderr, /PORT must be an integer/, port);
  }
});

test('startup selects the default or named Firestore database', () => {
  const defaultDatabase = runServer({});
  assert.equal(defaultDatabase.status, 0, defaultDatabase.stderr);
  assert.match(defaultDatabase.stdout, /PORT=3000/);

  const namedDatabase = runServer({ PORT: '8080', FIRESTORE_DATABASE_ID: 'rng-chain' });
  assert.equal(namedDatabase.status, 0, namedDatabase.stderr);
  assert.match(namedDatabase.stdout, /PORT=8080/);
});
