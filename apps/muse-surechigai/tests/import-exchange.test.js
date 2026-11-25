// 自動交換の取り込みスクリプト（tools/import-exchange.js）のテスト。
// 実行: node --test tests/ （または npm test）
// 実フォルダ（exchange/）は触らず、OS の一時フォルダに交換置き場を再現して検証する。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COLLECTED_FORMAT,
  COLLECTED_VERSION,
  emptyCollected,
  importFromInbox,
  listJsonFiles,
  loadCollected,
  readOutbox,
  writeCollected
} from '../tools/import-exchange.js';
import { buildPack } from '../site/assets/validator.js';

// 2026-11-25 固定で日時まわりの assert を安定させる
const NOW = new Date('2026-11-25T12:00:00+09:00');
const opts = { now: NOW };

const ownCard = {
  id: 'my-card-01',
  artifactName: '自分の作品',
  tagline: 'はやちゃん側の公開カードのテスト用。',
  category: 'ツール',
  tech: ['HTML'],
  learning: 'outbox の id は自分のカードとして保護される。',
  createdAt: '2026-11-24'
};

function partnerCard(overrides = {}) {
  return {
    id: 'team-a-app-01',
    artifactName: 'チームAの作品',
    tagline: 'パートナーが置いたカードのテスト用。',
    category: 'アプリ',
    tech: ['JavaScript'],
    learning: 'テストからも取り込める。',
    createdAt: '2026-11-20',
    ...overrides
  };
}

/** exchange/ の一時フォルダを作る（outbox に自分のカード1枚入り） */
function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'surechigai-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const exchange = join(root, 'exchange');
  const inbox = join(exchange, 'inbox');
  const outbox = join(exchange, 'outbox-hayachan');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  writeFileSync(join(outbox, `${ownCard.id}.json`), JSON.stringify(ownCard, null, 2));
  return { root, exchange, inbox, outbox };
}

test('importFromInbox: カード1枚のJSONを取り込める・履歴に記録される', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  writeFileSync(join(f.inbox, 'team-a', 'team-a-app-01.json'), JSON.stringify(partnerCard(), null, 2));

  const { collected, report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(collected.cards.length, 1);
  assert.equal(collected.cards[0].id, 'team-a-app-01');
  assert.equal(collected.history.length, 1);
  assert.equal(collected.history[0].from, 'team-a');
  assert.deepEqual(collected.history[0].addedIds, ['team-a-app-01']);
  assert.equal(collected.updatedAt, NOW.toISOString());
  assert.equal(report.addedCount, 1);
  assert.equal(report.errorFileCount, 0);
});

test('importFromInbox: パック形式とカードの配列のファイルも読める', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  const pack = buildPack(
    [partnerCard({ id: 'team-a-app-02' }), partnerCard({ id: 'team-a-app-03' })],
    { note: 'チームAのパックです' }
  );
  writeFileSync(join(f.inbox, 'team-a', 'pack-1.json'), JSON.stringify(pack, null, 2));
  writeFileSync(
    join(f.inbox, 'team-a', 'array.json'),
    JSON.stringify([partnerCard({ id: 'team-a-app-04' })], null, 2)
  );

  const { collected, report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.deepEqual(
    collected.cards.map((c) => c.id).sort(),
    ['team-a-app-02', 'team-a-app-03', 'team-a-app-04']
  );
  assert.equal(report.addedCount, 3);
  // 追加のあった2ファイルだけ履歴に載る
  assert.equal(collected.history.length, 2);
});

test('importFromInbox: 取り込みずみの id はスキップし、2回実行しても増えない（冪等）', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  const cardFile = join(f.inbox, 'team-a', 'team-a-app-01.json');
  writeFileSync(cardFile, JSON.stringify(partnerCard(), null, 2));

  const first = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(first.collected.cards.length, 1);

  // 2回目: 同じファイルが残っていても所持数も履歴も増えない
  const second = importFromInbox({ collected: first.collected, inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(second.collected.cards.length, 1);
  assert.equal(second.collected.history.length, 1); // 履歴には追加されない
  assert.equal(second.report.addedCount, 0);
  assert.equal(second.report.files[0].skipped[0].reason, 'すでに取り込みずみ');
});

test('importFromInbox: outbox-hayachan と同じ id のカードは取り込まない', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  writeFileSync(
    join(f.inbox, 'team-a', 'my-card-01.json'),
    JSON.stringify(partnerCard({ id: 'my-card-01', artifactName: 'なりすまし作品' }), null, 2)
  );

  const { collected, report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(collected.cards.length, 0);
  assert.deepEqual(report.files[0].skipped, [
    { id: 'my-card-01', reason: '自分のカード（outbox-hayachan）と同じ id' }
  ]);
  // スキップだけでは履歴に載らない
  assert.equal(collected.history.length, 0);
});

test('importFromInbox: 同じ実行内の id 重複は、先に処理したファイルの1枚だけ（ファイル名順）', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  mkdirSync(join(f.inbox, 'team-b'), { recursive: true });
  writeFileSync(
    join(f.inbox, 'team-a', 'aaa.json'),
    JSON.stringify(partnerCard({ id: 'same-id-01', artifactName: '先に処理される側' }), null, 2)
  );
  writeFileSync(
    join(f.inbox, 'team-b', 'bbb.json'),
    JSON.stringify(partnerCard({ id: 'same-id-01', artifactName: '後から弾かれる側' }), null, 2)
  );

  const { collected } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(collected.cards.length, 1);
  assert.equal(collected.cards[0].artifactName, '先に処理される側');
  // team-a のファイルだけが履歴対象
  assert.equal(collected.history.length, 1);
  assert.equal(collected.history[0].from, 'team-a');
});

test('importFromInbox: 壊れたJSON・不正カードはエラーになり、他のファイルは取り込まれる', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  writeFileSync(join(f.inbox, 'team-a', 'broken.json'), '{ これはJSONではない');
  writeFileSync(
    join(f.inbox, 'team-a', 'invalid.json'),
    JSON.stringify(partnerCard({ category: '家電' }), null, 2) // カテゴリが列挙外
  );
  writeFileSync(
    join(f.inbox, 'team-a', 'good.json'),
    JSON.stringify(partnerCard({ id: 'team-a-app-09' }), null, 2)
  );

  const { collected, report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.deepEqual(collected.cards.map((c) => c.id), ['team-a-app-09']);
  assert.equal(report.errorFileCount, 2);
  // エラーのあった2ファイルと、取り込みのあった good.json が履歴に記録される
  // （履歴ルール：追加またはエラーがあったファイルだけ記録する）
  assert.deepEqual(
    collected.history.map((h) => h.file).sort(),
    ['team-a/broken.json', 'team-a/good.json', 'team-a/invalid.json']
  );
  assert.ok(collected.history[0].errors.length >= 1);
});

test('importFromInbox: 追加もエラーも無いファイルは履歴に載らない（定期実行でも履歴が太らない）', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  writeFileSync(
    join(f.inbox, 'team-a', 'team-a-app-01.json'),
    JSON.stringify(partnerCard(), null, 2)
  );

  const first = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  const second = importFromInbox({ collected: first.collected, inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(first.collected.history.length, 1);
  assert.equal(second.collected.history.length, 1); // 変化がないので増えない
});

test('importFromInbox: inbox が空・無しでもエラーにならない', (t) => {
  const f = makeFixture(t);
  const empty = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.equal(empty.collected.cards.length, 0);
  assert.equal(empty.report.files.length, 0);
  assert.equal(empty.report.inboxMissing, false);

  const missing = importFromInbox({
    collected: emptyCollected(),
    inboxDir: join(f.root, 'not-exist'),
    outboxDir: f.outbox,
    ...opts
  });
  assert.equal(missing.report.inboxMissing, true);
  assert.equal(missing.collected.cards.length, 0);
});

test('importFromInbox: inbox直下のファイルは警告つきで取り込む', (t) => {
  const f = makeFixture(t);
  writeFileSync(join(f.inbox, 'loose.json'), JSON.stringify(partnerCard({ id: 'loose-card-01' }), null, 2));

  const { collected, report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.deepEqual(collected.cards.map((c) => c.id), ['loose-card-01']);
  assert.equal(report.files[0].from, 'inbox直下');
  assert.ok(report.files[0].warnings.some((w) => w.includes('サブフォルダ')));
});

test('importFromInbox: id がフォルダ名から始まっていないと推奨の警告を出す', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  writeFileSync(
    join(f.inbox, 'team-a', 'other-name-01.json'),
    JSON.stringify(partnerCard({ id: 'other-name-01' }), null, 2)
  );

  const { report } = importFromInbox({ collected: emptyCollected(), inboxDir: f.inbox, outboxDir: f.outbox, ...opts });
  assert.ok(report.files[0].warnings.some((w) => w.includes('team-a-')));
});

test('readOutbox: カードの id を集め、1枚1ファイルのファイル名規則をチェックする', (t) => {
  const f = makeFixture(t);
  // makeFixture は outbox に my-card-01.json を1枚入れているため、
  // ファイル名のずれを確かめる分は別の id のカードで置く
  const otherCard = { ...ownCard, id: 'my-card-02', artifactName: 'もう一つの作品' };
  writeFileSync(join(f.outbox, 'wrong-name.json'), JSON.stringify(otherCard, null, 2));

  const out = readOutbox(f.outbox, NOW);
  assert.deepEqual([...out.ids].sort(), ['my-card-01', 'my-card-02']);
  assert.equal(out.cardCount, 2);
  assert.equal(out.fileCount, 2);
  assert.ok(out.warnings.some((w) => w.includes('my-card-02.json')));
});

test('listJsonFiles: .json だけ・隠しファイル除外・サブフォルダも再帰・名前順', (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.inbox, 'team-a'), { recursive: true });
  mkdirSync(join(f.inbox, '.hidden'), { recursive: true });
  writeFileSync(join(f.inbox, 'b.json'), '{}');
  writeFileSync(join(f.inbox, 'a.txt'), 'not json');
  writeFileSync(join(f.inbox, '.c.json'), '{}');
  writeFileSync(join(f.inbox, 'team-a', 'd.json'), '{}');
  writeFileSync(join(f.inbox, '.hidden', 'e.json'), '{}');

  assert.deepEqual(listJsonFiles(f.inbox), ['b.json', 'team-a/d.json']);
});

test('loadCollected: 正常な初期構造を読める', () => {
  const loaded = loadCollected(JSON.stringify(emptyCollected(NOW.toISOString())));
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.collected.cards, []);
  assert.deepEqual(loaded.collected.history, []);
  assert.equal(loaded.collected.format, COLLECTED_FORMAT);
  assert.equal(loaded.collected.collectedVersion, COLLECTED_VERSION);
});

test('loadCollected: 形式の異常はエラーになる', () => {
  // format 違い
  assert.equal(
    loadCollected(JSON.stringify({ ...emptyCollected(), format: 'other' })).ok,
    false
  );
  // collectedVersion 違い
  assert.equal(loadCollected(JSON.stringify({ ...emptyCollected(), collectedVersion: 2 })).ok, false);
  // cards 欠け
  const noCards = emptyCollected();
  delete noCards.cards;
  assert.equal(loadCollected(JSON.stringify(noCards)).ok, false);
  // 配列以外
  assert.equal(loadCollected('[]').ok, false);
  // 壊れたJSON
  assert.equal(loadCollected('not json').ok, false);
});

test('loadCollected: 所持カードが壊れていたらエラー（手で編集されても気づける）', () => {
  const broken = emptyCollected();
  broken.cards.push({ id: 'x-01' }); // 必須項目が欠けたカード
  const r = loadCollected(JSON.stringify(broken));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('cards[0]')));

  const dup = emptyCollected();
  dup.cards.push(partnerCard(), partnerCard());
  const r2 = loadCollected(JSON.stringify(dup));
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('重複')));
});

test('writeCollected → loadCollected の往復ができる（2スペース＋末尾改行）', (t) => {
  const f = makeFixture(t);
  const target = join(f.exchange, 'collected.json');
  const collected = emptyCollected(NOW.toISOString());
  collected.cards.push(partnerCard());

  writeCollected(target, collected);
  const raw = readFileSync(target, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.ok(raw.includes('  "format"')); // 2スペースインデント

  const loaded = loadCollected(raw);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.collected.cards.length, 1);
  assert.deepEqual(loaded.collected.cards[0], partnerCard());
  assert.equal(loaded.collected.updatedAt, NOW.toISOString());
});
