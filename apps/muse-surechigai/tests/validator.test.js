// 検証ロジック（site/assets/validator.js）のテスト。
// 実行: node --test tests/ （または npm test）

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCard,
  validatePack,
  parseImport,
  buildPack,
  isValidDateString,
  CATEGORIES,
  PACK_FORMAT,
  PACK_VERSION
} from '../site/assets/validator.js';

// 2026-11-25 固定で「未来日」の判定を安定させる
const NOW = new Date('2026-11-25T12:00:00+09:00');
const opts = { now: NOW };

const goodCard = {
  id: 'test-card-01',
  displayName: 'テストのMuse',
  artifactName: 'テスト作品',
  tagline: 'テスト用のひとこと説明です。',
  category: 'ツール',
  tech: ['HTML', 'CSS'],
  link: 'https://example.com/test',
  learning: 'テスト用のひとこと学びです。',
  createdAt: '2026-11-20'
};

test('validateCard: 正常なカードは通る', () => {
  const r = validateCard(goodCard, opts);
  assert.equal(r.ok, true, r.errors.join(' / '));
  assert.deepEqual(r.warnings, []);
});

test('validateCard: 必須項目が null 許可の項目を省いた最小カードも通る（匿名カード）', () => {
  const r = validateCard(
    {
      id: 'minimal-card',
      artifactName: '最小カード',
      tagline: '最小構成の説明。',
      category: 'その他',
      tech: ['手作業'],
      learning: '最小でも作れる。',
      createdAt: '2026-01-01'
    },
    opts
  );
  assert.equal(r.ok, true, r.errors.join(' / '));
});

test('validateCard: 必須項目が1つでも欠けたらエラー', () => {
  const { id, ...withoutId } = goodCard;
  assert.equal(validateCard(withoutId, opts).ok, false);
  for (const key of ['artifactName', 'tagline', 'category', 'tech', 'learning', 'createdAt']) {
    const { [key]: _omitted, ...rest } = goodCard;
    const r = validateCard(rest, opts);
    assert.equal(r.ok, false, `${key} が無いのに通ってしまった`);
  }
});

test('validateCard: id の形式（大文字・先頭ハイフン・記号・64字超は不可）', () => {
  for (const bad of ['Test-card', '-test', 'test-', 'test_card', 'テスト', 'a'.repeat(65)]) {
    const r = validateCard({ ...goodCard, id: bad }, opts);
    assert.equal(r.ok, false, `id: ${bad.slice(0, 12)} が通ってしまった`);
  }
  assert.equal(validateCard({ ...goodCard, id: 'a'.repeat(64) }, opts).ok, true);
});

test('validateCard: displayName は空文字は不可・null は匿名として可', () => {
  assert.equal(validateCard({ ...goodCard, displayName: '' }, opts).ok, false);
  const r = validateCard({ ...goodCard, displayName: null }, opts);
  assert.equal(r.ok, true);
});

test('validateCard: カテゴリは列挙から選ぶ', () => {
  const r = validateCard({ ...goodCard, category: '家電' }, opts);
  assert.equal(r.ok, false);
  for (const c of CATEGORIES) {
    assert.equal(validateCard({ ...goodCard, category: c }, opts).ok, true, c);
  }
});

test('validateCard: tech は1個以上8個まで・空と9個は不可', () => {
  assert.equal(validateCard({ ...goodCard, tech: [] }, opts).ok, false);
  assert.equal(
    validateCard({ ...goodCard, tech: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }, opts).ok,
    false
  );
});

test('validateCard: tech の重複は警告（エラーにはしない）', () => {
  const r = validateCard({ ...goodCard, tech: ['CSS', 'CSS'] }, opts);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.some((w) => w.includes('重複')), true);
});

test('validateCard: link は https のみ・http と javascript: は不可', () => {
  assert.equal(validateCard({ ...goodCard, link: 'http://example.com/' }, opts).ok, false);
  assert.equal(validateCard({ ...goodCard, link: 'javascript:alert(1)' }, opts).ok, false);
  assert.equal(validateCard({ ...goodCard, link: 'https: //example.com' }, opts).ok, false);
  assert.equal(validateCard({ ...goodCard, link: null }, opts).ok, true);
});

test('validateCard: createdAt は実在する日付のみ・未来日は警告', () => {
  assert.equal(validateCard({ ...goodCard, createdAt: '2026-02-30' }, opts).ok, false);
  assert.equal(validateCard({ ...goodCard, createdAt: '2026-11-2' }, opts).ok, false);
  const future = validateCard({ ...goodCard, createdAt: '2026-12-01' }, opts);
  assert.equal(future.ok, true);
  assert.equal(future.warnings.some((w) => w.includes('未来')), true);
});

test('validateCard: 決められた項目以外はエラー（additionalProperties 相当）', () => {
  const r = validateCard({ ...goodCard, mail: 'who@example.com' }, opts);
  assert.equal(r.ok, false);
  assert.equal(r.errors.some((e) => e.includes('mail')), true);
});

test('isValidDateString: 実在する日付だけ true', () => {
  assert.equal(isValidDateString('2026-11-25'), true);
  assert.equal(isValidDateString('2024-02-29'), true); // うるう年
  assert.equal(isValidDateString('2026-02-29'), false);
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('20261125'), false);
});

test('validatePack: 正常なパックは通る・サンプルフラグが取れる', () => {
  const pack = buildPack([goodCard], { note: 'サンプルです', sample: true });
  const r = validatePack(pack, opts);
  assert.equal(r.ok, true, r.errors.join(' / '));
  assert.equal(r.sample, true);
  assert.deepEqual(r.cards.map((c) => c.id), [goodCard.id]);
});

test('validatePack: format・packVersion が違うとエラー', () => {
  const bad1 = { ...buildPack([goodCard]), format: 'other-pack' };
  assert.equal(validatePack(bad1, opts).ok, false);
  const bad2 = { ...buildPack([goodCard]), packVersion: 2 };
  assert.equal(validatePack(bad2, opts).ok, false);
});

test('validatePack: パック内の id 重複はエラー', () => {
  const pack = buildPack([goodCard, { ...goodCard, artifactName: '別名' }]);
  const r = validatePack(pack, opts);
  assert.equal(r.ok, false);
  assert.equal(r.errors.some((e) => e.includes('重複')), true);
});

test('validatePack: cards が空・欠けているとエラー', () => {
  assert.equal(validatePack({ format: PACK_FORMAT, packVersion: PACK_VERSION, cards: [] }, opts).ok, false);
  assert.equal(validatePack({ format: PACK_FORMAT, packVersion: PACK_VERSION }, opts).ok, false);
});

test('validatePack: sample: true なのに note に「サンプル」「架空」がないと警告', () => {
  const pack = buildPack([goodCard], { note: 'メモ', sample: true });
  const r = validatePack(pack, opts);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.some((w) => w.includes('サンプル')), true);
});

test('parseImport: パック・配列・カード1枚の3形態を読める', () => {
  const pack = parseImport(buildPack([goodCard]), opts);
  assert.equal(pack.ok, true);
  assert.equal(pack.cards.length, 1);

  const arr = parseImport([goodCard, { ...goodCard, id: 'test-card-02' }], opts);
  assert.equal(arr.ok, true);
  assert.equal(arr.cards.length, 2);
  assert.equal(arr.sample, false);

  const single = parseImport(goodCard, opts);
  assert.equal(single.ok, true);
  assert.equal(single.cards.length, 1);
});

test('parseImport: 壊れた入力は ok: false とエラー理由', () => {
  for (const bad of [null, '文字列', 42, [], { foo: 'bar' }]) {
    const r = parseImport(bad, opts);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.length >= 1);
  }
});

test('parseImport: 配列内の id 重複はエラー', () => {
  const r = parseImport([goodCard, goodCard], opts);
  assert.equal(r.ok, false);
});

test('buildPack: 書き出し用のパックが仕様どおりに組み立つ', () => {
  const pack = buildPack([goodCard], { note: 'テスト', exportedAt: new Date('2026-11-25T09:00:00+09:00') });
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.packVersion, PACK_VERSION);
  assert.equal(pack.exportedAt, '2026-11-25T00:00:00.000Z');
  assert.equal(pack.note, 'テスト');
  assert.equal('sample' in pack, false);
});
