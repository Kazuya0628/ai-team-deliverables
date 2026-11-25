#!/usr/bin/env node
// データ検証スクリプト。
//
//   node tools/validate-data.js
//     site/data/my-cards.json と site/data/samples.json を検証する（既定）
//
//   node tools/validate-data.js ファイル.json [ファイル2.json ...]
//     指定したファイル（すれ違いで受け取ったパックなど）を検証する
//
//   --strict を付けると警告でも終了コード1になる
//
// 終了コード: エラー0なら 0、エラー（または --strict で警告）があれば 1。
// 外部パッケージ不要。Node.js 20 以上。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseImport,
  validatePack,
  LIMITS
} from '../site/assets/validator.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILES = ['../site/data/my-cards.json', '../site/data/samples.json'].map((p) =>
  resolve(here, p)
);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targetFiles = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a));
const files = targetFiles.length > 0 ? targetFiles : DEFAULT_FILES;
const isDefaultTargets = targetFiles.length === 0;

let totalErrors = 0;
let totalWarnings = 0;
let totalCards = 0;
const fileSummaries = [];
const idsByFile = new Map(); // 既定の2ファイル間の id 重複チェック用

console.log('muse-surechigai データ検証');
console.log(`対象: ${files.map((f) => relative(f)).join(', ')}`);
console.log('');

for (const file of files) {
  const errors = [];
  const warnings = [];
  let cards = 0;
  let sample = false;
  let ids = [];

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(`ファイルが読めません: ${e.message}`);
    console.log(`[${relative(file)}]`);
    printBody(errors, warnings, cards, sample);
    totalErrors += errors.length;
    totalWarnings += warnings.length;
    fileSummaries.push({ file, errors: errors.length, warnings: warnings.length });
    continue;
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    errors.push(`JSONとして読めません: ${e.message}`);
    console.log(`[${relative(file)}]`);
    printBody(errors, warnings, cards, sample);
    totalErrors += errors.length;
    totalWarnings += warnings.length;
    fileSummaries.push({ file, errors: errors.length, warnings: warnings.length });
    continue;
  }

  // サイトのデータファイルはカードパックの形が前提。受け取ったファイルは
  // パック以外（カードの配列・カード1枚）でも読み込める形で検証する
  const isPack = value !== null && typeof value === 'object' && !Array.isArray(value) && 'format' in value;
  const result = isPack
    ? validatePack(value)
    : parseImport(value);

  errors.push(...result.errors);
  warnings.push(...result.warnings);
  cards = result.cards.length;
  sample = result.sample === true;
  ids = result.cards.map((c) => (typeof c.id === 'string' ? c.id : '(idなし)'));

  if (isDefaultTargets) {
    // 既定の2ファイルだけに効く追加チェック
    const name = relative(file);
    if (name === 'data/samples.json' && !sample) {
      errors.push('samples.json はサンプルパックなので、sample: true が必要です');
    }
    if (name === 'data/my-cards.json' && sample) {
      errors.push('my-cards.json は実データなので sample: true にできません');
    }
    if (name === 'data/samples.json') {
      for (const c of result.cards) {
        if (!String(c.id).startsWith('sample-')) {
          warnings.push(`cards: サンプルカードの id は sample- で始めるのがルールです（${c.id}）`);
        }
      }
    }
    idsByFile.set(name, ids);
  }

  totalCards += cards;
  totalErrors += errors.length;
  totalWarnings += warnings.length;
  fileSummaries.push({ file, errors: errors.length, warnings: warnings.length });

  console.log(`[${relative(file)}]`);
  printBody(errors, warnings, cards, sample);
}

// 既定の2ファイル間で同じ id が使われていたらエラー（プラザで区別できなくなるため）
if (isDefaultTargets && idsByFile.size === 2) {
  const [nameA, idsA] = [...idsByFile.entries()][0];
  const [nameB, idsB] = [...idsByFile.entries()][1];
  const dup = idsA.filter((id) => idsB.includes(id));
  if (dup.length > 0) {
    totalErrors += 1;
    console.log(`[ファイル間のチェック]`);
    console.log(`  ✖ id が両方のファイルに重複しています: ${dup.join('、')}（${nameA} と ${nameB}）`);
    console.log('');
  }
}

const limitNote = `カードは1ファイル${LIMITS.packCards}件まで・パック形式（format: muse-surechigai-pack）が基本`;

console.log('―'.repeat(56));
console.log(
  `結果: ${fileSummaries.length}ファイル・${totalCards}カード。エラー${totalErrors}件・警告${totalWarnings}件`
);
console.log(limitNote);

if (totalErrors > 0) {
  console.log('→ エラーがあります。修正してください');
  process.exit(1);
}
if (strict && totalWarnings > 0) {
  console.log('→ --strict モード: 警告もあるため失敗にします');
  process.exit(1);
}
console.log('→ 問題なし');
process.exit(0);

function printBody(errors, warnings, cards, sample) {
  console.log(`  カード ${cards}件・${sample ? 'サンプルパック' : '通常パック'}`);
  for (const e of errors) console.log(`  ✖ ${e}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length === 0 && warnings.length === 0) console.log('  ✔ 問題なし');
  console.log('');
}

function relative(file) {
  // 表示用: 末尾2階層（例: data/my-cards.json）
  const parts = file.split('/');
  return parts.slice(-2).join('/');
}
