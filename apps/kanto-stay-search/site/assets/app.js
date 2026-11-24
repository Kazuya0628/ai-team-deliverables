/**
 * kanto-stay-search の画面ロジック（依存ライブラリなし）。
 * 検証・絞り込みのルールは ../core/ の各モジュールにあり、このファイルは入力の読み取りと表示だけを担う。
 */
import { AREAS, AREA_IDS, areaLabel } from '../js/core/areas.js';
import { defaultConditions, normalizeConditions } from '../js/core/conditions.js';
import { formatJpDate, formatJpDateTime, isFriday, isValidDate, todayJst, upcomingFridays } from '../js/core/dates.js';
import { buildSearchLinks, normalizeSources } from '../js/core/links.js';
import { STALE_HOURS, freshness, selectStays, validateDataset } from '../js/core/stays.js';

/** 「金曜日を選ぶ」ボタンの数（週） */
const QUICK_DATE_COUNT = 6;

/** 外部サイトリンクの種類ごとの表示文言 */
const MODE_TEXT = {
  verified: { tag: '条件を引き継ぎ（確認済み）', note: 'URLに検索条件を入れて開きます。' },
  unverified: {
    tag: '条件の引き継ぎは未検証',
    note: 'URLに検索条件を入れて開きますが、引き継がれるかどうかは確かめられていません。開いた先で日付と人数を確認してください。',
  },
  manual: { tag: '条件は手入力', note: '検索条件は引き継ぎません。サイト内で日付・人数を入力してください。' },
};

const state = {
  /** 表示に使う「現在時刻」（描画のたびに更新する） */
  now: new Date(),
  /** 検証を通った確認済みデータ */
  entries: [],
  /** 外部サイトの定義 */
  sources: [],
  /** 現在の検索条件 */
  cond: null,
  /** データ読み込みに失敗したときのエラー */
  loadError: null,
};

/* ---------- 小さな部品 ---------- */

function byId(id) {
  return document.getElementById(id);
}

/** 要素を作る。attrs の text は文字列、class はクラス名、dataset は data-* 属性。それ以外は属性として設定する */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }
  return node;
}

/** 9800 → '¥9,800' */
function formatYen(amount) {
  return `¥${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url.pathname} を読み込めませんでした（HTTP ${response.status}）`);
  return response.json();
}

/* ---------- 検索条件の入出力 ---------- */

function areaCheckboxes() {
  return Array.from(byId('area-list').querySelectorAll('input[type="checkbox"]'));
}

function buildAreaCheckboxes() {
  const list = byId('area-list');
  for (const area of AREAS) {
    const note = area.note ? el('small', { text: `（${area.note}）` }) : null;
    list.append(el('label', {}, [el('input', { type: 'checkbox', name: 'area', value: area.id }), ` ${area.label}`, note]));
  }
}

function buildQuickDates() {
  const container = byId('quick-dates');
  for (const friday of upcomingFridays(todayJst(state.now), QUICK_DATE_COUNT)) {
    const button = el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': 'false',
      dataset: { date: friday },
      text: formatJpDate(friday),
    });
    button.addEventListener('click', () => {
      byId('date-input').value = friday;
      onConditionChange();
    });
    container.append(button);
  }
}

function updateQuickDates(current) {
  for (const button of byId('quick-dates').querySelectorAll('button')) {
    const active = button.dataset.date === current;
    button.classList.toggle('chip--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function updateDateNote(dateStr) {
  const note = byId('weekday-note');
  if (!isValidDate(dateStr)) {
    note.textContent = '';
  } else {
    note.textContent = isFriday(dateStr) ? '金曜日チェックイン' : '金曜日ではありません';
  }
}

function fillForm(cond) {
  byId('date-input').value = cond.checkin;
  byId('date-input').min = todayJst(state.now);
  byId('adults-select').value = String(cond.adults);
  byId('budget-unlimited').checked = cond.budget === null;
  byId('budget-input').value = cond.budget === null ? '' : String(cond.budget);
  byId('budget-input').disabled = cond.budget === null;
  for (const checkbox of areaCheckboxes()) checkbox.checked = cond.areaIds.includes(checkbox.value);
  updateQuickDates(cond.checkin);
  updateDateNote(cond.checkin);
}

function readForm() {
  return {
    checkin: byId('date-input').value,
    adults: byId('adults-select').value,
    budget: byId('budget-unlimited').checked ? null : byId('budget-input').value,
    areaIds: areaCheckboxes()
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value),
  };
}

function showConditionError(messages) {
  const box = byId('condition-error');
  box.textContent = messages.join('。');
  box.hidden = messages.length === 0;
}

function onConditionChange() {
  byId('budget-input').disabled = byId('budget-unlimited').checked;
  const result = normalizeConditions(readForm());
  if (!result.ok) {
    showConditionError(result.errors);
    return;
  }
  showConditionError([]);
  state.cond = result.value;
  updateQuickDates(result.value.checkin);
  updateDateNote(result.value.checkin);
  writeConditionsToLocation(result.value);
  render();
}

/** URLのクエリパラメータから検索条件を読む（指定がない項目は含めない） */
function readConditionsFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const picked = {};
  const checkin = params.get('checkin');
  if (checkin !== null) picked.checkin = checkin;
  const adults = params.get('adults');
  if (adults !== null) picked.adults = adults;
  if (params.has('budget')) picked.budget = params.get('budget') || 'none';
  const areas = params.get('areas');
  if (areas !== null) picked.areaIds = areas.split(',');
  return picked;
}

/** 現在の検索条件をURLに反映する（共有・再読み込みのため）。失敗しても表示は続ける */
function writeConditionsToLocation(cond) {
  const params = new URLSearchParams();
  params.set('checkin', cond.checkin);
  params.set('adults', String(cond.adults));
  params.set('budget', cond.budget === null ? 'none' : String(cond.budget));
  if (cond.areaIds.length !== AREA_IDS.length) params.set('areas', cond.areaIds.join(','));
  const query = params.toString();
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  } catch (error) {
    // file:// などで書き換えられない場合は、URLへの反映だけあきらめる
  }
}

function bindEvents() {
  const form = byId('condition-form');
  form.addEventListener('change', onConditionChange);
  form.addEventListener('submit', (event) => event.preventDefault());

  byId('reset-button').addEventListener('click', () => {
    state.now = new Date();
    state.cond = defaultConditions({ today: todayJst(state.now) });
    fillForm(state.cond);
    showConditionError([]);
    writeConditionsToLocation(state.cond);
    render();
  });

  byId('area-all-button').addEventListener('click', () => {
    for (const checkbox of areaCheckboxes()) checkbox.checked = true;
    onConditionChange();
  });
}

/* ---------- 表示 ---------- */

function render() {
  state.now = new Date();
  renderResults(state.cond);
  renderHandoff(state.cond);
}

function budgetLabel(budget) {
  return budget === null ? '上限なし' : `${formatYen(budget)}以内`;
}

function emptyMessages() {
  if (state.loadError) {
    return ['確認済みデータを読み込めなかったため、表示できる宿がありません。下の「この条件で各サイトを調べる」から最新の空室を調べてください。'];
  }
  if (state.entries.length === 0) {
    return [
      'まだ確認済みの宿が登録されていません。',
      'このアプリは、予約ページで空室と1部屋総額を実際に確認できた宿だけを載せています。確認が済んだ宿から順に追加します。',
    ];
  }
  return [
    'この条件に合う確認済みの宿はありません。',
    '別の日付・人数で確認された宿は表示していません（条件の違う料金を見せないためです）。条件を変えるか、下のサイトで最新の空室を調べてください。',
  ];
}

function renderResults(cond) {
  const list = byId('results-list');
  const empty = byId('results-empty');
  list.replaceChildren();
  empty.replaceChildren();

  const today = todayJst(state.now);
  const items = state.loadError ? [] : selectStays(state.entries, cond, { today });
  byId('results-summary').textContent = `${formatJpDate(cond.checkin)}チェックイン・1泊・大人${cond.adults}名・1部屋・1部屋総額${budgetLabel(cond.budget)}：確認済みの宿 ${items.length}件`;

  for (const entry of items) list.append(renderCard(entry));

  if (items.length === 0) {
    empty.append(...emptyMessages().map((text) => el('p', { text })));
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

function renderCard(entry) {
  const status = freshness(entry, state.now);
  const badge = status.stale
    ? el('span', { class: 'badge badge--stale', text: `確認から${STALE_HOURS}時間以上経過・要再確認` })
    : el('span', { class: 'badge', text: '空室を確認済み' });
  const spec = [
    ['部屋タイプ', entry.roomType],
    ['プラン', entry.planName],
    ['食事条件', entry.meal.label],
    ['キャンセル条件', entry.cancellation.text],
  ];

  return el('article', { class: status.stale ? 'stay stay--stale' : 'stay' }, [
    el('div', { class: 'stay__head' }, [
      el('div', { class: 'stay__heading' }, [
        badge,
        el('h3', { class: 'stay__name', text: entry.hotelName }),
        el('p', { class: 'stay__area', text: `${entry.location}（${areaLabel(entry.areaId)}）` }),
      ]),
      el('p', { class: 'stay__price' }, [
        el('span', { class: 'stay__price-value', text: formatYen(entry.priceTotal) }),
        el('span', { class: 'stay__price-unit', text: '1部屋 総額（税込）' }),
        el('span', { class: 'stay__price-note', text: `大人${entry.conditions.adults}名・1室・1泊` }),
      ]),
    ]),
    el('dl', { class: 'stay__spec' }, spec.map(([term, text]) => el('div', { class: 'stay__spec-row' }, [el('dt', { text: term }), el('dd', { text })]))),
    el('div', { class: 'stay__foot' }, [
      el('p', { class: 'stay__checked', text: `確認日時: ${formatJpDateTime(entry.checkedAt)}（${entry.sourceLabel}の予約ページで確認）` }),
      el('p', { class: 'stay__evidence', text: `確認の根拠: ${entry.evidence}` }),
      el('a', { class: 'button button--primary', href: entry.planUrl, target: '_blank', rel: 'noopener noreferrer' }, '予約ページで空室・価格を確認する'),
    ]),
  ]);
}

function renderDataMeta(raw, result) {
  const parts = [`登録されている確認済みデータ: ${result.entries.length}件`];
  const updatedAt = raw && typeof raw.updatedAt === 'string' ? formatJpDateTime(raw.updatedAt) : '';
  if (updatedAt) parts.push(`データ最終更新: ${updatedAt}`);
  if (result.problems.length > 0) parts.push(`※ ${result.problems.length}件は必須項目が足りないため表示していません`);
  byId('data-meta').textContent = parts.join('／');
  for (const problem of result.problems) console.warn(`[kanto-stay-search] 表示できないデータがあります → ${problem}`);
}

function renderLoadError(error) {
  state.loadError = error;
  const box = byId('load-error');
  box.replaceChildren(
    el('p', { text: '確認済みデータを読み込めませんでした。' }),
    el('p', {
      text: 'ファイルをブラウザで直接開いた場合は、HTTP サーバーを通して開いてください（README の「ローカルで確認する」参照）。',
    }),
    el('p', { text: `エラー: ${error instanceof Error ? error.message : String(error)}` }),
  );
  box.hidden = false;
  console.error(error);
}

function renderHandoff(cond) {
  byId('handoff-condition').textContent =
    `検索条件：${formatJpDate(cond.checkin)}チェックイン・1泊・大人${cond.adults}名・1部屋・1部屋総額${budgetLabel(cond.budget)}`;

  const list = byId('handoff-list');
  list.replaceChildren();
  if (state.sources.length === 0) {
    list.append(el('li', { text: '外部サイトの情報を読み込めませんでした。' }));
    return;
  }

  const groups = new Map();
  for (const link of buildSearchLinks(state.sources, cond)) {
    if (!groups.has(link.sourceId)) groups.set(link.sourceId, []);
    groups.get(link.sourceId).push(link);
  }

  for (const [sourceId, links] of groups) {
    const site = state.sources.find((source) => source.id === sourceId);
    const mode = MODE_TEXT[links[0].mode];
    const notes = [mode.note];
    for (const link of links) {
      if (link.note && !notes.includes(link.note)) notes.push(link.note);
    }
    list.append(
      el('li', { class: 'handoff__item' }, [
        el('div', { class: 'handoff__item-head' }, [
          el('span', { class: 'handoff__site', text: site ? site.label : sourceId }),
          el('span', { class: `tag tag--${links[0].mode}`, text: mode.tag }),
        ]),
        el('p', { class: 'handoff__note', text: notes.join(' ') }),
        el('div', { class: 'handoff__links' }, [
          ...links.map((link) =>
            el(
              'a',
              { class: 'button', href: link.url, target: '_blank', rel: 'noopener noreferrer' },
              link.areaId ? areaLabel(link.areaId) : '開く',
            ),
          ),
        ]),
      ]),
    );
  }
}

/* ---------- 起動 ---------- */

async function init() {
  state.now = new Date();
  buildAreaCheckboxes();
  buildQuickDates();

  const defaults = defaultConditions({ today: todayJst(state.now) });
  const normalized = normalizeConditions({ ...defaults, ...readConditionsFromLocation() });
  state.cond = normalized.ok ? normalized.value : defaults;

  bindEvents();
  fillForm(state.cond);
  render();

  try {
    const [verified, sources] = await Promise.all([
      loadJson(new URL('../data/verified.json', import.meta.url)),
      loadJson(new URL('../data/sources.json', import.meta.url)),
    ]);
    const result = validateDataset(verified, { now: new Date() });
    state.entries = result.entries;
    state.sources = normalizeSources(sources);
    state.loadError = null;
    renderDataMeta(verified, result);
  } catch (error) {
    state.entries = [];
    state.sources = [];
    renderLoadError(error);
  }
  render();
}

init().catch((error) => {
  console.error(error);
  const box = byId('load-error');
  if (box) {
    box.hidden = false;
    box.textContent = 'アプリの初期化に失敗しました。ページを再読み込みしてください。';
  }
});
