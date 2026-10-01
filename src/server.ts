import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createApp } from './app.js';
import { RngChain } from './chain.js';
import { FirestoreStore } from './firestore-store.js';

const apiKey = process.env.RNG_API_KEY;

if (!apiKey) {
  throw new Error('RNG_API_KEY must be set');
}

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

const firebase = initializeApp({ credential: applicationDefault() });
const databaseId = process.env.FIRESTORE_DATABASE_ID;
const db = databaseId ? getFirestore(firebase, databaseId) : getFirestore(firebase);
const chain = new RngChain(new FirestoreStore(db));
const app = createApp({ chain, apiKey });

app.listen(port, () => {
  console.log(`rng listening on port ${port}`);
});
