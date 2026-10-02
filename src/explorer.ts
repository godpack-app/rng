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
        <span>${entries.length} 筆</span>
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
      : '<p class="empty-state">目前沒有紀錄。</p>';
  }

  const expectedHash = page.hashInput.trim().toLowerCase();
  const hashCheck = expectedHash
    ? entry.hash === expectedHash
      ? '<p class="hash-check match" role="status">雜湊相符</p>'
      : '<p class="hash-check mismatch" role="alert">雜湊不符</p>'
    : '';

  return `
    <div class="results-heading">
      <h2>紀錄 #${entry.sequence}</h2>
    </div>
    <section class="selected-entry" aria-label="所選紀錄">
      <div class="selected-probability">機率 ${entry.probability.toPrecision(12)}</div>
      ${hashCheck}
      <dl class="entry-details">
        <div>
          <dt>紀錄雜湊</dt>
          <dd><code>${escapeHtml(entry.hash)}</code></dd>
        </div>
        <div>
          <dt>前筆雜湊</dt>
          <dd><code>${escapeHtml(entry.previous_hash)}</code></dd>
        </div>
        <div>
          <dt>原始亂數</dt>
          <dd><code>${entry.random_u53} / 2<sup>53</sup></code></dd>
        </div>
        <div>
          <dt>批次</dt>
          <dd><code>${escapeHtml(entry.batch_id)} · ${entry.batch_index + 1}</code></dd>
        </div>
        <div>
          <dt>建立時間</dt>
          <dd>
            <time datetime="${escapeHtml(entry.created_at)}">${escapeHtml(entry.created_at)}</time>
          </dd>
        </div>
      </dl>
    </section>
    <div class="context-grid">
      ${renderContext('前 20 筆', page.previous, '沒有更早的紀錄。')}
      ${renderContext('後 20 筆', page.subsequent, '沒有更新的紀錄。')}
    </div>`;
}

export function renderExplorer(page: ExplorerPage): string {
  const error = page.error
    ? `<p class="form-error" role="alert">${escapeHtml(page.error)}</p>`
    : '';

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GodPack 亂數鏈</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --godpack-bg: #050505;
      --godpack-panel: #0a0a0a;
      --godpack-panel2: #121212;
      --godpack-line: #2a2210;
      --godpack-text: #f5f2ea;
      --godpack-muted: #8f8a7e;
      --godpack-accent: #f7ba0b;
      --godpack-accent-hi: #ffd24a;
      --godpack-accent-dim: #c08b05;
      --godpack-danger: #ed1010;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: var(--godpack-bg);
      color: var(--godpack-text);
    }
    a {
      color: var(--godpack-accent);
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
      border-bottom: 1px solid var(--godpack-line);
    }
    .brand {
      color: var(--godpack-accent);
      font-size: 18px;
      font-weight: 750;
      letter-spacing: -0.03em;
      text-decoration: none;
    }
    .head-pill {
      border: 1px solid var(--godpack-line);
      border-radius: 999px;
      background: var(--godpack-panel2);
      padding: 8px 13px;
      color: var(--godpack-muted);
      font-size: 13px;
    }
    main {
      padding-top: 46px;
    }
    h1 {
      margin: 0 0 28px;
      font-size: clamp(30px, 5vw, 44px);
      letter-spacing: -0.055em;
      line-height: 1.08;
    }
    .search-panel, .selected-entry, .context-group {
      border: 1px solid var(--godpack-line);
      border-radius: 18px;
      background: var(--godpack-panel);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
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
      color: var(--godpack-text);
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      min-height: 43px;
      border: 1px solid var(--godpack-line);
      border-radius: 9px;
      background: var(--godpack-panel2);
      padding: 9px 12px;
      color: var(--godpack-text);
      font: inherit;
      font-size: 15px;
    }
    input:focus {
      outline: 3px solid rgba(247, 186, 11, 0.18);
      border-color: var(--godpack-accent);
    }
    button {
      min-height: 43px;
      border: 0;
      border-radius: 9px;
      background: var(--godpack-accent);
      padding: 0 19px;
      color: #000;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover {
      background: var(--godpack-accent-hi);
    }
    .form-error {
      margin: 16px 0 0;
      border-radius: 9px;
      background: rgba(237, 16, 16, 0.12);
      padding: 12px 14px;
      color: var(--godpack-danger);
    }
    .latest-link {
      display: inline-block;
      margin-top: 14px;
      font-size: 13px;
    }
    .results-heading {
      margin: 42px 0 15px;
    }
    .results-heading h2 {
      margin: 0;
      font-size: 25px;
      letter-spacing: -0.035em;
    }
    .selected-entry {
      padding: 25px;
      border-color: var(--godpack-accent-dim);
    }
    .selected-probability {
      margin-bottom: 20px;
      color: var(--godpack-accent);
      font-size: clamp(26px, 4vw, 40px);
      font-weight: 750;
      letter-spacing: -0.04em;
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
      background: rgba(247, 186, 11, 0.12);
      color: var(--godpack-accent);
    }
    .mismatch {
      background: rgba(237, 16, 16, 0.12);
      color: var(--godpack-danger);
    }
    .entry-details {
      display: grid;
      gap: 0;
      margin: 0;
      border-top: 1px solid var(--godpack-line);
    }
    .entry-details div {
      display: grid;
      grid-template-columns: 135px minmax(0, 1fr);
      gap: 14px;
      padding: 13px 0;
      border-bottom: 1px solid var(--godpack-line);
    }
    .entry-details div:last-child {
      border-bottom: 0;
    }
    dt {
      color: var(--godpack-muted);
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
      color: var(--godpack-muted);
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
      border-top: 1px solid var(--godpack-line);
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
      color: var(--godpack-muted);
      font-size: 11px;
    }
    .empty-context, .empty-state {
      color: var(--godpack-muted);
      line-height: 1.6;
    }
    .empty-state {
      margin-top: 32px;
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
      <a class="brand" href="/">GodPack</a>
      <span class="head-pill">最新序號 #${page.head.sequence}</span>
    </header>
    <main>
      <h1>亂數鏈查詢</h1>
      <section class="search-panel" aria-label="查詢紀錄">
        <form method="get" action="/">
          <label for="sequence">序號
            <input id="sequence" name="sequence" type="number" min="1"
              max="9007199254740991" step="1" inputmode="numeric"
              value="${escapeHtml(page.sequenceInput)}" required>
          </label>
          <label for="hash">紀錄雜湊（選填）
            <input id="hash" name="hash" type="text" pattern="[0-9a-fA-F]{64}"
              maxlength="64" spellcheck="false" autocomplete="off"
              value="${escapeHtml(page.hashInput)}" placeholder="64 位十六進位雜湊">
          </label>
          <button type="submit">查詢</button>
        </form>
        ${error}
        <a class="latest-link" href="/">查看最新紀錄</a>
      </section>
      ${renderSelection(page)}
    </main>
  </div>
</body>
</html>`;
}
