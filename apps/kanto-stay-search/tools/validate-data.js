/**
 * データファイル（site/data/verified.json・sources.json）を検証する。
 * 画面が使うのと同じ検証ロジック（site/js/core/）を使うので、ここで問題なければ画面にも同じように出る。
 *
 * 使い方（このアプリのフォルダで）: npm run validate
 * 終了コード: 0 = 問題なし／1 = 問題あり、または読み込み失敗
 */
import { readFile } from 'node:fs/promises';

import { defaultConditions } from '../site/js/core/conditions.js';
import { todayJst } from '../site/js/core/dates.js';
import { buildSearchLinks, normalizeSources } from '../site/js/core/links.js';
import { STALE_HOURS, freshness, selectStays, validateDataset } from '../site/js/core/stays.js';

const DATA_DIR = new URL('../site/data/', import.meta.url);
const errors = [];
const warnings = [];

async function readJson(name) {
  try {
    return JSON.parse(await readFile(new URL(name, DATA_DIR), 'utf8'));
  } catch (error) {
    errors.push(`${name} を読み込めません: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const now = new Date();
const today = todayJst(now);
const cond = defaultConditions({ today });

/* ---------- verified.json（確認済みの宿） ---------- */

const verified = await readJson('verified.json');
let entries = [];
if (verified) {
  const result = validateDataset(verified, { now });
  errors.push(...result.problems);
  entries = result.entries;

  if (typeof verified.updatedAt !== 'string' || Number.isNaN(new Date(verified.updatedAt).getTime())) {
    errors.push('verified.json: updatedAt にタイムゾーン付きの日時を書いてください');
  }

  for (const entry of entries) {
    if (entry.conditions.checkin < today) {
      warnings.push(`${entry.id}: チェックイン日（${entry.conditions.checkin}）が過ぎているため画面には出ません`);
    } else if (freshness(entry, now).stale) {
      warnings.push(`${entry.id}: 確認から${STALE_HOURS}時間以上経過（画面では「要再確認」になります）`);
    }
  }

  const shown = selectStays(entries, cond, { today });
  console.log(`verified.json: 登録 ${entries.length}件`);
  console.log(`  既定の条件（${cond.checkin}チェックイン・大人${cond.adults}名・1部屋・1部屋総額${cond.budget}円以内・全エリア）で表示: ${shown.length}件`);
}

/* ---------- sources.json（外部サイトへのリンク） ---------- */

const sources = await readJson('sources.json');
if (sources) {
  const normalized = normalizeSources(sources);
  const raw = Array.isArray(sources) ? sources : sources && Array.isArray(sources.sources) ? sources.sources : [];
  if (normalized.length < raw.length) {
    errors.push(`sources.json: ${raw.length - normalized.length}件を使えません（id・label・https の homeUrl が必要です）`);
  }

  const ids = new Set();
  for (const source of normalized) {
    if (ids.has(source.id)) errors.push(`sources.json: id が重複しています（${source.id}）`);
    ids.add(source.id);
    if (source.searchUrlStatus === 'verified' && !source.searchUrlTemplate) {
      errors.push(`sources.json: ${source.id} は「確認済み」なのに searchUrlTemplate がありません`);
    }
  }

  const links = buildSearchLinks(normalized, cond);
  for (const link of links) {
    const source = normalized.find((item) => item.id === link.sourceId);
    if (source.searchUrlTemplate && link.mode === 'manual') {
      errors.push(`sources.json: ${source.id} の searchUrlTemplate が使えず、トップページへのリンクに戻っています（${link.id}）`);
    }
  }

  console.log(`sources.json: ${normalized.length}サイト`);
  for (const link of links) console.log(`  ${link.mode.padEnd(10)} ${link.label}: ${link.url}`);
}

/* ---------- 結果 ---------- */

for (const warning of warnings) console.warn(`注意: ${warning}`);
if (errors.length === 0) {
  console.log('問題ありません');
} else {
  for (const error of errors) console.error(`NG: ${error}`);
}
process.exitCode = errors.length === 0 ? 0 : 1;
