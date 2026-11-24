import { AREAS } from './areas.js';

/**
 * 外部の検索サイトへのリンクを作る（依存ライブラリなし。ブラウザと Node の両方で動く）。
 *
 * リンクには3種類ある。
 * - verified : 検索条件（日付・人数）がURLで引き継がれることを、実際にページを開いて確かめた
 * - unverified: URLに検索条件を入れるが、引き継がれるかどうかは確かめられていない
 * - manual   : 条件をURLで渡せないので、サイト内で日付・人数を入力してもらう
 */
const HTTPS_URL = /^https:\/\/[^\s<>"']+$/;

/**
 * sources.json の内容を検証して整える。形式がおかしい項目は無視する（リンク切れのボタンを出さないため）。
 */
export function normalizeSources(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.sources) ? raw.sources : [];
  return list
    .filter((source) => source && typeof source === 'object' && !Array.isArray(source))
    .map((source) => {
      const areaQueries =
        source.areaQueries && typeof source.areaQueries === 'object' && !Array.isArray(source.areaQueries)
          ? Object.fromEntries(Object.entries(source.areaQueries).filter(([, q]) => typeof q === 'string' && q.trim() !== ''))
          : null;
      return {
        id: typeof source.id === 'string' ? source.id : '',
        label: typeof source.label === 'string' ? source.label : '',
        homeUrl: typeof source.homeUrl === 'string' && HTTPS_URL.test(source.homeUrl) ? source.homeUrl : '',
        areaIds: Array.isArray(source.areaIds) ? source.areaIds.filter((a) => typeof a === 'string') : [],
        searchUrlStatus: source.searchUrlStatus === 'verified' ? 'verified' : 'unverified',
        searchUrlTemplate:
          typeof source.searchUrlTemplate === 'string' && source.searchUrlTemplate !== '' ? source.searchUrlTemplate : null,
        areaQueries: areaQueries && Object.keys(areaQueries).length > 0 ? areaQueries : null,
        note: typeof source.note === 'string' ? source.note : '',
      };
    })
    .filter((source) => source.id !== '' && source.label !== '' && source.homeUrl !== '');
}

/**
 * 選ばれたエリアに関係する外部サイトのリンク一覧を作る。
 * areaQueries（エリアごとの検索語）を持つサイトは、選ばれたエリアごとに1つのリンクを作る。
 * 各項目は { id, sourceId, label, areaId, url, mode, carriesConditions, note }。
 */
export function buildSearchLinks(sources, cond) {
  const selected = cond.areaIds;
  const links = [];
  for (const source of sources) {
    const scoped = selected.filter((id) => source.areaIds.length === 0 || source.areaIds.includes(id));
    if (scoped.length === 0) continue;

    const withQuery = source.areaQueries ? scoped.filter((id) => typeof source.areaQueries[id] === 'string') : [];
    if (withQuery.length > 0) {
      for (const areaId of withQuery) {
        links.push(makeLink(source, cond, { areaId, q: source.areaQueries[areaId] }));
      }
    } else {
      links.push(makeLink(source, cond, {}));
    }
  }
  return links;
}

function makeLink(source, cond, { areaId, q }) {
  const searchUrl = buildSearchUrl(source, cond, q);
  let mode = 'manual';
  if (searchUrl) mode = source.searchUrlStatus === 'verified' ? 'verified' : 'unverified';
  const areaLabel = areaId ? areaName(areaId) : '';
  return {
    id: areaId ? `${source.id}:${areaId}` : source.id,
    sourceId: source.id,
    label: areaLabel ? `${source.label}（${areaLabel}）` : source.label,
    areaId: areaId || '',
    url: searchUrl || source.homeUrl,
    mode,
    carriesConditions: mode !== 'manual',
    note: source.note,
  };
}

function areaName(areaId) {
  const area = AREAS.find((a) => a.id === areaId);
  return area ? area.label : areaId;
}

/** searchUrlTemplate の {checkin} などの部分を検索条件で置き換える。作れない場合は null */
function buildSearchUrl(source, cond, q) {
  if (!source.searchUrlTemplate) return null;
  const values = {
    checkin: cond.checkin,
    checkout: cond.checkout,
    adults: String(cond.adults),
    rooms: String(cond.rooms),
  };
  if (typeof q === 'string' && q !== '') values.q = q;
  try {
    const url = source.searchUrlTemplate.replace(/\{(\w+)\}/g, (whole, key) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        throw new RangeError(`searchUrlTemplate に不明な部分があります: ${whole}`);
      }
      return encodeURIComponent(values[key]);
    });
    return HTTPS_URL.test(url) ? url : null;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}
