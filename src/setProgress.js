// ============================================================
// 세트학습 진도 저장 — 중간에 나가도 이어서 할 수 있게
//   저장 위치: localStorage (기기별). 하루가 지나면 무효 처리
// ============================================================
const PREFIX = 'woojin-setprog';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 하루 지나면 처음부터

function key(type, id) {
  return `${PREFIX}-${type}-${id || 'none'}`;
}

export function saveSetProgress(type, id, data) {
  if (!id) return;
  try {
    localStorage.setItem(key(type, id), JSON.stringify({ ...data, at: Date.now() }));
  } catch (e) { /* ignore */ }
}

// 저장된 진도 반환 (없거나 오래됐으면 null)
export function loadSetProgress(type, id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(key(type, id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.idx !== 'number') return null;
    if (Date.now() - (d.at || 0) > MAX_AGE_MS) { clearSetProgress(type, id); return null; }
    if (d.idx <= 0 && (d.stage || 0) <= 0) return null; // 시작 지점이면 저장 의미 없음
    return d;
  } catch (e) { return null; }
}

export function clearSetProgress(type, id) {
  if (!id) return;
  try { localStorage.removeItem(key(type, id)); } catch (e) { /* ignore */ }
}
