import { Check } from 'typebox/value';
import { genesisHead, probability, verifyEntries } from '../src/chain.js';
import {
  RNG_MAX_PAGE_SIZE,
  RngHeadSchema,
  RngPublicEntrySchema,
  type RngEntry,
} from '../src/models/rng.js';

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error('Usage: npm run verify -- https://rng.example.com');
}

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl));

  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }

  return response.json();
}

const target = await readJson('/v1/head');

if (!Check(RngHeadSchema, target)) {
  throw new Error('Invalid public chain head');
}

let verified = genesisHead;

while (verified.sequence < target.sequence) {
  const limit = Math.min(RNG_MAX_PAGE_SIZE, target.sequence - verified.sequence);
  const page = await readJson(`/v1/entries?after=${verified.sequence}&limit=${limit}`);

  if (
    typeof page !== 'object' ||
    page === null ||
    !('entries' in page) ||
    !Array.isArray(page.entries) ||
    page.entries.length !== limit
  ) {
    throw new Error('Invalid public chain page');
  }

  const entries: RngEntry[] = page.entries.map((value: unknown) => {
    if (!Check(RngPublicEntrySchema, value)) {
      throw new Error('Invalid public chain entry');
    }

    const { probability: shownProbability, ...entry } = value;

    if (shownProbability !== probability(entry)) {
      throw new Error(`Incorrect probability at sequence ${entry.sequence}`);
    }

    return entry;
  });

  verified = verifyEntries(entries, verified);
}

if (verified.hash !== target.hash) {
  throw new Error('Public head does not match the verified chain');
}

console.log(`Verified ${verified.sequence} entries through ${verified.hash}`);
console.log('Independent public anchoring is not configured yet.');
