import type { Firestore } from 'firebase-admin/firestore';
import type { DocumentStore, DocumentTransaction } from './chain.js';

/** The adapter keeps Firebase document shapes out of the chain protocol. */
export class FirestoreStore implements DocumentStore {
  constructor(private readonly db: Firestore) {}

  async get(path: string): Promise<unknown> {
    const snapshot = await this.db.doc(path).get();
    return snapshot.data();
  }

  async getMany(paths: readonly string[]): Promise<readonly unknown[]> {
    if (paths.length === 0) {
      return [];
    }

    const references = paths.map((path) => this.db.doc(path));
    const snapshots = await this.db.getAll(...references);
    const byPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot.data()]));

    return paths.map((path) => byPath.get(path));
  }

  runTransaction<T>(callback: (transaction: DocumentTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (firestoreTransaction) => {
      const transaction: DocumentTransaction = {
        get: async (path) => {
          const snapshot = await firestoreTransaction.get(this.db.doc(path));
          return snapshot.data();
        },
        create: (path, value) => {
          firestoreTransaction.create(this.db.doc(path), value);
        },
        set: (path, value) => {
          firestoreTransaction.set(this.db.doc(path), value);
        },
      };

      return callback(transaction);
    });
  }
}
