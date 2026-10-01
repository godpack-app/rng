import type { RngCheckpoint } from './models/rng.js';

/**
 * An independent public anchor will be connected here. Checkpoints remain pending in Firestore
 * until a publisher stores and verifies an external receipt.
 */
export async function publishCheckpoint(_checkpoint: RngCheckpoint): Promise<void> {
  // The external publishing destination has not been selected yet.
}
