// ============================================================
// 파닉스 진도 (기기에 저장)
//   { [soundId]: { stars: 0~3, tries: n, best: 0~100 } }
// ============================================================
import { STAGES } from './phonicsData';

const KEY = 'woojin-phonics-prog';

export function loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch (e) { return {}; }
}

function save(prog) {
  try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch (e) { /* ignore */ }
}

/** 정답률(0~100)로 별을 매김 — 한 번 딴 별은 내려가지 않음 */
export function recordSound(soundId, percent) {
  const prog = loadProgress();
  const cur = prog[soundId] || { stars: 0, tries: 0, best: 0 };
  const stars = percent >= 90 ? 3 : percent >= 70 ? 2 : percent >= 40 ? 1 : 0;
  prog[soundId] = {
    stars: Math.max(cur.stars, stars),
    tries: cur.tries + 1,
    best: Math.max(cur.best, Math.round(percent)),
  };
  save(prog);
  return prog[soundId];
}

export function starsOf(prog, soundId) {
  return (prog[soundId] && prog[soundId].stars) || 0;
}

/** 모든 단계를 언제든 고를 수 있음 (잠금 없음) */
export function isStageOpen() {
  return true;
}

/** 단계 진행률 (0~1) */
export function stageRatio(prog, stage) {
  if (!stage.sounds.length) return 0;
  const done = stage.sounds.filter(id => starsOf(prog, id) > 0).length;
  return done / stage.sounds.length;
}

/** 아직 별이 없는 소리 중 가장 앞에 있는 것 (이어서 하기) */
export function nextSound(prog) {
  for (const stage of STAGES) {
    const found = stage.sounds.find(id => starsOf(prog, id) === 0);
    if (found) return { stageId: stage.id, soundId: found };
  }
  return null;
}

export function resetProgress() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
