// ============================================================
// 패치 노트
//   맨 위가 최신. version을 새로 올리면 첫 화면에 한 번 표시됨.
//   "다시 보지 않기"를 누르면 그 버전은 다시 안 뜸.
// ============================================================
export const PATCH_NOTES = [
  {
    version: '2026-09-01',
    title: '파닉스 소리 조각 · 학습 기록',
    items: [
      { icon: '🔤', text: '단어를 펼치면 소리 조각을 보여줘요. flower의 ow처럼 색으로 표시하고, 같은 소리가 나는 다른 단어도 알려줘요.' },
      { icon: '⚠️', text: '어려워한 단어·문장에 표시가 붙어요. 눌러 보면 왜 어려웠는지 알 수 있고, 그것만 모아서 다시 할 수 있어요.' },
      { icon: '🎤', text: '말하기가 침묵으로 끊기지 않아요. 천천히 말해도 괜찮고, 다 말한 뒤 버튼을 누르면 채점해요.' },
      { icon: '💾', text: '세트학습을 하다 나가도 이어서 할 수 있어요.' },
      { icon: '🇰🇷', text: '단어·문장 뜻을 AI가 아이 눈높이로 번역해요. (단어 관리에서 [빈 뜻 자동 채우기])' },
      { icon: '🔁', text: '복습이 지난달 단어까지 찾아봐요. 1·3·7·14·30일 간격으로 복습해요.' },
    ],
  },
];

const KEY = 'woojin-patch-seen';

/** 아직 안 본 최신 패치노트 (없으면 null) */
export function getUnseenNote() {
  const note = PATCH_NOTES[0];
  if (!note) return null;
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (seen.includes(note.version)) return null;
  } catch (e) { /* ignore */ }
  return note;
}

/** 이 버전은 다시 보지 않기 */
export function markNoteSeen(version) {
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!seen.includes(version)) seen.push(version);
    localStorage.setItem(KEY, JSON.stringify(seen.slice(-20)));
  } catch (e) { /* ignore */ }
}

/** 설정에서 다시 보기 (기록 초기화) */
export function resetNotesSeen() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
