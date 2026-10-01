# Development

Use Node.js 24 and run `npm install`. Copy `.env.example` to `.env` and set a
long random `RNG_API_KEY`. The app uses Firebase Application Default Credentials;
set `FIRESTORE_DATABASE_ID` only when using a named Firestore database. For a
local Firestore emulator, set `FIRESTORE_EMULATOR_HOST` in the environment.

`npm run dev` starts the local watcher. `npm run check`, `npm test`,
`npm run test:coverage`, and `npm run build` validate the application. The
coverage command includes every `src/**/*.ts` file and requires 100% branch
coverage; Cloud Build runs it before building the runtime image.

The write API accepts `POST /v1/draw-batches` with a JSON body such as
`{"count": 2}`, an `Authorization: Bearer <RNG_API_KEY>` header, and an
`Idempotency-Key` header. The public read API is described in `protocol.md`.

Independent checkpoint publishing is intentionally unconfigured. The hook in
`src/publishing.ts` receives each committed checkpoint, while Firestore retains
pending checkpoint documents. Do not describe a checkpoint as independently
anchored until a provider receipt is stored and verified. A future publisher
should retry pending checkpoints from durable storage because a process can stop
after the batch response. Concurrent batches contend on the single chain head;
monitor Firestore transaction retries as draw traffic grows.
