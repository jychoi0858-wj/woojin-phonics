// ============================================================
// 세트학습 진도 저장 — 중간에 나가도 이어서 할 수 있게
//   기기 저장(localStorage)을 쓰되, 로그인하면 계정(Firestore)과 맞춘다.
//   하루가 지난 진도는 처음부터 다시 한다.
// ============================================================
import { saveSetProgressToFirestore, loadSetProgressFromFirestore } from './firebase';

const KEY = 'woojin-setprog';                    // 전체를 한 덩어리로 보관
const OLD_PREFIX = 'woojin-setprog-';            // 예전 방식 (진도마다 따로 저장)
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const idOf = (type, id) => `${type}-${id || 'none'}`;

// ─── 기기 저장 ───
function loadAll() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { all = {}; }

  // 예전 방식으로 저장돼 있던 진도를 한 번 옮겨 온다
  try {
    const olds = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD_PREFIX)) olds.push(k);
    }
    if (olds.length) {
      for (const k of olds) {
        try {
          const d = JSON.parse(localStorage.getItem(k) || 'null');
          const name = k.slice(OLD_PREFIX.length);
          if (d && typeof d.idx === 'number' && !all[name]) all[name] = d;
        } catch (e) { /* ignore */ }
        localStorage.removeItem(k);
      }
      saveAll(all);
    }
  } catch (e) { /* ignore */ }
  return all;
}

function saveAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
}

// ─── 계정 동기화 ───
let currentUid = null;
let pushTimer = null;

/** 오래된 진도는 버림 */
function prune(all) {
  const now = Date.now();
  const out = {};
  for (const [k, v] of Object.entries(all || {})) {
    if (v && typeof v.idx === 'number' && now - (v.at || 0) <= MAX_AGE_MS) out[k] = v;
  }
  return out;
}

/** 두 진도를 합침 — 더 최근에 저장된 쪽을 남긴다 */
function merge(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || (v.at || 0) > (out[k].at || 0)) out[k] = v;
  }
  return out;
}

/** 로그인 직후 한 번 */
export async function pullSetProgress(uid) {
  currentUid = uid || null;
  if (!currentUid) return;
  const remote = await loadSetProgressFromFirestore(currentUid);
  if (!remote) return;                        // 조회 실패 — 기기 내용 유지
  const merged = prune(merge(loadAll(), remote));
  saveAll(merged);
  if (JSON.stringify(merged) !== JSON.stringify(remote)) {
    await saveSetProgressToFirestore(currentUid, merged);
  }
}

function push() {
  if (!currentUid) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    saveSetProgressToFirestore(currentUid, prune(loadAll()));
  }, 900);
}

export function clearSetProgressUser() {
  currentUid = null;
  clearTimeout(pushTimer);
}

// ─── 화면에서 쓰는 함수 ───
export function saveSetProgress(type, id, data) {
  if (!id) return;
  const all = loadAll();
  all[idOf(type, id)] = { ...data, at: Date.now() };
  saveAll(all);
  push();
}

/** 저장된 진도 반환 (없거나 오래됐으면 null) */
export function loadSetProgress(type, id) {
  if (!id) return null;
  const all = loadAll();
  const d = all[idOf(type, id)];
  if (!d || typeof d.idx !== 'number') return null;
  if (Date.now() - (d.at || 0) > MAX_AGE_MS) { clearSetProgress(type, id); return null; }
  if (d.idx <= 0 && (d.stage || 0) <= 0) return null;   // 시작 지점이면 저장 의미 없음
  return d;
}

export function clearSetProgress(type, id) {
  if (!id) return;
  const all = loadAll();
  delete all[idOf(type, id)];
  saveAll(all);
  push();
}
