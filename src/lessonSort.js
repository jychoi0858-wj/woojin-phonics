// Lesson 정렬 (이름/날짜 × 오름/내림) — 원본 인덱스 보존
// 반환: [{ d, i }] (d=레슨 객체, i=원본 days 배열 인덱스)
//
// 규칙
//  - 주 기준(이름 또는 날짜)만 오름/내림이 적용됨
//  - 같은 값일 때의 보조 정렬(이름 → 등록순)은 방향과 무관하게 항상 오름차순 유지
//    → 내림차순에서도 "Lesson 3" 다음에 "Lesson 3-E/U" 가 오도록
const nameNum = (n) => parseInt((n || '').match(/\d+/)?.[0] || '0', 10);

// 이름 비교: 숫자 우선(Lesson 2 < Lesson 10), 같으면 문자열
function cmpName(a, b) {
  const d = nameNum(a) - nameNum(b);
  return d !== 0 ? d : (a || '').localeCompare(b || '');
}

export function sortLessons(days, key = 'name', order = 'asc') {
  const arr = (days || []).map((d, i) => ({ d, i }));
  const dir = order === 'desc' ? -1 : 1;

  arr.sort((a, b) => {
    if (key === 'date') {
      const ad = a.d.date || '', bd = b.d.date || '';
      const c = ad.localeCompare(bd); // 날짜 문자열(YYYY-MM-DD) 비교
      if (c !== 0) return dir * c;    // 방향은 날짜에만 적용
      // 같은 날짜 → 이름순(항상 오름차순), 그래도 같으면 등록순
      const cn = cmpName(a.d.name, b.d.name);
      return cn !== 0 ? cn : a.i - b.i;
    }
    // 이름 기준
    const c = cmpName(a.d.name, b.d.name);
    if (c !== 0) return dir * c;
    return a.i - b.i; // 완전 동률은 등록순 유지 (안정 정렬)
  });

  return arr;
}
