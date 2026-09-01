// ============================================================
// 패치 노트
//   맨 위가 최신. version을 새로 올리면 첫 화면에 한 번 표시됨.
//   "다시 보지 않기"를 누르면 그 버전은 다시 안 뜸.
// ============================================================
export const PATCH_NOTES = [
  {
    version: '2026-09-01-2',
    title: '파닉스 학습이 생겼어요',
    items: [
      { icon: '🔤', text: '위쪽 [🔤 파닉스]에서 글자가 내는 소리를 배워요. 7단계 54개 소리 중 아무거나 골라 할 수 있어요.' },
      { icon: '🔗', text: 'c · a · t 조각 소리가 점점 빨라지다 cat으로 합쳐져요. 따라 읽고 마이크로 채점받을 수 있어요.' },
      { icon: '👂', text: '소리만 듣고 단어를 고르는 연습이 있어요. 글자를 보기 전에 귀로 먼저 익혀요.' },
      { icon: '👆', text: '단어에서 그 소리를 내는 글자를 직접 짚어 봐요.' },
      { icon: '🎧', text: 'l처럼 혼자 낼 때와 단어 속에서 다르게 들리는 소리는 따로 설명해 줘요.' },
      { icon: '💬', text: '이어 읽기에서 조각마다 설명이 붙어요. lamb의 b가 왜 조용한지, ball의 a가 왜 "오-"인지 알려 줘요.' },
      { icon: '➕', text: '소리마다 연습 단어를 직접 넣을 수 있어요. 넣기 전에 소리 조각을 미리 보여 주고, 쪼갤 수 없는 단어는 이유를 알려 줘요.' },
      { icon: '💛', text: 'eye, said, because처럼 규칙으로 읽히지 않는 단어는 파닉스 연습에서 빼고 "통째로 외우는 단어"로 알려 줘요.' },
      { icon: '☁️', text: '파닉스 진도와 직접 넣은 단어가 계정에 저장돼요. 다른 기기에서도 이어서 할 수 있어요.' },
      { icon: '⏹️', text: '소리와 화면 강조, 버튼이 풀리는 시점을 실제 스피커 소리에 맞췄어요.' },
    ],
  },
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
