import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Check } from 'typebox/value';
import {
  RNG_GENESIS_HASH,
  RNG_MAX_BATCH_SIZE,
  RNG_MAX_PAGE_SIZE,
  RNG_SCHEMA_VERSION,
  RNG_VALUE_RANGE,
  RngBatchReceiptSchema,
  RngCheckpointSchema,
  RngEntrySchema,
  RngHeadSchema,
  type RngBatchReceipt,
  type RngCheckpoint,
  type RngEntry,
  type RngHead,
} from './models/rng.js';

const HEAD_PATH = 'rngChain/head';
const ID_PREFIX = 'rng-entry-v1:';
const HASH_DOMAIN = 'rng-chain-entry-v1';
const GENESIS_TIME = '1970-01-01T00:00:00.000Z';

export interface DocumentTransaction {
  get(path: string): Promise<unknown>;
  create(path: string, value: Record<string, unknown>): void;
  set(path: string, value: Record<string, unknown>): void;
}

export interface DocumentStore {
  get(path: string): Promise<unknown>;
  getMany(paths: readonly string[]): Promise<readonly unknown[]>;
  runTransaction<T>(callback: (transaction: DocumentTransaction) => Promise<T>): Promise<T>;
}

export class ChainError extends Error {
  constructor(
    readonly code: 'INVALID_REQUEST' | 'IDEMPOTENCY_CONFLICT' | 'CORRUPT_CHAIN',
    message: string,
  ) {
    super(message);
  }
}

export const genesisHead: RngHead = {
  version: RNG_SCHEMA_VERSION,
  sequence: 0,
  hash: RNG_GENESIS_HASH,
  updated_at: GENESIS_TIME,
};

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function entryPath(sequence: number): string {
  return `rngEntries/${digest(`${ID_PREFIX}${sequence}`)}`;
}

function receiptPath(idempotencyKey: string): string {
  return `rngRequests/${digest(idempotencyKey)}`;
}

function checkpointPath(sequence: number): string {
  return `rngCheckpoints/${digest(`rng-checkpoint-v1:${sequence}`)}`;
}

function requireHead(value: unknown): RngHead {
  if (!Check(RngHeadSchema, value)) {
    throw new ChainError('CORRUPT_CHAIN', 'Invalid chain head');
  }

  return value;
}

function requireEntry(value: unknown): RngEntry {
  if (!Check(RngEntrySchema, value) || value.hash !== entryHash(value)) {
    throw new ChainError('CORRUPT_CHAIN', 'Invalid chain entry');
  }

  return value;
}

function requireReceipt(value: unknown): RngBatchReceipt {
  if (
    !Check(RngBatchReceiptSchema, value) ||
    value.committed_head.sequence !== value.first_sequence + value.count - 1
  ) {
    throw new ChainError('CORRUPT_CHAIN', 'Invalid batch receipt');
  }

  return value;
}

/** All hashed fields use this fixed array order; no floating-point value enters the hash. */
export function entryHash(entry: Omit<RngEntry, 'hash'>): string {
  return digest(
    JSON.stringify([
      HASH_DOMAIN,
      entry.version,
      entry.sequence,
      entry.batch_id,
      entry.batch_index,
      entry.random_u53,
      entry.previous_hash,
      entry.created_at,
    ]),
  );
}

export function probability(entry: RngEntry): number {
  return entry.random_u53 / RNG_VALUE_RANGE;
}

export function generateRandomValues(count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > RNG_MAX_BATCH_SIZE) {
    throw new ChainError('INVALID_REQUEST', 'Invalid probability count');
  }

  const bytes = randomBytes(count * 8);
  const values: number[] = [];

  for (let index = 0; index < count; index++) {
    const value = bytes.readBigUInt64BE(index * 8) >> 11n;
    values.push(Number(value));
  }

  return values;
}

export function verifyEntries(entries: readonly RngEntry[], prior: RngHead = genesisHead): RngHead {
  let head = prior;

  for (const entry of entries) {
    if (
      !Check(RngEntrySchema, entry) ||
      entry.sequence !== head.sequence + 1 ||
      entry.previous_hash !== head.hash ||
      entry.hash !== entryHash(entry)
    ) {
      throw new ChainError('CORRUPT_CHAIN', `Invalid chain entry at sequence ${entry.sequence}`);
    }

    head = {
      version: RNG_SCHEMA_VERSION,
      sequence: entry.sequence,
      hash: entry.hash,
      updated_at: entry.created_at,
    };
  }

  return head;
}

export interface AppendResult {
  readonly receipt: RngBatchReceipt;
  readonly entries: readonly RngEntry[];
  readonly replayed: boolean;
}

export class RngChain {
  constructor(private readonly store: DocumentStore) {}

  async append(count: number, idempotencyKey: string): Promise<AppendResult> {
    if (!Number.isInteger(count) || count < 1 || count > RNG_MAX_BATCH_SIZE) {
      throw new ChainError('INVALID_REQUEST', 'Invalid probability count');
    }

    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
      throw new ChainError('INVALID_REQUEST', 'Invalid idempotency key');
    }

    // Firestore can rerun the callback. Keep the batch identity and random values stable.
    const values = generateRandomValues(count);
    const batchId = randomUUID();
    const createdAt = new Date().toISOString();
    const requestPath = receiptPath(idempotencyKey);

    const result = await this.store.runTransaction(async (transaction) => {
      const saved = await transaction.get(requestPath);

      if (saved !== undefined) {
        const receipt = requireReceipt(saved);

        if (receipt.count !== count) {
          throw new ChainError('IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
        }

        return { receipt, replayed: true as const };
      }

      const storedHead = await transaction.get(HEAD_PATH);
      const head = storedHead === undefined ? genesisHead : requireHead(storedHead);

      if (head.sequence + count > Number.MAX_SAFE_INTEGER) {
        throw new ChainError('CORRUPT_CHAIN', 'Chain sequence exhausted');
      }

      const entries: RngEntry[] = [];
      let previousHash = head.hash;

      for (const [index, randomValue] of values.entries()) {
        const unhashed: Omit<RngEntry, 'hash'> = {
          version: RNG_SCHEMA_VERSION,
          sequence: head.sequence + index + 1,
          batch_id: batchId,
          batch_index: index,
          random_u53: randomValue,
          previous_hash: previousHash,
          created_at: createdAt,
        };
        const entry: RngEntry = { ...unhashed, hash: entryHash(unhashed) };

        entries.push(entry);
        previousHash = entry.hash;
      }

      const committedHead: RngHead = {
        version: RNG_SCHEMA_VERSION,
        sequence: head.sequence + count,
        hash: previousHash,
        updated_at: createdAt,
      };
      const receipt: RngBatchReceipt = {
        version: RNG_SCHEMA_VERSION,
        count,
        batch_id: batchId,
        first_sequence: head.sequence + 1,
        committed_head: committedHead,
      };
      const checkpoint: RngCheckpoint = {
        version: RNG_SCHEMA_VERSION,
        sequence: committedHead.sequence,
        hash: committedHead.hash,
        generated_at: createdAt,
        status: 'pending',
      };

      for (const entry of entries) {
        transaction.create(entryPath(entry.sequence), { ...entry });
      }

      transaction.set(HEAD_PATH, { ...committedHead });
      transaction.create(requestPath, { ...receipt });
      transaction.create(checkpointPath(checkpoint.sequence), { ...checkpoint });

      return { receipt, entries, replayed: false as const };
    });

    if (!result.replayed) {
      return result;
    }

    const paths = Array.from(
      { length: result.receipt.count },
      (_, index) => entryPath(result.receipt.first_sequence + index),
    );
    const storedEntries = await this.store.getMany(paths);

    if (storedEntries.length !== paths.length) {
      throw new ChainError('CORRUPT_CHAIN', 'Missing idempotent batch entries');
    }

    const entries = storedEntries.map(requireEntry);
    // The validated receipt has count >= 1, and getMany returned that many entries.
    const first = entries[0]!;

    const prior: RngHead = {
      version: RNG_SCHEMA_VERSION,
      sequence: first.sequence - 1,
      hash: first.previous_hash,
      updated_at: first.created_at,
    };
    const verifiedHead = verifyEntries(entries, prior);

    if (
      entries.some(
        (entry, index) =>
          entry.batch_id !== result.receipt.batch_id ||
          entry.batch_index !== index ||
          entry.sequence !== result.receipt.first_sequence + index,
      ) ||
      verifiedHead.hash !== result.receipt.committed_head.hash ||
      verifiedHead.sequence !== result.receipt.committed_head.sequence
    ) {
      throw new ChainError('CORRUPT_CHAIN', 'Invalid idempotent batch');
    }

    return { receipt: result.receipt, entries, replayed: true };
  }

  async head(): Promise<RngHead> {
    const value = await this.store.get(HEAD_PATH);
    return value === undefined ? genesisHead : requireHead(value);
  }

  async entry(sequence: number): Promise<RngEntry | null> {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new ChainError('INVALID_REQUEST', 'Invalid sequence');
    }

    const head = await this.head();

    if (sequence > head.sequence) {
      return null;
    }

    const value = await this.store.get(entryPath(sequence));

    if (value === undefined) {
      throw new ChainError('CORRUPT_CHAIN', `Missing chain entry ${sequence}`);
    }

    const entry = requireEntry(value);

    if (entry.sequence !== sequence) {
      throw new ChainError('CORRUPT_CHAIN', 'Entry sequence does not match its document');
    }

    return entry;
  }

  async entries(after: number, limit: number): Promise<RngEntry[]> {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > RNG_MAX_PAGE_SIZE
    ) {
      throw new ChainError('INVALID_REQUEST', 'Invalid pagination');
    }

    const head = await this.head();
    const last = Math.min(head.sequence, after + limit);

    if (after >= last) {
      return [];
    }

    const paths: string[] = [];

    for (let sequence = after + 1; sequence <= last; sequence++) {
      paths.push(entryPath(sequence));
    }

    const values = await this.store.getMany(paths);

    if (values.length !== paths.length) {
      throw new ChainError('CORRUPT_CHAIN', 'Missing chain page');
    }

    return values.map((value, index) => {
      const entry = requireEntry(value);

      if (entry.sequence !== after + index + 1) {
        throw new ChainError('CORRUPT_CHAIN', 'Out-of-order chain page');
      }

      return entry;
    });
  }

  async checkpoint(): Promise<RngCheckpoint | null> {
    const head = await this.head();

    if (head.sequence === 0) {
      return null;
    }

    const value = await this.store.get(checkpointPath(head.sequence));

    if (!Check(RngCheckpointSchema, value) || value.hash !== head.hash) {
      throw new ChainError('CORRUPT_CHAIN', 'Invalid latest checkpoint');
    }

    return value;
  }
}
