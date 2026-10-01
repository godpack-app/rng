import { Type, type Static } from 'typebox';

export const RNG_SCHEMA_VERSION = 1;
export const RNG_VALUE_RANGE = 2 ** 53;
export const RNG_MAX_BATCH_SIZE = 128;
export const RNG_MAX_PAGE_SIZE = 100;
export const RNG_GENESIS_HASH = '0'.repeat(64);

const HashSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });
const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const BatchIdSchema = Type.String({ minLength: 36, maxLength: 36 });
const InstantSchema = Type.String({ minLength: 20, maxLength: 30 });

/** A chain entry stores the exact random integer; probability is a derived display value. */
export const RngEntrySchema = Type.Object(
  {
    version: Type.Literal(RNG_SCHEMA_VERSION),
    sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    batch_id: BatchIdSchema,
    batch_index: Type.Integer({ minimum: 0, maximum: RNG_MAX_BATCH_SIZE - 1 }),
    random_u53: Type.Integer({ minimum: 0, maximum: RNG_VALUE_RANGE - 1 }),
    previous_hash: HashSchema,
    hash: HashSchema,
    created_at: InstantSchema,
  },
  { additionalProperties: false },
);

export type RngEntry = Static<typeof RngEntrySchema>;

export const RngPublicEntrySchema = Type.Object(
  {
    ...RngEntrySchema.properties,
    probability: Type.Number({ minimum: 0, exclusiveMaximum: 1 }),
  },
  { additionalProperties: false },
);

export type RngPublicEntry = Static<typeof RngPublicEntrySchema>;

export const RngHeadSchema = Type.Object(
  {
    version: Type.Literal(RNG_SCHEMA_VERSION),
    sequence: SequenceSchema,
    hash: HashSchema,
    updated_at: InstantSchema,
  },
  { additionalProperties: false },
);

export type RngHead = Static<typeof RngHeadSchema>;

export const RngBatchRequestSchema = Type.Object(
  {
    count: Type.Integer({ minimum: 1, maximum: RNG_MAX_BATCH_SIZE }),
  },
  { additionalProperties: false },
);

export type RngBatchRequest = Static<typeof RngBatchRequestSchema>;

/** Saved with the batch so a timed-out client can recover the same probabilities. */
export const RngBatchReceiptSchema = Type.Object(
  {
    version: Type.Literal(RNG_SCHEMA_VERSION),
    count: Type.Integer({ minimum: 1, maximum: RNG_MAX_BATCH_SIZE }),
    batch_id: BatchIdSchema,
    first_sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    committed_head: RngHeadSchema,
  },
  { additionalProperties: false },
);

export type RngBatchReceipt = Static<typeof RngBatchReceiptSchema>;

/** A publishing hook can submit this head to an independent public log later. */
export const RngCheckpointSchema = Type.Object(
  {
    version: Type.Literal(RNG_SCHEMA_VERSION),
    sequence: SequenceSchema,
    hash: HashSchema,
    generated_at: InstantSchema,
    status: Type.Literal('pending'),
  },
  { additionalProperties: false },
);

export type RngCheckpoint = Static<typeof RngCheckpointSchema>;
