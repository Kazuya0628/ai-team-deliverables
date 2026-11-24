import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSearchLinks, normalizeSources } from '../site/js/core/links.js';
import { defaultConditions, normalizeConditions } from '../site/js/core/conditions.js';

const COND = defaultConditions({ today: '2026-11-24' });

const SOURCES = [
  {
    id: 'verified-site',
    label: '条件付き検索（確かめ済み）',
    homeUrl: 'https://verified.example.com/',
    areaIds: [],
    searchUrlStatus: 'verified',
    searchUrlTemplate: 'https://verified.example.com/search?in={checkin}&out={checkout}&adults={adults}&rooms={rooms}',
    note: 'メモ',
  },
  {
    id: 'unverified-site',
    label: '条件付き検索（未検証）',
    homeUrl: 'https://unverified.example.com/',
    areaIds: [],
    searchUrlStatus: 'unverified',
    searchUrlTemplate: 'https://unverified.example.com/search?checkin={checkin}&adults={adults}',
  },
  {
    id: 'atami-only',
    label: '熱海のエリアページ',
    homeUrl: 'https://atami.example.com/',
    areaIds: ['shizuoka-east'],
    searchUrlTemplate: null,
    note: '日付・人数はサイト内で入力',
  },
];

test('normalizeSources: 配列・{ sources } のどちらの形でも受け付ける', () => {
  const a = normalizeSources(SOURCES);
  const b = normalizeSources({ sources: SOURCES });
  assert.equal(a.length, 3);
  assert.deepEqual(a, b);
});

test('normalizeSources: 形式がおかしい項目は無視する', () => {
  const result = normalizeSources([
    ...SOURCES,
    { id: 'no-home', label: 'URLなし', homeUrl: 'javascript:alert(1)' },
    { id: 'no-label', label: '', homeUrl: 'https://example.com/' },
    { id: 'bad-url', label: 'http', homeUrl: 'http://example.com/' },
    null,
    'text',
  ]);
  assert.deepEqual(result.map((s) => s.id), ['verified-site', 'unverified-site', 'atami-only']);
  assert.deepEqual(normalizeSources(undefined), []);
  assert.deepEqual(normalizeSources({ sources: 'not-array' }), []);
});

test('normalizeSources: searchUrlStatus は verified 以外は unverified にそろえる', () => {
  const [s] = normalizeSources([{ id: 'x', label: 'x', homeUrl: 'https://example.com/', searchUrlStatus: 'ok' }]);
  assert.equal(s.searchUrlStatus, 'unverified');
  assert.equal(s.searchUrlTemplate, null);
  assert.deepEqual(s.areaIds, []);
});

test('buildSearchLinks: 確かめ済みのテンプレートには検索条件を入れる', () => {
  const [link] = buildSearchLinks(SOURCES, COND);
  assert.equal(link.mode, 'verified');
  assert.equal(link.carriesConditions, true);
  assert.equal(
    link.url,
    'https://verified.example.com/search?in=2026-11-27&out=2026-11-28&adults=4&rooms=1',
  );
});

test('buildSearchLinks: 未検証のテンプレートは条件を入れるが「未検証」のまま', () => {
  const [, link] = buildSearchLinks(SOURCES, COND);
  assert.equal(link.mode, 'unverified');
  assert.equal(link.carriesConditions, true);
  assert.equal(link.url, 'https://unverified.example.com/search?checkin=2026-11-27&adults=4');
});

test('buildSearchLinks: テンプレートがないサイトはトップページへのリンクになり、条件は引き継がない', () => {
  const [, , link] = buildSearchLinks(SOURCES, COND);
  assert.equal(link.mode, 'manual');
  assert.equal(link.carriesConditions, false);
  assert.equal(link.url, 'https://atami.example.com/');
  assert.equal(link.note, '日付・人数はサイト内で入力');
});

test('buildSearchLinks: 選ばれていないエリア専用のサイトは出さない', () => {
  const tokyoOnly = normalizeConditions({ checkin: '2026-11-27', adults: '4', budget: '10000', areaIds: ['tokyo'] });
  assert.equal(tokyoOnly.ok, true);
  const ids = buildSearchLinks(SOURCES, tokyoOnly.value).map((s) => s.id);
  assert.deepEqual(ids, ['verified-site', 'unverified-site']);
  const all = buildSearchLinks(SOURCES, COND).map((s) => s.id);
  assert.deepEqual(all, ['verified-site', 'unverified-site', 'atami-only']);
});

test('buildSearchLinks: テンプレートが壊れている場合はトップページに戻す（エラーにしない）', () => {
  const broken = normalizeSources([
    { id: 'broken', label: '壊れている', homeUrl: 'https://example.com/', searchUrlStatus: 'verified', searchUrlTemplate: 'https://example.com/s?d={date}' },
    { id: 'not-https', label: 'httpsでない', homeUrl: 'https://example.com/', searchUrlStatus: 'verified', searchUrlTemplate: 'javascript:alert({adults})' },
  ]);
  const links = buildSearchLinks(broken, COND);
  assert.deepEqual(links.map((s) => s.mode), ['manual', 'manual']);
  assert.deepEqual(links.map((s) => s.url), ['https://example.com/', 'https://example.com/']);
});

const AGGREGATOR = {
  id: 'agg',
  label: 'まとめ検索',
  homeUrl: 'https://agg.example.com/',
  areaIds: [],
  searchUrlStatus: 'unverified',
  searchUrlTemplate: 'https://agg.example.com/s?q={q}&in={checkin}&adults={adults}',
  areaQueries: { tokyo: '東京', 'shizuoka-east': '熱海', chiba: '  ' },
};

test('buildSearchLinks: エリアごとの検索語があるサイトは、選ばれたエリアごとにリンクを作る', () => {
  const sources = normalizeSources([AGGREGATOR]);
  assert.deepEqual(Object.keys(sources[0].areaQueries), ['tokyo', 'shizuoka-east'], '空の検索語は除く');
  const cond = normalizeConditions({ checkin: '2026-11-27', adults: '4', budget: '10000', areaIds: ['chiba', 'shizuoka-east', 'tokyo'] });
  assert.equal(cond.ok, true);
  const links = buildSearchLinks(sources, cond.value);
  assert.deepEqual(links.map((l) => l.id), ['agg:tokyo', 'agg:shizuoka-east'], 'エリアの定義順');
  assert.equal(links[0].label, 'まとめ検索（東京）');
  assert.equal(links[0].areaId, 'tokyo');
  assert.equal(links[0].mode, 'unverified');
  assert.equal(links[0].carriesConditions, true);
  assert.equal(links[0].url, 'https://agg.example.com/s?q=%E6%9D%B1%E4%BA%AC&in=2026-11-27&adults=4', '検索語はURLエンコードされる');
  assert.equal(links[1].url, 'https://agg.example.com/s?q=%E7%86%B1%E6%B5%B7&in=2026-11-27&adults=4');
});

test('buildSearchLinks: 検索語を持たないエリアだけが選ばれているときはトップページへのリンク1つにする', () => {
  const sources = normalizeSources([AGGREGATOR]);
  const cond = normalizeConditions({ checkin: '2026-11-27', adults: '2', budget: 'none', areaIds: ['chiba'] });
  const links = buildSearchLinks(sources, cond.value);
  assert.equal(links.length, 1);
  assert.equal(links[0].id, 'agg');
  assert.equal(links[0].label, 'まとめ検索');
  assert.equal(links[0].mode, 'manual');
  assert.equal(links[0].url, 'https://agg.example.com/');
});

test('buildSearchLinks: エリアごとの検索語があっても、サイトの対象エリア外なら出さない', () => {
  const sources = normalizeSources([{ ...AGGREGATOR, areaIds: ['tokyo'] }]);
  const cond = normalizeConditions({ checkin: '2026-11-27', adults: '4', budget: '10000', areaIds: ['gunma', 'tokyo'] });
  const links = buildSearchLinks(sources, cond.value);
  assert.deepEqual(links.map((l) => l.id), ['agg:tokyo']);
  const none = normalizeConditions({ checkin: '2026-11-27', adults: '4', budget: '10000', areaIds: ['gunma'] });
  assert.deepEqual(buildSearchLinks(sources, none.value), []);
});

test('buildSearchLinks: {q} を使うテンプレートに検索語を渡せない場合はトップページに戻す', () => {
  const sources = normalizeSources([{ ...AGGREGATOR, areaQueries: null }]);
  const links = buildSearchLinks(sources, COND);
  assert.equal(links.length, 1);
  assert.equal(links[0].mode, 'manual');
  assert.equal(links[0].url, 'https://agg.example.com/');
});
