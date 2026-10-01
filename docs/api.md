# RNG service API v1

All request and response bodies are JSON. The write endpoint requires a bearer
API key; health and chain reads are public. A successful write returns only
after its entries, request receipt, checkpoint, and chain head commit together.

The API returns an integer `random_u53` in `[0, 2^53)` for each requested draw.
The corresponding `probability` is `random_u53 / 2^53`, so it is in `[0, 1)`.
Use `random_u53` for exact verification and derive the probability as needed.

## Create a draw batch

`POST /v1/draw-batches`

| Input | Requirement |
| --- | --- |
| `Authorization` | `Bearer <RNG_API_KEY>` |
| `Idempotency-Key` | 1–128 characters from `A–Z`, `a–z`, `0–9`, `.`, `_`, `:`, `-` |
| `Content-Type` | `application/json` |
| JSON body | `{ "count": n }`, where `n` is an integer from 1 to 128; no other fields |

```sh
curl -X POST "$RNG_BASE_URL/v1/draw-batches" \
  -H "Authorization: Bearer $RNG_API_KEY" \
  -H "Idempotency-Key: opening-123" \
  -H "Content-Type: application/json" \
  -d '{"count":1}'
```

Response (`201 Created` for a new batch; `200 OK` for a replay):

```json
{
  "version": 1,
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "entries": [
    {
      "version": 1,
      "sequence": 1,
      "batch_id": "550e8400-e29b-41d4-a716-446655440000",
      "batch_index": 0,
      "random_u53": 123456789,
      "previous_hash": "0000000000000000000000000000000000000000000000000000000000000000",
      "hash": "ee694f2909f98df72169fb24049bbada27bd4d7387c48efdfda746ef9d71a24b",
      "created_at": "2026-10-01T12:00:00.000Z",
      "probability": 1.3706456969408976e-8
    }
  ],
  "committed_head": {
    "version": 1,
    "sequence": 1,
    "hash": "ee694f2909f98df72169fb24049bbada27bd4d7387c48efdfda746ef9d71a24b",
    "updated_at": "2026-10-01T12:00:00.000Z"
  },
  "replayed": false,
  "anchor_status": "pending"
}
```

Entries in one batch have consecutive global `sequence` values and
`batch_index` values from `0` to `count - 1`. `committed_head` is the head at
the time this batch committed; another batch may have advanced the live head
since then. A retry with the same key and count returns the original batch with
`replayed: true`, even if the first response was lost. Reusing the key with a
different count returns `409`. Use a distinct stable key for each logical
request and reuse it when retrying that request.

`anchor_status` is currently always `pending`. An independent public anchor
has not been connected; the hash chain is available from this service.

## Public reads

| Request | Success response | Notes |
| --- | --- | --- |
| `GET /health` | `{ "status": "ok" }` | Process health. |
| `GET /v1/head` | `{ "version", "sequence", "hash", "updated_at" }` | Current committed head; at genesis, sequence is `0`, hash is 64 zeroes, and `updated_at` is `1970-01-01T00:00:00.000Z`. |
| `GET /v1/entries/:sequence` | One entry, with the fields shown above | `sequence` is a positive integer; `404` if it has not been committed. |
| `GET /v1/entries?after=0&limit=50` | `{ "entries": [...], "next_after": n }` | Both parameters are optional. `after` defaults to `0`; `limit` defaults to `50` and may be 1–100. Returns entries strictly after `after` in sequence order. Use `next_after` for the next page; an empty `entries` array means there is no newer entry at request time. |
| `GET /v1/checkpoints/latest` | `{ "checkpoint": { "version", "sequence", "hash", "generated_at", "status": "pending" } }` | Returns `{ "checkpoint": null }` at genesis. This checkpoint is not independently anchored yet. |

Each public entry has the same `version`, `sequence`, `batch_id`, `batch_index`,
`random_u53`, `previous_hash`, `hash`, `created_at`, and derived `probability`
fields as an entry in a draw-batch response. See [protocol.md](protocol.md)
for the exact hash calculation and verification procedure.

## Errors

Errors use `{ "error": "code" }`.

| HTTP status | Error code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request`, `missing_idempotency_key` | Malformed JSON, invalid body or key, or absent key. |
| 400 | `invalid_pagination`, `invalid_sequence` | Invalid read parameter. |
| 401 | `unauthorized` | Missing or incorrect bearer key on the write endpoint. |
| 404 | `not_found` | Requested sequence has not been committed. |
| 409 | `idempotency_conflict` | Key was already used with another count. |
| 503 | `temporarily_unavailable` | Firestore transaction aborted or unavailable; retry with the same idempotency key. |
| 500 | `internal_error`, `corrupt_chain` | Server or stored-chain error. |

If a write times out or its response is lost, retry with the same
`Idempotency-Key` and `count` before creating a new request.
