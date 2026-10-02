import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { Check } from 'typebox/value';
import { ChainError, probability, RngChain } from './chain.js';
import { renderExplorer } from './explorer.js';
import {
  RNG_MAX_PAGE_SIZE,
  RNG_SCHEMA_VERSION,
  RngBatchRequestSchema,
  type RngCheckpoint,
} from './models/rng.js';
import { publishCheckpoint } from './publishing.js';

interface AppOptions {
  readonly chain: RngChain;
  readonly apiKey: string;
  readonly onCheckpoint?: (checkpoint: RngCheckpoint) => Promise<void>;
}

function matchesApiKey(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) {
    return false;
  }

  const supplied = Buffer.from(header.slice('Bearer '.length));
  const configured = Buffer.from(expected);

  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

function parseInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function createApp(options: AppOptions) {
  if (!options.apiKey) {
    throw new Error('An API key is required');
  }

  const app = express();
  const notifyCheckpoint = options.onCheckpoint ?? publishCheckpoint;

  app.use(express.json({ limit: '4kb' }));

  app.get('/', async (request, response) => {
    const head = await options.chain.head();
    const rawSequence = request.query.sequence;
    const rawHash = request.query.hash;
    const sequenceInput = typeof rawSequence === 'string'
      ? rawSequence
      : rawSequence === undefined && head.sequence > 0
        ? String(head.sequence)
        : '';
    const hashInput = typeof rawHash === 'string' ? rawHash : '';
    const initialPage = {
      head,
      sequenceInput,
      hashInput,
      selected: null,
      previous: [],
      subsequent: [],
    };

    response.set('Cache-Control', 'no-store');

    if (
      rawHash !== undefined &&
      (typeof rawHash !== 'string' || (rawHash !== '' && !/^[0-9a-fA-F]{64}$/.test(rawHash)))
    ) {
      response.status(400).type('html').send(renderExplorer({
        ...initialPage,
        error: '請輸入 64 位十六進位雜湊，或留空。',
      }));
      return;
    }

    if (rawSequence === undefined && hashInput !== '') {
      response.status(400).type('html').send(renderExplorer({
        ...initialPage,
        error: '請輸入序號以核對雜湊。',
      }));
      return;
    }

    const sequence = rawSequence === undefined
      ? head.sequence
      : parseInteger(rawSequence, 1, Number.MAX_SAFE_INTEGER);

    if (sequence === null) {
      response.status(400).type('html').send(renderExplorer({
        ...initialPage,
        error: '請輸入有效的正整數序號。',
      }));
      return;
    }

    if (sequence > head.sequence) {
      response.status(404).type('html').send(renderExplorer({
        ...initialPage,
        error: `紀錄 #${sequence} 尚未建立。`,
      }));
      return;
    }

    if (sequence === 0) {
      response.type('html').send(renderExplorer(initialPage));
      return;
    }

    const firstSequence = Math.max(1, sequence - 20);
    const lastSequence = Math.min(head.sequence, sequence + 20);
    const entries = await options.chain.entries(
      firstSequence - 1,
      lastSequence - firstSequence + 1,
    );
    const publicEntries = entries.map((entry) => ({
      ...entry,
      probability: probability(entry),
    }));
    // The chain returns every sequence in the requested committed range.
    const selected = publicEntries[sequence - firstSequence]!;

    response.type('html').send(renderExplorer({
      ...initialPage,
      selected,
      previous: publicEntries.filter((entry) => entry.sequence < sequence),
      subsequent: publicEntries.filter((entry) => entry.sequence > sequence),
    }));
  });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/v1/draw-batches', async (request, response) => {
    if (!matchesApiKey(request.get('authorization'), options.apiKey)) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (!Check(RngBatchRequestSchema, request.body)) {
      response.status(400).json({ error: 'invalid_request' });
      return;
    }

    const idempotencyKey = request.get('idempotency-key');

    if (!idempotencyKey) {
      response.status(400).json({ error: 'missing_idempotency_key' });
      return;
    }

    const result = await options.chain.append(request.body.count, idempotencyKey);
    const entries = result.entries.map((entry) => ({
      ...entry,
      probability: probability(entry),
    }));

    response.status(result.replayed ? 200 : 201).json({
      version: RNG_SCHEMA_VERSION,
      batch_id: result.receipt.batch_id,
      entries,
      committed_head: result.receipt.committed_head,
      replayed: result.replayed,
      anchor_status: 'pending',
    });

    if (!result.replayed) {
      const checkpoint: RngCheckpoint = {
        version: RNG_SCHEMA_VERSION,
        sequence: result.receipt.committed_head.sequence,
        hash: result.receipt.committed_head.hash,
        generated_at: result.receipt.committed_head.updated_at,
        status: 'pending',
      };

      void notifyCheckpoint(checkpoint).catch((error: unknown) => {
        console.error('Checkpoint publisher failed', error);
      });
    }
  });

  app.get('/v1/head', async (_request, response) => {
    response.json(await options.chain.head());
  });

  app.get('/v1/entries', async (request, response) => {
    const after = parseInteger(request.query.after ?? '0', 0, Number.MAX_SAFE_INTEGER);
    const limit = parseInteger(request.query.limit ?? '50', 1, RNG_MAX_PAGE_SIZE);

    if (after === null || limit === null) {
      response.status(400).json({ error: 'invalid_pagination' });
      return;
    }

    const entries = await options.chain.entries(after, limit);

    response.json({
      entries: entries.map((entry) => ({ ...entry, probability: probability(entry) })),
      next_after: entries.at(-1)?.sequence ?? after,
    });
  });

  app.get('/v1/entries/:sequence', async (request, response) => {
    const sequence = parseInteger(request.params.sequence, 1, Number.MAX_SAFE_INTEGER);

    if (sequence === null) {
      response.status(400).json({ error: 'invalid_sequence' });
      return;
    }

    const entry = await options.chain.entry(sequence);

    if (!entry) {
      response.status(404).json({ error: 'not_found' });
      return;
    }

    response.json({ ...entry, probability: probability(entry) });
  });

  app.get('/v1/checkpoints/latest', async (_request, response) => {
    response.json({ checkpoint: await options.chain.checkpoint() });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'invalid_json' });
      return;
    }

    if (typeof error === 'object' && error !== null && 'status' in error) {
      const status = error.status;

      if (typeof status === 'number' && status >= 400 && status < 500) {
        response.status(status).json({ error: 'invalid_request' });
        return;
      }
    }

    if (error instanceof ChainError) {
      const status = error.code === 'INVALID_REQUEST'
        ? 400
        : error.code === 'IDEMPOTENCY_CONFLICT'
          ? 409
          : 500;

      response.status(status).json({ error: error.code.toLowerCase() });
      return;
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 10 || error.code === 14) {
        response.status(503).json({ error: 'temporarily_unavailable' });
        return;
      }
    }

    console.error('RNG request failed', error);
    response.status(500).json({ error: 'internal_error' });
  };

  app.use(handleError);

  return app;
}
