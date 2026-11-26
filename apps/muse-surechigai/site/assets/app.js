// muse-surechigai — すれ違い事例交換（試作 v0.2.1）
// 静的サイト。データは data/*.json を読み、すれ違いで受け取ったカードと履歴は
// このブラウザの localStorage にだけ保存する。サーバーなし・ビルドなし。
//
// カードの検証ロジックは validator.js（Node側の tools/validate-data.js・tests/ と共通）。

import {
  parseImport,
  validatePack,
  buildPack,
  CATEGORIES
} from './validator.js';

const STORAGE_KEY = 'muse-surechigai-v1';

const CATEGORY_SLUGS = {
  'アプリ': 'app',
  'Webサイト': 'website',
  'ツール': 'tool',
  'ゲーム': 'game',
  '記事・文章': 'article',
  '画像・動画': 'media',
  'データ': 'data',
  '調査・レポート': 'research',
  'その他': 'other'
};

const AVATARS = ['🐱', '🦊', '🐰', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐙', '🦔', '🐧', '🐤', '🦉'];

/* ---------- 小さなDOMヘルパー（textContent だけ使う＝HTMLインジェクション防止） ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

/* ---------- 状態 ---------- */

const state = {
  mine: [],        // data/my-cards.json のカード（自分）
  samples: [],     // data/samples.json のカード（サンプル・架空。永続しない）
  imported: [],    // すれ違いで受け取ったカード: { card, origin: 'got' | 'sample', receivedAt }
  history: [],     // すれ違いの記録: { at, source, got, skipped, names }
  invite: null,    // 相手のMuseへの依頼文テンプレート: { prefix, text }（data/request-template.json）
  filter: 'all'
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.imported)) state.imported = saved.imported.filter(isValidEntry);
    if (Array.isArray(saved.history)) state.history = saved.history.filter(isValidHistory);
  } catch {
    // 壊れていたら初期状態のまま（削除はしない）
  }
}

function isValidEntry(e) {
  return e && typeof e === 'object' && e.card && typeof e.card.id === 'string' &&
    (e.origin === 'got' || e.origin === 'sample');
}

function isValidHistory(h) {
  return h && typeof h === 'object' && typeof h.at === 'string' &&
    typeof h.got === 'number' && Array.isArray(h.names);
}

function savePersisted() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ imported: state.imported, history: state.history })
    );
  } catch {
    // 保存できない環境（プライベートモードなど）でも画面は動く
  }
}

/* ---------- 補助 ---------- */

function displayNameOf(card) {
  const name = typeof card.displayName === 'string' ? card.displayName.trim() : '';
  return name.length > 0 ? name : '匿名';
}

function avatarOf(card) {
  let hash = 0;
  for (const ch of String(card.id)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

function badgeOf(card, origin) {
  if (origin === 'mine') return { cls: 'badge-mine', label: '自分' };
  if (String(card.id).startsWith('sample-')) return { cls: 'badge-sample', label: 'サンプル' };
  return { cls: 'badge-got', label: 'ゲット' };
}

function ownedIds() {
  const ids = new Set(state.mine.map((c) => c.id));
  for (const e of state.imported) ids.add(e.card.id);
  return ids;
}

function plazaEntries() {
  // プラザ: 自分 → すれ違いで受け取った順 → 同梱サンプル（まだ受け取っていないもの）
  const entries = state.mine.map((card) => ({ card, origin: 'mine' }));
  for (const e of state.imported) entries.push(e);
  const importedIds = new Set(state.imported.map((e) => e.card.id));
  for (const card of state.samples) {
    if (!importedIds.has(card.id)) entries.push({ card, origin: 'sample-pack' });
  }
  return entries;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 起動 ---------- */

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} が ${res.status} で返りました`);
  return res.json();
}

async function boot() {
  loadPersisted();
  const bootError = document.getElementById('boot-error');
  try {
    const [minePack, samplePack] = await Promise.all([
      fetchJSON('data/my-cards.json'),
      fetchJSON('data/samples.json')
    ]);
    const mineResult = validatePack(minePack);
    const sampleResult = validatePack(samplePack);
    const problems = [...mineResult.errors, ...sampleResult.errors];
    if (problems.length > 0) {
      throw new Error(`データファイルの形式に問題があります: ${problems.join(' / ')}`);
    }
    state.mine = mineResult.cards;
    state.samples = sampleResult.cards;
  } catch (e) {
    bootError.hidden = false;
    bootError.textContent =
      `カードデータを読み込めませんでした（${e.message}）。` +
      'file:// で直接開くと動きません。アプリのフォルダで「npm run serve」をして、http://localhost:8081/ で開いてください。';
    const inviteHint = document.getElementById('invite-hint');
    inviteHint.textContent = 'カードデータの読み込みに失敗したため、誘い文面の機能も使えません。';
    return;
  }
  buildFilter();
  wireEvents();
  renderAll();
  await loadInviteTemplate();
}

/* ---------- 描画 ---------- */

function renderAll() {
  renderCounts();
  renderCardList(document.getElementById('mine-list'), state.mine.map((card) => ({ card, origin: 'mine' })));
  renderPlaza();
  renderExchangeStatus();
  renderHistory();
}

function renderCounts() {
  document.getElementById('count-mine').textContent = String(state.mine.length);
  document.getElementById('count-plaza').textContent = String(plazaEntries().length);
  document.getElementById('count-history').textContent = String(state.history.length);
}

function renderCardList(container, entries, { emptyNote = 'カードがありません' } = {}) {
  container.replaceChildren();
  if (entries.length === 0) {
    container.append(el('p', { class: 'empty-note', text: emptyNote }));
    return;
  }
  for (const entry of entries) container.append(cardEl(entry));
}

function cardEl({ card, origin }) {
  const badge = badgeOf(card, origin);
  const slug = CATEGORY_SLUGS[card.category] ?? 'other';

  const head = el(
    'div',
    { class: 'card-head' },
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: avatarOf(card) }),
    el(
      'div',
      {},
      el(
        'p',
        { class: 'owner' },
        el('span', { text: displayNameOf(card) }),
        el('span', { class: `badge ${badge.cls}`, text: badge.label })
      ),
      el('h3', { class: 'artifact', text: card.artifactName })
    )
  );

  const chips = el('div', { class: 'chips' });
  for (const t of card.tech) chips.append(el('span', { class: 'chip', text: t }));

  const meta = el('p', { class: 'meta' });
  meta.append(el('span', { class: `cat-chip cat-${slug}`, text: card.category }));
  meta.append(el('time', { datetime: card.createdAt, text: card.createdAt }));
  if (typeof card.link === 'string' && card.link.startsWith('https://')) {
    meta.append(el('a', { href: card.link, target: '_blank', rel: 'noopener noreferrer', text: 'リンク ↗' }));
  }

  const learning = el('p', { class: 'learning' }, el('strong', { text: '💡 学び: ' }), el('span', { text: card.learning }));

  return el(
    'article',
    { class: `card cat-${slug}` },
    head,
    el('p', { class: 'tagline', text: card.tagline }),
    chips,
    meta,
    learning,
    el('p', { class: 'card-id', text: `id: ${card.id}` })
  );
}

function buildFilter() {
  const select = document.getElementById('plaza-filter');
  select.replaceChildren();
  select.append(el('option', { value: 'all', text: 'すべて' }));
  for (const cat of CATEGORIES) {
    const n = plazaEntries().filter((e) => e.card.category === cat).length;
    select.append(el('option', { value: cat, text: `${cat}（${n}）` }));
  }
  select.value = state.filter;
}

function renderPlaza() {
  const all = plazaEntries();
  const filtered = state.filter === 'all' ? all : all.filter((e) => e.card.category === state.filter);
  renderCardList(document.getElementById('plaza-list'), filtered, {
    emptyNote:
      state.filter === 'all'
        ? 'プラザにはまだカードがありません。「すれ違い」タブから、相手のカードを読み込むか、サンプルで体験してみてください。'
        : `「${state.filter}」のカードはまだありません。別のカテゴリを見るか、すれ違いで集めましょう。`
  });
  buildFilter(); // 件数の表示を更新（選択中の値は buildFilter が戻す）
  renderCounts();
}

function renderExchangeStatus() {
  const got = state.imported.filter((e) => e.origin === 'got').length;
  const sampleGot = state.imported.filter((e) => e.origin === 'sample').length;
  document.getElementById('exchange-status').textContent =
    `いまの持ちカード: 自分 ${state.mine.length}枚・すれ違いでゲット ${got}枚・サンプル体験 ${sampleGot}枚 ／ すれ違い成立 ${state.history.length}回` +
    (state.history.length === 0 ? '（まだ成立なし。①→②の順に試してみてください）' : '');
}

function renderHistory() {
  const list = document.getElementById('history-list');
  list.replaceChildren();
  if (state.history.length === 0) {
    list.append(
      el('p', { class: 'empty-note', text: 'まだすれ違いはありません。「すれ違い」タブから、相手のカードJSONを読み込むか、サンプルで体験してみてください。' })
    );
    renderCounts();
    return;
  }
  [...state.history].reverse().forEach((h, i) => {
    const skipped = h.skipped > 0 ? `・${h.skipped}枚はすでに所持` : '';
    list.append(
      el(
        'li',
        { class: 'history-item' },
        el('time', { datetime: h.at, text: formatDateTime(h.at) }),
        el('span', { class: 'who', text: `${displayNameJoin(h.names)} とすれ違い` }),
        el('span', { class: 'detail', text: `${h.got}枚ゲット${skipped}` }),
        h.source === 'sample' ? el('span', { class: 'badge badge-sample', text: 'サンプル' }) : null,
        el('span', { class: 'detail', text: `${state.history.length - i}回目` })
      )
    );
  });
  renderCounts();
}

function displayNameJoin(names) {
  const shown = names.length > 0 ? names.join('・') : '相手';
  return shown.length > 60 ? `${shown.slice(0, 58)}…` : shown;
}

/* ---------- すれ違い: 書き出し ---------- */

function exportCards() {
  const hint = document.getElementById('export-hint');
  if (state.mine.length === 0) {
    hint.textContent = '書き出せるカードがありません（データファイルの読み込みに失敗していないか確認してください）。';
    return;
  }
  const pack = buildPack(state.mine, {
    note: 'muse-surechigai で書き出した事例カードです。読み込むと「すれ違い成立」になります'
  });
  const json = JSON.stringify(pack, null, 2);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const filename = `muse-surechigai-cards-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  hint.textContent = `${filename} をダウンロードしました（カード ${state.mine.length}枚）。このファイルを相手に渡してください。`;
}

/* ---------- すれ違い: 読み込み ---------- */

function importFromValue(value, { source }) {
  const box = document.getElementById('import-result');
  box.replaceChildren();

  const result = parseImport(value);
  if (!result.ok) {
    const ul = el('ul');
    for (const msg of result.errors.slice(0, 8)) ul.append(el('li', { text: msg }));
    if (result.errors.length > 8) ul.append(el('li', { text: `ほか ${result.errors.length - 8}件のエラー` }));
    box.append(
      el('div', { class: 'import-report fail' }, el('strong', { text: '読み込めませんでした（すれ違い不成立）' }), ul)
    );
    return;
  }

  const ids = ownedIds();
  const gained = result.cards.filter((c) => !ids.has(c.id));
  const skipped = result.cards.length - gained.length;

  const now = new Date().toISOString();
  for (const card of gained) {
    state.imported.push({ card, origin: source === 'sample' ? 'sample' : 'got', receivedAt: now });
  }

  let message;
  if (gained.length > 0) {
    const names = gained.map((c) => displayNameOf(c));
    state.history.push({ at: now, source, got: gained.length, skipped, names });
    message =
      source === 'sample'
        ? `サンプルとのすれ違い体験: 新しいカード ${gained.length}枚をプラザに追加しました（架空のカードです）`
        : `すれ違い成立！ ${displayNameJoin(names)} の新しいカード ${gained.length}枚をゲットしました`;
    showStreetpassBanner(message);
  } else {
    message = '新しいカードはありませんでした（このカードはもう持っています）。';
  }

  savePersisted();
  renderAll();

  const ul = el('ul');
  ul.append(el('li', { text: `新しいカード: ${gained.length}枚` }));
  ul.append(el('li', { text: `すでに持っていた: ${skipped}枚` }));
  for (const w of result.warnings.slice(0, 4)) ul.append(el('li', { text: w }));
  box.append(
    el(
      'div',
      { class: `import-report ${gained.length > 0 ? 'ok' : 'fail'}` },
      el('strong', { text: gained.length > 0 ? 'すれ違い成立！' : 'すれ違いならず（お互い知り合いのようです）' }),
      ul,
      el('p', { text: message })
    )
  );
}

function importFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let value;
    try {
      value = JSON.parse(String(reader.result));
    } catch (e) {
      showImportError(`JSONとして読めませんでした: ${e.message}`);
      return;
    }
    importFromValue(value, { source: 'import' });
  };
  reader.onerror = () => showImportError('ファイルの読み込みに失敗しました');
  reader.readAsText(file);
}

function showImportError(message) {
  const box = document.getElementById('import-result');
  box.replaceChildren();
  box.append(el('div', { class: 'import-report fail' }, el('strong', { text: '読み込めませんでした' }), el('p', { text: message })));
}

function importSamplePack() {
  // 同梱サンプル（data/samples.json）を「体験」として読み込む
  importFromValue(buildPack(state.samples, { note: 'サンプル', sample: true, exportedAt: new Date() }), { source: 'sample' });
}

/* ---------- 自動交換への誘い（依頼文の送信） ---------- */
// 文面は data/request-template.json（exchange/README.md の確定テンプレートと同じ内容。
// npm test の tests/request-template.test.js が一致を検証している）。
// LINEへの送信はユーザー自身が行う共有リンク方式（line.me/R/msg/text/）。自動送信のAPIは使わない。

async function loadInviteTemplate() {
  const hint = document.getElementById('invite-hint');
  const lineBtn = document.getElementById('invite-line-btn');
  const copyBtn = document.getElementById('invite-copy-btn');
  const preview = document.getElementById('invite-text-preview');
  try {
    const data = await fetchJSON('data/request-template.json');
    const isObj = data !== null && typeof data === 'object';
    const linesOk = isObj && Array.isArray(data.lines) && data.lines.every((l) => typeof l === 'string');
    if (!isObj || !linesOk ||
      typeof data.lineSharePrefix !== 'string' || !data.lineSharePrefix.startsWith('https://')) {
      throw new Error('ファイルの形式が違います');
    }
    const text = data.lines.join('\n');
    if (text.trim().length === 0) throw new Error('文面が空です');
    state.invite = { prefix: data.lineSharePrefix, text };
    lineBtn.href = state.invite.prefix + encodeURIComponent(text);
    lineBtn.setAttribute('aria-disabled', 'false');
    copyBtn.disabled = false;
    preview.textContent = text;
    hint.textContent =
      `文面は exchange/README.md 確定のテンプレート（全${text.length}字）。` +
      '「LINEで送る」でLINEアプリが開き、文面が入力された状態で送信先を選べます。';
  } catch (e) {
    hint.textContent =
      `依頼文テンプレート（data/request-template.json）を読み込めなかったため、この機能は使えません（${e.message}）。`;
    preview.textContent = '読み込めませんでした';
  }
}

async function copyInviteText() {
  const hint = document.getElementById('invite-hint');
  const copyBtn = document.getElementById('invite-copy-btn');
  if (!state.invite) return;
  const text = state.invite.text;
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = copyViaExecCommand(text);
  if (ok) {
    hint.textContent =
      `文面をクリップボードにコピーしました（${text.length}字）。LINEやメールにそのまま貼り付けて送れます。`;
    copyBtn.textContent = 'コピーしました ✓';
    copyBtn.classList.add('btn-copied');
    setTimeout(() => {
      copyBtn.textContent = '文面をコピー';
      copyBtn.classList.remove('btn-copied');
    }, 2500);
  } else {
    hint.textContent =
      'クリップボードにコピーできませんでした。「送る文面を確認する」を開いて、文面を選んで手動でコピーしてください。';
  }
}

function copyViaExecCommand(text) {
  // navigator.clipboard が使えない環境（http のLAN配信など）のための代替
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/* ---------- すれ違い成立バナー ---------- */

let bannerTimer = null;

function showStreetpassBanner(message) {
  const banner = document.getElementById('streetpass-banner');
  document.getElementById('streetpass-body').textContent = message;
  banner.hidden = false;
  banner.classList.remove('show');
  // 再描画の後にアニメーションを付ける
  requestAnimationFrame(() => banner.classList.add('show'));
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideStreetpassBanner, 7000);
}

function hideStreetpassBanner() {
  clearTimeout(bannerTimer);
  document.getElementById('streetpass-banner').hidden = true;
}

/* ---------- 履歴のリセット ---------- */

function resetAll() {
  if (!window.confirm('受け取ったカードとすれ違い履歴を全部消します。よろしいですか？（自分のカードやサンプルは消えません）')) return;
  state.imported = [];
  state.history = [];
  savePersisted();
  renderAll();
}

/* ---------- タブとイベント ---------- */

function switchTab(name) {
  const tabs = [
    { btn: 'tab-btn-mine', panel: 'panel-mine' },
    { btn: 'tab-btn-plaza', panel: 'panel-plaza' },
    { btn: 'tab-btn-exchange', panel: 'panel-exchange' },
    { btn: 'tab-btn-history', panel: 'panel-history' }
  ];
  for (const t of tabs) {
    const btn = document.getElementById(t.btn);
    const panel = document.getElementById(t.panel);
    const selected = t.btn === `tab-btn-${name}`;
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    panel.hidden = !selected;
  }
}

function wireEvents() {
  for (const name of ['mine', 'plaza', 'exchange', 'history']) {
    document.getElementById(`tab-btn-${name}`).addEventListener('click', () => switchTab(name));
  }

  document.getElementById('export-btn').addEventListener('click', exportCards);

  const fileInput = document.getElementById('import-file');
  document.getElementById('import-file-btn').addEventListener('click', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      showImportError('JSONファイルを選んでからボタンを押してください。');
      return;
    }
    importFromFile(file);
  });

  document.getElementById('import-text-btn').addEventListener('click', () => {
    const text = document.getElementById('import-text').value;
    if (text.trim().length === 0) {
      showImportError('JSONを貼り付けてからボタンを押してください。');
      return;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      showImportError(`JSONとして読めませんでした: ${e.message}`);
      return;
    }
    importFromValue(value, { source: 'import' });
  });

  document.getElementById('sample-import-btn').addEventListener('click', importSamplePack);
  document.getElementById('invite-copy-btn').addEventListener('click', copyInviteText);
  document.getElementById('reset-btn').addEventListener('click', resetAll);
  document.getElementById('streetpass-close').addEventListener('click', hideStreetpassBanner);

  document.getElementById('plaza-filter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderPlaza();
  });
}

boot();
