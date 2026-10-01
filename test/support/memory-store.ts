import type { DocumentStore, DocumentTransaction } from '../../src/chain.js';

export class MemoryStore implements DocumentStore {
  private readonly documents = new Map<string, unknown>();
  private tail: Promise<void> = Promise.resolve();

  async get(path: string): Promise<unknown> {
    return this.documents.get(path);
  }

  async getMany(paths: readonly string[]): Promise<readonly unknown[]> {
    return paths.map((path) => this.documents.get(path));
  }

  setRaw(path: string, value: unknown): void {
    this.documents.set(path, value);
  }

  deleteRaw(path: string): void {
    this.documents.delete(path);
  }

  paths(prefix: string): string[] {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix));
  }

  runTransaction<T>(callback: (transaction: DocumentTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const writes = new Map<string, unknown>();
      const transaction: DocumentTransaction = {
        get: async (path) => this.documents.get(path),
        create: (path, value) => {
          if (this.documents.has(path) || writes.has(path)) {
            throw new Error(`Document already exists: ${path}`);
          }

          writes.set(path, value);
        },
        set: (path, value) => {
          writes.set(path, value);
        },
      };

      const result = await callback(transaction);

      for (const [path, value] of writes) {
        this.documents.set(path, value);
      }

      return result;
    };

    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);

    return result;
  }
}
