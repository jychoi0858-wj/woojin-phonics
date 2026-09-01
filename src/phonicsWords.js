// ============================================================
// 소리마다 직접 추가한 연습 단어 (기기에 저장)
//   { [soundId]: ['lamb', 'ball', ...] }
//   기본 예시·등록 단어로 부족할 때 부모가 채워 넣는 용도
// ============================================================
const KEY = 'woojin-phonics-words';

const clean = (w) => (w || '').toLowerCase().trim().replace(/[^a-z' -]/g, '');

export function loadCustomWords() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch (e) { return {}; }
}

function save(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
}

/** 서버에서 받아 온 단어로 통째로 교체 (계정 동기화용) */
export function replaceCustomWords(all) {
  save(all || {});
}

/** 두 목록을 합침 — 양쪽 단어를 모두 남긴다 */
export function mergeCustomWords(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const list = [...(Array.isArray(a[id]) ? a[id] : []), ...(Array.isArray(b[id]) ? b[id] : [])];
    out[id] = [...new Set(list)].slice(0, 30);
  }
  return out;
}

export function customWordsOf(soundId) {
  const all = loadCustomWords();
  return Array.isArray(all[soundId]) ? all[soundId] : [];
}

/** 단어 추가 — 이미 있으면 그대로 둠. 저장된 목록을 돌려줌 */
export function addCustomWord(soundId, word) {
  const w = clean(word);
  if (!w || w.length < 2) return customWordsOf(soundId);
  const all = loadCustomWords();
  const list = Array.isArray(all[soundId]) ? all[soundId] : [];
  if (!list.includes(w)) list.push(w);
  all[soundId] = list.slice(0, 30);
  save(all);
  return all[soundId];
}

export function removeCustomWord(soundId, word) {
  const w = clean(word);
  const all = loadCustomWords();
  const list = (Array.isArray(all[soundId]) ? all[soundId] : []).filter(x => x !== w);
  all[soundId] = list;
  save(all);
  return list;
}
