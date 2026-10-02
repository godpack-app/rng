import type { RngHead, RngPublicEntry } from './models/rng.js';

export interface ExplorerPage {
  readonly head: RngHead;
  readonly sequenceInput: string;
  readonly hashInput: string;
  readonly selected: RngPublicEntry | null;
  readonly previous: readonly RngPublicEntry[];
  readonly subsequent: readonly RngPublicEntry[];
  readonly error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderEntryRow(entry: RngPublicEntry): string {
  return `
    <li class="entry-row">
      <a class="entry-link" href="/?sequence=${entry.sequence}">#${entry.sequence}</a>
      <span class="entry-probability">${entry.probability.toPrecision(12)}</span>
      <code title="${escapeHtml(entry.hash)}">${escapeHtml(entry.hash.slice(0, 12))}…${escapeHtml(entry.hash.slice(-8))}</code>
      <time datetime="${escapeHtml(entry.created_at)}">${escapeHtml(entry.created_at)}</time>
    </li>`;
}

function renderContext(title: string, entries: readonly RngPublicEntry[], empty: string): string {
  return `
    <section class="context-group" aria-label="${escapeHtml(title)}">
      <div class="section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${entries.length} of 20</span>
      </div>
      ${entries.length > 0
        ? `<ol class="entry-list">${entries.map(renderEntryRow).join('')}</ol>`
        : `<p class="empty-context">${escapeHtml(empty)}</p>`}
    </section>`;
}

function renderSelection(page: ExplorerPage): string {
  const entry = page.selected;

  if (!entry) {
    return page.error
      ? ''
      : '<p class="empty-state">No draws have been published yet.</p>';
  }

  const expectedHash = page.hashInput.trim().toLowerCase();
  const hashCheck = expectedHash
    ? entry.hash === expectedHash
      ? '<p class="hash-check match" role="status">Hash matches this entry.</p>'
      : '<p class="hash-check mismatch" role="alert">Hash does not match this entry.</p>'
    : '';

  return `
    <div class="results-heading">
      <h2>Entry #${entry.sequence}</h2>
      <span>Showing up to 20 entries on each side</span>
    </div>
    <section class="selected-entry" aria-label="Selected chain entry">
      <div class="selected-topline">
        <span class="eyebrow">Selected draw</span>
        <span>Batch position ${entry.batch_index + 1}</span>
      </div>
      <div class="selected-probability">${entry.probability.toPrecision(12)}</div>
      <p class="probability-note">Probability · exact integer ${entry.random_u53} / 2<sup>53</sup></p>
      ${hashCheck}
      <dl class="entry-details">
        <div>
          <dt>Entry hash</dt>
          <dd><code>${escapeHtml(entry.hash)}</code></dd>
        </div>
        <div>
          <dt>Previous hash</dt>
          <dd><code>${escapeHtml(entry.previous_hash)}</code></dd>
        </div>
        <div>
          <dt>Batch ID</dt>
          <dd><code>${escapeHtml(entry.batch_id)}</code></dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time datetime="${escapeHtml(entry.created_at)}">${escapeHtml(entry.created_at)}</time>
          </dd>
        </div>
      </dl>
    </section>
    <div class="context-grid">
      ${renderContext('Previous entries', page.previous, 'This is the first entry in the chain.')}
      ${renderContext('Subsequent entries', page.subsequent, 'No later entries are committed yet.')}
    </div>`;
}

export function renderExplorer(page: ExplorerPage): string {
  const error = page.error
    ? `<p class="form-error" role="alert">${escapeHtml(page.error)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RNG chain explorer</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: #f4f6fa;
      color: #17233a;
    }
    a {
      color: #174e9b;
    }
    .shell {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 24px 64px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 25px 0;
      border-bottom: 1px solid #dbe2ed;
    }
    .brand {
      color: #17233a;
      font-size: 18px;
      font-weight: 750;
      letter-spacing: -0.03em;
      text-decoration: none;
    }
    .head-pill {
      border: 1px solid #cbd8ea;
      border-radius: 999px;
      background: #fff;
      padding: 8px 13px;
      color: #40526e;
      font-size: 13px;
    }
    main {
      padding-top: 46px;
    }
    .eyebrow {
      color: #3464a5;
      font-size: 12px;
      font-weight: 750;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }
    h1 {
      margin: 10px 0 12px;
      font-size: clamp(32px, 5vw, 49px);
      letter-spacing: -0.055em;
      line-height: 1.08;
    }
    .intro {
      max-width: 710px;
      margin: 0 0 30px;
      color: #53627a;
      line-height: 1.65;
    }
    .search-panel, .selected-entry, .context-group {
      border: 1px solid #dbe2ed;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 8px 30px rgba(19, 39, 74, 0.035);
    }
    .search-panel {
      padding: 24px;
    }
    form {
      display: grid;
      grid-template-columns: minmax(150px, 220px) minmax(220px, 1fr) auto;
      align-items: end;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 8px;
      color: #334762;
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      min-height: 43px;
      border: 1px solid #bcc9db;
      border-radius: 9px;
      padding: 9px 12px;
      color: #17233a;
      font: inherit;
      font-size: 15px;
    }
    input:focus {
      outline: 3px solid #d8e8ff;
      border-color: #3672bf;
    }
    button {
      min-height: 43px;
      border: 0;
      border-radius: 9px;
      background: #245fa9;
      padding: 0 19px;
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover {
      background: #164b8d;
    }
    .form-help {
      margin: 12px 0 0;
      color: #65738a;
      font-size: 13px;
      line-height: 1.5;
    }
    .form-error {
      margin: 16px 0 0;
      border-radius: 9px;
      background: #fff0ee;
      padding: 12px 14px;
      color: #aa352b;
    }
    .latest-link {
      display: inline-block;
      margin-top: 14px;
      font-size: 13px;
    }
    .results-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 15px;
      margin: 42px 0 15px;
    }
    .results-heading h2 {
      margin: 0;
      font-size: 25px;
      letter-spacing: -0.035em;
    }
    .results-heading span {
      color: #65738a;
      font-size: 13px;
    }
    .selected-entry {
      padding: 25px;
      border-color: #9bbbe5;
    }
    .selected-topline {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #65738a;
      font-size: 13px;
    }
    .selected-probability {
      margin-top: 20px;
      font-size: clamp(26px, 4vw, 40px);
      font-weight: 750;
      letter-spacing: -0.04em;
    }
    .probability-note {
      margin: 5px 0 24px;
      color: #65738a;
      font-size: 13px;
    }
    .hash-check {
      display: inline-block;
      margin: 0 0 20px;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 700;
    }
    .match {
      background: #e7f7ed;
      color: #226143;
    }
    .mismatch {
      background: #fff0ee;
      color: #aa352b;
    }
    .entry-details {
      display: grid;
      gap: 0;
      margin: 0;
      border-top: 1px solid #e6ebf2;
    }
    .entry-details div {
      display: grid;
      grid-template-columns: 135px minmax(0, 1fr);
      gap: 14px;
      padding: 13px 0;
      border-bottom: 1px solid #e6ebf2;
    }
    .entry-details div:last-child {
      border-bottom: 0;
    }
    dt {
      color: #65738a;
      font-size: 13px;
    }
    dd {
      min-width: 0;
      margin: 0;
      font-size: 13px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .context-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 18px;
    }
    .context-group {
      min-width: 0;
      padding: 19px;
    }
    .section-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 9px;
    }
    .section-heading h3 {
      margin: 0;
      font-size: 16px;
    }
    .section-heading span {
      color: #7c8798;
      font-size: 12px;
      white-space: nowrap;
    }
    .entry-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .entry-row {
      display: grid;
      grid-template-columns: 65px minmax(0, 1fr) minmax(0, 1.2fr);
      gap: 7px 12px;
      align-items: center;
      padding: 12px 0;
      border-top: 1px solid #edf0f5;
      font-size: 12px;
    }
    .entry-link {
      font-weight: 750;
      text-decoration: none;
    }
    .entry-link:hover {
      text-decoration: underline;
    }
    .entry-probability {
      font-variant-numeric: tabular-nums;
    }
    .entry-row time {
      grid-column: 2 / -1;
      color: #8691a2;
      font-size: 11px;
    }
    .empty-context, .empty-state {
      color: #65738a;
      line-height: 1.6;
    }
    .empty-state {
      margin-top: 32px;
    }
    footer {
      margin-top: 42px;
      color: #7c8798;
      font-size: 12px;
      line-height: 1.5;
    }
    @media (max-width: 760px) {
      .shell {
        padding: 0 16px 48px;
      }
      main {
        padding-top: 32px;
      }
      form, .context-grid {
        grid-template-columns: 1fr;
      }
      .results-heading {
        display: block;
      }
      .results-heading span {
        display: block;
        margin-top: 7px;
      }
      .entry-details div {
        grid-template-columns: 1fr;
        gap: 5px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <a class="brand" href="/">rng / chain explorer</a>
      <span class="head-pill">Current head #${page.head.sequence}</span>
    </header>
    <main>
      <span class="eyebrow">Public chain record</span>
      <h1>Inspect a draw and its neighbors.</h1>
      <p class="intro">
        Enter the sequence number from a draw receipt to see up to 20 entries before and after it.
        Add its hash to check that the selected record matches what you received.
      </p>
      <section class="search-panel" aria-label="Find a chain entry">
        <form method="get" action="/">
          <label for="sequence">Sequence number
            <input id="sequence" name="sequence" type="number" min="1"
              max="9007199254740991" step="1" inputmode="numeric"
              value="${escapeHtml(page.sequenceInput)}" required>
          </label>
          <label for="hash">Entry hash <span>(optional check)</span>
            <input id="hash" name="hash" type="text" pattern="[0-9a-fA-F]{64}"
              maxlength="64" spellcheck="false" autocomplete="off"
              value="${escapeHtml(page.hashInput)}" placeholder="64-character SHA-256 hash">
          </label>
          <button type="submit">Inspect entry</button>
        </form>
        <p class="form-help">
          The sequence locates the entry directly. The hash checks that entry;
          a hash alone does not identify a position in this chain.
        </p>
        ${error}
        <a class="latest-link" href="/">View latest entry</a>
      </section>
      ${renderSelection(page)}
    </main>
    <footer>Chain records are public. Independent checkpoint anchoring is not configured yet.</footer>
  </div>
</body>
</html>`;
}
