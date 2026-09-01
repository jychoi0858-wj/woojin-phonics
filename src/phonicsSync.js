// ============================================================
// 파닉스 학습 계정 동기화
//   기기 저장(localStorage)을 그대로 쓰되, 로그인하면 Firestore와 맞춘다.
//   - 로그인 시: 서버 것과 기기 것을 합쳐서 양쪽에 저장 (어느 쪽도 잃지 않음)
//   - 학습·단어 변경 시: 잠깐 모아서 서버에 올림
//   서버 연결이 안 되면 기기 저장으로 계속 동작한다.
// ============================================================
import { loadProgress, replaceProgress, mergeProgress } from './phonicsProgress';
import { loadCustomWords, replaceCustomWords, mergeCustomWords } from './phonicsWords';
import { savePhonicsToFirestore, loadPhonicsFromFirestore } from './firebase';

let currentUid = null;
let pushTimer = null;
const listeners = new Set();

/** 동기화가 끝나 화면을 새로 그려야 할 때 알림 */
export function subscribePhonicsSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
}

/** 로그인 직후 한 번 — 서버와 기기 내용을 합침 */
export async function pullPhonics(uid) {
  currentUid = uid || null;
  if (!currentUid) return;

  const remote = await loadPhonicsFromFirestore(currentUid);
  if (!remote) return;                     // 조회 실패 — 기기 내용을 건드리지 않음

  const localProg = loadProgress();
  const localWords = loadCustomWords();
  const mergedProg = mergeProgress(localProg, remote.progress);
  const mergedWords = mergeCustomWords(localWords, remote.words);

  replaceProgress(mergedProg);
  replaceCustomWords(mergedWords);
  notify();

  // 기기에만 있던 내용이 있으면 서버에도 올려 둔다
  const changed = JSON.stringify(mergedProg) !== JSON.stringify(remote.progress)
    || JSON.stringify(mergedWords) !== JSON.stringify(remote.words);
  if (changed) await savePhonicsToFirestore(currentUid, { progress: mergedProg, words: mergedWords });
}

/** 학습·단어가 바뀔 때 호출 (연달아 불려도 한 번만 올라감) */
export function pushPhonics() {
  if (!currentUid) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    savePhonicsToFirestore(currentUid, { progress: loadProgress(), words: loadCustomWords() });
  }, 700);
}

/** 로그아웃 */
export function clearPhonicsUser() {
  currentUid = null;
  clearTimeout(pushTimer);
}
