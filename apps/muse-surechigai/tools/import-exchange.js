#!/usr/bin/env node
// 自動交換（exchange/）の取り込みスクリプト。
//
//   node tools/import-exchange.js            # exchange/inbox/ のカードを読み、exchange/collected.json に反映する
//   node tools/import-exchange.js --dry-run  # 反映せず、結果の表示だけ行う（cron前の確認用）
//   npm run import-exchange -- --dry-run     # 上と同じ（npm スクリプト経由）
//
// 動き:
//   1. exchange/collected.json を読む（取り込み済みカードと履歴）
//   2. exchange/outbox-hayachan/ のカードの id を「自分のカード」として把握する
//   3. exchange/inbox/<チーム名>/ の .json を再帰的に読む（カード1枚／パック形式のどちらも可。ファイル名順に処理）
//   4. 検証（site/assets/validator.js）を通ったカードのうち、まだ持っていない id だけ collected.json に追加する
//   5. 追加またはエラーがあったファイルだけ履歴に記録する（定期実行しても履歴が太らない）
//
// inbox のファイルは削除しない。取り込み済みの id は毎回スキップされるので、
// 同じファイルが残っていても何度実行しても安全（冪等）。
//
// 終了コード: エラー0なら 0、エラーがあれば 1（--dry-run でも同じ）。
// 外部パッケージ不要。Node.js 20 以上。

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseImport, validateCard } from '../site/assets/validator.js';

export const COLLECTED_FORMAT = 'muse-surechigai-collected';
export const COLLECTED_VERSION = 1;
export const OUTBOX_NAME = 'outbox-hayachan';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
export const EXCHANGE_DIR = join(appRoot, 'exchange');
export const INBOX_DIR = join(EXCHANGE_DIR, 'inbox');
export const OUTBOX_DIR = join(EXCHANGE_DIR, OUTBOX_NAME);
export const COLLECTED_PATH = join(EXCHANGE_DIR, 'collected.json');

/** collected.json の初期構造を作る */
export function emptyCollected(updatedAt = new Date().toISOString()) {
  return {
    format: COLLECTED_FORMAT,
    collectedVersion: COLLECTED_VERSION,
    updatedAt,
    cards: [],
    history: []
  };
}

/**
 * collected.json の中身を検証して読む。
 * 所持カード自体も再検証する（手で編集して壊れていたら気づけるように）。
 * @param {string} raw - ファイルの中身
 * @returns {{ ok: true, collected: object } | { ok: false, errors: string[] }}
 */
export function loadCollected(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`collected.json を JSON として読めません: ${e.message}`] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['collected.json はオブジェクトである必要があります'] };
  }

  const errors = [];
  if (value.format !== COLLECTED_FORMAT) {
    errors.push(
      `collected.json: format は "${COLLECTED_FORMAT}" にしてください（受け取った値: ${JSON.stringify(value.format)}）`
    );
  }
  if (value.collectedVersion !== COLLECTED_VERSION) {
    errors.push(
      `collected.json: collectedVersion は ${COLLECTED_VERSION} にしてください（受け取った値: ${JSON.stringify(value.collectedVersion)}）`
    );
  }
  if (!Array.isArray(value.cards)) errors.push('collected.json: cards は配列にしてください');
  if (!Array.isArray(value.history)) errors.push('collected.json: history は配列にしてください');
  if (errors.length > 0) return { ok: false, errors };

  const seenIds = new Map();
  value.cards.forEach((card, i) => {
    const r = validateCard(card, { label: `cards[${i}]` });
    if (!r.ok) errors.push(...r.errors);
    if (card !== null && typeof card === 'object' && typeof card.id === 'string') {
      if (seenIds.has(card.id)) {
        errors.push(`collected.json: cards の id が重複しています（${card.id}）`);
      } else {
        seenIds.set(card.id, i);
      }
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, collected: value };
}

/**
 * ディレクトリを再帰的に走査し、.json ファイルの相対パス一覧を返す。
 * 隠しファイル（. で始まる名前）は除外。パス区切りは「/」に揃え、名前順（決定的な処理順）。
 * ディレクトリが無い場合は空配列。
 * @param {string} dir
 * @returns {string[]}
 */
export function listJsonFiles(dir) {
  const out = [];
  walk(dir, '');
  return out;

  function walk(dirAbs, relPrefix) {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return; // フォルダが無い・読めない場合は「何も無い」として扱う
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relPrefix === '' ? e.name : `${relPrefix}/${e.name}`;
      if (e.isDirectory()) {
        walk(join(dirAbs, e.name), rel);
      } else if (e.isFile() && e.name.endsWith('.json')) {
        out.push(rel);
      }
    }
  }
}

/**
 * outbox（はやちゃん自身の公開カード）を読み、カード id の集合と警告を返す。
 * outbox は自分で管理するデータなので、不正があっても止めず警告に留める。
 * @param {string} dir
 * @param {Date} now
 * @returns {{ ids: Set<string>, warnings: string[], fileCount: number, cardCount: number }}
 */
export function readOutbox(dir, now = new Date()) {
  const warnings = [];
  const ids = new Set();
  let fileCount = 0;
  let cardCount = 0;

  for (const rel of listJsonFiles(dir)) {
    fileCount += 1;
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, rel.split('/').join(sep)), 'utf8'));
    } catch (e) {
      warnings.push(`${OUTBOX_NAME}/${rel}: JSONを読めません（${e.message}）`);
      continue;
    }
    const r = parseImport(value, { now });
    if (!r.ok) {
      warnings.push(`${OUTBOX_NAME}/${rel}: カードとして正しくないファイルです（${r.errors[0]}）`);
      continue;
    }
    for (const card of r.cards) ids.add(card.id);
    cardCount += r.cards.length;
    // 1枚1ファイルのルール用のチェック（パック・配列は対象外）
    if (!Array.isArray(value) && !('format' in value) && r.cards.length === 1) {
      const expected = `${r.cards[0].id}.json`;
      const base = rel.split('/').pop();
      if (base !== expected) {
        warnings.push(
          `${OUTBOX_NAME}/${rel}: 1枚1ファイルのルールではファイル名は「<カードのid>.json」にします（期待: ${expected}）`
        );
      }
    }
  }
  return { ids, warnings, fileCount, cardCount };
}

/**
 * inbox のカードを集めて、collected.json に反映する次の状態を作る。
 * 引数の collected は変更しない（純粋関数）。ファイルの書き込みは writeCollected が担当。
 * @param {{ collected: object, inboxDir?: string, outboxDir?: string, now?: Date }} args
 * @returns {{ collected: object, report: object }}
 */
export function importFromInbox({ collected, inboxDir = INBOX_DIR, outboxDir = OUTBOX_DIR, now = new Date() }) {
  const outbox = readOutbox(outboxDir, now);
  const report = {
    outboxCardCount: outbox.cardCount,
    outboxWarnings: outbox.warnings,
    inboxMissing: !existsSync(inboxDir),
    files: [],
    addedCount: 0,
    skippedCount: 0,
    errorFileCount: 0
  };

  const next = { ...collected, cards: [...collected.cards], history: [...collected.history] };
  const known = new Map(); // id → 取り元ラベル
  for (const card of collected.cards) known.set(card.id, 'すでに取り込みずみ');

  for (const rel of listJsonFiles(inboxDir)) {
    const from = rel.includes('/') ? rel.split('/')[0] : 'inbox直下';
    const entry = { file: rel, from, addedIds: [], skipped: [], errors: [], warnings: [] };

    if (!rel.includes('/')) {
      entry.warnings.push('カードは相手ごとのサブフォルダ（inbox/<チーム名>/）に置くのがルールです');
    }

    let value;
    try {
      value = JSON.parse(readFileSync(join(inboxDir, rel.split('/').join(sep)), 'utf8'));
    } catch (e) {
      entry.errors.push(`JSONを読めません: ${e.message}`);
      report.files.push(entry);
      continue;
    }

    const r = parseImport(value, { now });
    entry.warnings.push(...r.warnings.map((w) => `読み込み: ${w}`));
    if (!r.ok) {
      entry.errors.push(...r.errors);
      report.files.push(entry);
      continue;
    }

    for (const card of r.cards) {
      const id = card.id;
      if (known.has(id)) {
        entry.skipped.push({
          id,
          reason:
            known.get(id) === 'すでに取り込みずみ'
              ? 'すでに取り込みずみ'
              : '今回の実行で別のファイルから取り込み済み'
        });
        continue;
      }
      if (outbox.ids.has(id)) {
        entry.skipped.push({ id, reason: `自分のカード（${OUTBOX_NAME}）と同じ id` });
        continue;
      }
      known.set(id, '今回の実行で追加');
      next.cards.push(card);
      entry.addedIds.push(id);
      if (from !== 'inbox直下' && !id.startsWith(`${from}-`)) {
        entry.warnings.push(`id は「${from}-」で始めると重複しにくいです（現在: ${id}）`);
      }
    }
    report.files.push(entry);
  }

  // 履歴には「追加またはエラーがあったファイル」だけ記録する
  const at = now.toISOString();
  for (const entry of report.files) {
    if (entry.addedIds.length > 0 || entry.errors.length > 0) {
      next.history.push({
        at,
        file: entry.file,
        from: entry.from,
        addedIds: entry.addedIds,
        skippedIds: entry.skipped,
        errors: entry.errors
      });
    }
  }
  next.updatedAt = at;

  for (const entry of report.files) {
    report.addedCount += entry.addedIds.length;
    report.skippedCount += entry.skipped.length;
    if (entry.errors.length > 0) report.errorFileCount += 1;
  }
  return { collected: next, report };
}

/** collected.json を書き込む（2スペースインデント＋末尾改行。他のデータファイルと同じ体裁） */
export function writeCollected(path, collected) {
  writeFileSync(path, `${JSON.stringify(collected, null, 2)}\n`, 'utf8');
}

function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  console.log('muse-surechigai 自動交換の取り込み');
  console.log(
    `対象: ${relative(appRoot, INBOX_DIR)} → ${relative(appRoot, COLLECTED_PATH)}${dryRun ? '（--dry-run: 反映しない）' : ''}`
  );
  console.log('');

  let loaded;
  try {
    loaded = loadCollected(readFileSync(COLLECTED_PATH, 'utf8'));
  } catch (e) {
    console.log(`✖ collected.json が読めません: ${e.message}`);
    console.log('  exchange/collected.json が無い場合は、exchange/README.md の形式で作成してください');
    process.exit(1);
  }
  if (!loaded.ok) {
    console.log('✖ collected.json の内容に問題があります:');
    for (const e of loaded.errors) console.log(`  ✖ ${e}`);
    process.exit(1);
  }

  const { collected, report } = importFromInbox({ collected: loaded.collected });

  console.log(
    `${OUTBOX_NAME} のカード: ${report.outboxCardCount}枚（自分のカードの id として扱う）${report.outboxWarnings.length > 0 ? `・警告${report.outboxWarnings.length}件` : ''}`
  );
  for (const w of report.outboxWarnings) console.log(`  ⚠ ${w}`);
  if (report.inboxMissing) {
    console.log('inbox フォルダがまだありません。相手のMuseが参加すると作られます');
  }
  if (report.files.length === 0 && !report.inboxMissing) {
    console.log('inbox に .json ファイルはありませんでした');
  }
  console.log('');

  for (const f of report.files) {
    console.log(`[inbox/${f.file}]（from: ${f.from}）`);
    if (f.addedIds.length > 0) console.log(`  ✔ 新しく取り込むカード ${f.addedIds.length}件: ${f.addedIds.join('・')}`);
    for (const s of f.skipped) console.log(`  ・スキップ: ${s.id}（${s.reason}）`);
    for (const w of f.warnings) console.log(`  ⚠ ${w}`);
    for (const e of f.errors) console.log(`  ✖ ${e}`);
    console.log('');
  }

  console.log('―'.repeat(56));
  console.log(
    `結果: ファイル${report.files.length}件・取り込むカード${report.addedCount}件（スキップ${report.skippedCount}件・エラーファイル${report.errorFileCount}件）`
  );

  if (dryRun) {
    console.log(`→ --dry-run のため反映していません（反映後の所持カード: ${collected.cards.length}枚）`);
  } else {
    writeCollected(COLLECTED_PATH, collected);
    console.log(
      `→ collected.json に反映しました（所持カード ${collected.cards.length}枚・履歴 ${collected.history.length}件）`
    );
  }
  process.exit(report.errorFileCount > 0 ? 1 : 0);
}

// npm test から import されたときは main を実行しない
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
