// ============================================================
// 학습 기록(약점) 공통 규칙
//   day.wordStats = { word: { ok, ng, streak, lastNgAt } }
//   ok=깔끔하게 성공한 횟수 / ng=헤맨 횟수 / streak=연속 성공
// ============================================================

// 약점 졸업 기준: 연속 3회 깔끔하게 성공해야 '약한 단어'에서 벗어남
// (세트학습 1회에 퀴즈+말하기로 2회가 쌓이므로 최소 두 번의 학습을 거치게 됨)
export const GRADUATE_STREAK = 3;

// 이 통계가 '약한 단어'에 해당하는가
export function isWeakStat(st) {
  return !!(st && st.ng > 0 && (st.streak || 0) < GRADUATE_STREAK);
}

// ─── 어려워한 이유 ───
// 기록할 때 reason 코드를 함께 남기고, 화면에서는 아래 문구로 보여줌
export const REASONS = {
  quizMiss:   '글자를 여러 번 틀렸어요',
  quizHint:   '힌트를 받고 맞혔어요',
  speakRetry: '말하기를 여러 번 다시 했어요',
  speakSkip:  '말하기를 못 하고 넘어갔어요',
  speakLow:   '발음 점수가 기준보다 낮았어요',
  readRetry:  '읽기를 여러 번 다시 했어요',
  readSkip:   '읽기를 못 하고 넘어갔어요',
  readPart:   '문장의 일부만 읽었어요',
};

// 통계에 쌓인 이유들을 "많이 걸린 순"으로 정리
export function reasonList(st) {
  const r = (st && st.reasons) || {};
  return Object.entries(r)
    .filter(([k, n]) => REASONS[k] && n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, text: REASONS[k], count: n }));
}

// 약점 요약 한 줄 (아이콘 눌렀을 때 표시)
export function weakSummary(st) {
  if (!st) return '';
  const list = reasonList(st);
  const head = `${st.ng || 0}번 어려워했어요`;
  if (!list.length) return head;
  return `${head}\n` + list.map(r => `· ${r.text} (${r.count}번)`).join('\n');
}
