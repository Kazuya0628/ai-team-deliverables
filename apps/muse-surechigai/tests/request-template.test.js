// 「相手のMuseへの依頼文テンプレート」周りのテスト（v0.2.1で追加）。
//
//  - site/data/request-template.json が exchange/README.md の確定文面と1文字も違わないこと。
//    （exchange/README.md が文面の正。サイトの「相手のMuseを誘う」導線との二重管理で
//    文面がずれないための検証）
//  - 「LINEで送る」の共有リンク（https://line.me/R/msg/text/?<URLエンコードした文面>）の
//    URLエンコードが正しいこと（改行・日本語・記号・文中のURLが壊れないこと）。
//    サイト側は encodeURIComponent で作るので、ここでは同じ変換で往復を確かめる
//  - 文面がサイトのJSにハードコードされていないこと（一元管理の担保）
//
// 実行: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const invite = JSON.parse(readFileSync(join(appRoot, 'site', 'data', 'request-template.json'), 'utf8'));
const exchangeReadme = readFileSync(join(appRoot, 'exchange', 'README.md'), 'utf8');

// exchange/README.md の「## 相手のMuseへの依頼文テンプレート」セクションにある
// ```text フェンスの内容を取り出す（依頼文の正）
function templateFromExchangeReadme() {
  const heading = exchangeReadme.indexOf('## 相手のMuseへの依頼文テンプレート');
  assert.notEqual(heading, -1, 'exchange/README.md に依頼文テンプレートの見出しがありません');
  const fence = exchangeReadme.indexOf('```text', heading);
  assert.notEqual(fence, -1, '依頼文の ```text ブロックが見つかりません');
  const start = exchangeReadme.indexOf('\n', fence) + 1;
  const end = exchangeReadme.indexOf('\n```', start);
  assert.notEqual(end, -1, '依頼文の ```text ブロックが閉じていません');
  return exchangeReadme.slice(start, end);
}

const text = invite.lines.join('\n');
const lineUrl = invite.lineSharePrefix + encodeURIComponent(text);

test('request-template.json: 形式が正しい', () => {
  assert.equal(invite.format, 'muse-surechigai-invite');
  assert.equal(invite.inviteVersion, 1);
  assert.equal(invite.lineSharePrefix, 'https://line.me/R/msg/text/?');
  assert.ok(Array.isArray(invite.lines), 'lines は配列');
  assert.ok(invite.lines.length > 0, 'lines が空');
  for (const line of invite.lines) {
    assert.equal(typeof line, 'string', 'lines の各要素は文字列');
  }
});

test('文面は exchange/README.md の確定テンプレートと1文字も違わない（二重管理のずれ検知）', () => {
  assert.equal(text, templateFromExchangeReadme());
});

test('文面の先頭は「【お願い】…」で始まり、末尾は「…大歓迎です。」で終わる', () => {
  assert.ok(text.startsWith('【お願い】Museすれ違い（muse-surechigai）の自動交換に参加してください\n'));
  assert.ok(text.endsWith('よろしくお願いします。まずは1枚だけでも大歓迎です。'));
});

test('文面にトークンらしき長い英数字列が含まれていない（簡易チェック）', () => {
  // テンプレートに秘密情報（APIキー等）を書き込んでしまったら気づけるようにするための目印。
  // 正常な文面の最長の英数字連続は artifactName（12字）程度
  assert.doesNotMatch(text, /[A-Za-z0-9]{16,}/);
});

test('文面がサイトのJSにハードコードされていない（data/request-template.json 一元管理）', () => {
  const appJs = readFileSync(join(appRoot, 'site', 'assets', 'app.js'), 'utf8');
  const indexHtml = readFileSync(join(appRoot, 'site', 'index.html'), 'utf8');
  assert.ok(!appJs.includes('【お願い】'), 'app.js に文面を直書きしない（データファイルから読む）');
  assert.ok(!indexHtml.includes('【お願い】'), 'index.html に文面を直書きしない（データファイルから読む）');
});

test('LINEリンク: URLとして正しい形（プレフィックス・origin・パス）', () => {
  assert.ok(lineUrl.startsWith(invite.lineSharePrefix));
  const u = new URL(lineUrl);
  assert.equal(u.origin, 'https://line.me');
  assert.equal(u.pathname, '/R/msg/text/');
});

test('LINEリンク: エンコードの往復で文面が1文字も壊れない（改行・日本語を含む）', () => {
  const encoded = lineUrl.slice(invite.lineSharePrefix.length);
  assert.equal(decodeURIComponent(encoded), text);
});

test('LINEリンク: エンコード結果にURLを壊す生の文字を含まない（空白・改行・& # + ? " < > など）', () => {
  const encoded = lineUrl.slice(invite.lineSharePrefix.length);
  // encodeURIComponent が生で出す文字（A-Za-z0-9 - _ . ~ ! * ' ( )）と %XX だけの並びであること
  assert.match(encoded, /^(?:[A-Za-z0-9\-_.~!*'()]|%[0-9A-F]{2})*$/);
});

test('LINEリンク: 日本語・改行・記号・文中のURLが期待どおりにエンコードされる（スポットチェック）', () => {
  const encoded = lineUrl.slice(invite.lineSharePrefix.length);
  assert.ok(encoded.startsWith('%E3%80%90%E3%81%8A%E9%A1%98%E3%81%84%E3%80%91'), '冒頭は【お願い】のUTF-8パーセントエンコード');
  assert.ok(encoded.includes('%0A'), '改行は %0A');
  assert.ok(encoded.includes('%22'), 'ダブルクォート（format: "muse-surechigai-pack"）は %22');
  assert.ok(encoded.includes('%3C'), '<（inbox/<あなたのチーム名>/）は %3C');
  assert.ok(encoded.includes('https%3A%2F%2F'), '文中の https:// は %3A %2F にエンコードされ、復元すれば壊れない');
});

test('LINEリンク: 全体の長さを記録する（長文共有リンクの実機確認用の情報）', () => {
  // アサーションは極端に長い場合だけ失敗にする（実機の挙動は未確認のため README に制限として記載）
  console.log(`[依頼文テンプレート] 文面 ${text.length}字 → LINEリンク全体 ${lineUrl.length}字`);
  assert.ok(lineUrl.length < 20000, 'LINEリンクが極端に長すぎる');
});
