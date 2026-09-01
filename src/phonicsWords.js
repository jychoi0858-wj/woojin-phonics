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
