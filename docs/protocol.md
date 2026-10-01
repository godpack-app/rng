# RNG chain protocol v1

This document defines the public chain format. The README stays focused on the project itself.
For endpoint inputs, outputs, and error codes, see [api.md](api.md).

## Draws

`POST /v1/draw-batches` accepts `{ "count": 1..128 }`. It requires an
`Authorization: Bearer <RNG_API_KEY>` header and an `Idempotency-Key` header.
The same key and count return the same batch. Reusing a key with another count returns `409`.

Each entry contains a uniformly generated integer `random_u53` from
`[0, 2^53)`. The displayed probability is exactly `random_u53 / 2^53`.
Clients should use the integer for verification and selection. A batch gets
consecutive global sequence numbers and commits atomically in Firestore before
the API responds.

## Hashes

The genesis head is sequence `0` with a hash of 64 zero characters. For each
entry, the lowercase SHA-256 hash is calculated over the UTF-8 JSON encoding
of this array, in exactly this order:

```json
[
  "rng-chain-entry-v1",
  1,
  1,
  "550e8400-e29b-41d4-a716-446655440000",
  0,
  123456789,
  "0000000000000000000000000000000000000000000000000000000000000000",
  "2026-10-01T12:00:00.000Z"
]
```

The example shows `sequence`, `batch_id`, `batch_index`, `random_u53`,
`previous_hash`, and `created_at` after the domain and version. Integers are
JSON numbers, not strings. The `previous_hash` is the prior entry's `hash`.
The response's floating-point `probability` is excluded from the hash.
The example hashes to
`ee694f2909f98df72169fb24049bbada27bd4d7387c48efdfda746ef9d71a24b`.

## Public reads

- `GET /v1/head` returns the current committed head.
- `GET /v1/entries/:sequence` returns one entry.
- `GET /v1/entries?after=0&limit=50` returns the next page, up to 100 entries.
- `GET /v1/checkpoints/latest` returns the latest pending checkpoint.

`npm run verify -- <public-base-url>` recomputes the chain from genesis to a
captured head. The independent public anchor is not configured yet, so this
currently verifies continuity against the head served by this application.
The `publishCheckpoint` hook in `src/publishing.ts` is the integration point
for the chosen independent service. Checkpoints remain `pending` until that
integration returns independently verifiable proof.

## Storage and integration

The Firestore head is `rngChain/head`. Draw and request documents use hashed
IDs, so public pagination can fetch known sequence IDs without a sequential
query index. When configuring Firestore indexes, exempt the RNG entry fields
from indexing unless a query specifically needs them.

The game service should request the probabilities before its gameplay
transaction, then reuse the same batch on retries. Its committed draw evidence
should record each RNG sequence/hash and the exact eligible cohort snapshot,
range boundaries, and selected result. Unused probabilities stay in the chain.
