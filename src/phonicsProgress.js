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

/**
 * 단계가 열려 있는가
 *   1단계는 항상 열림. 그다음부터는 앞 단계 소리의 절반 이상에서 별을 받아야 열림.
 */
export function isStageOpen(prog, stageId) {
  if (stageId <= 1) return true;
  const prev = STAGES.find(s => s.id === stageId - 1);
  if (!prev) return true;
  const done = prev.sounds.filter(id => starsOf(prog, id) > 0).length;
  return done >= Math.ceil(prev.sounds.length / 2);
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
    if (!isStageOpen(prog, stage.id)) return null;
    const found = stage.sounds.find(id => starsOf(prog, id) === 0);
    if (found) return { stageId: stage.id, soundId: found };
  }
  return null;
}

export function resetProgress() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
