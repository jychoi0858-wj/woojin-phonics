// ============================================================
// 파닉스 학습 데이터
//   STAGES     — 소리를 배우는 순서 (쉬운 것 → 어려운 것)
//   SOUND_INFO — 소리마다 화면에 보여줄 글자·한글 소리·입 모양 힌트·예시 단어
//
//   예시 단어는 "등록된 단어에 이 소리가 없을 때" 쓰는 기본값이다.
//   아이가 이미 배운 단어가 있으면 그쪽을 먼저 쓴다.
// ============================================================

export const STAGES = [
  {
    id: 1, icon: '🍎', name: '짧은 모음',
    desc: '모음 하나가 내는 가장 기본 소리예요',
    sounds: ['short-a', 'short-i', 'short-o', 'short-e', 'short-u'],
  },
  {
    id: 2, icon: '🔤', name: '기본 자음',
    desc: '글자 하나하나가 내는 소리를 익혀요',
    sounds: ['m', 's', 't', 'p', 'b', 'n', 'd', 'k', 'g', 'f', 'l', 'h', 'r', 'j', 'v', 'w', 'y', 'z', 'ks'],
  },
  {
    id: 3, icon: '👬', name: '두 글자 한 소리',
    desc: '두 글자가 붙어 새로운 소리를 내요',
    sounds: ['sh', 'ch', 'th', 'th-voiced', 'ng', 'qu', 'wh'],
  },
  {
    id: 4, icon: '✨', name: '마법의 e',
    desc: '끝에 붙은 e가 앞 모음을 이름으로 바꿔요',
    sounds: ['long-a', 'long-i', 'long-o', 'long-u', 'yoo'],
  },
  {
    id: 5, icon: '🤝', name: '모음 팀',
    desc: '모음 둘이 손을 잡고 한 소리를 내요',
    sounds: ['long-e', 'ou', 'oi', 'oo-long', 'oo-short', 'aw'],
  },
  {
    id: 6, icon: '🐕', name: 'r 모음',
    desc: 'r이 앞에 있는 모음의 소리를 바꿔요',
    sounds: ['ar', 'or', 'er', 'air', 'ear', 'ure'],
  },
  {
    id: 7, icon: '🤫', name: '조용한 글자',
    desc: '소리를 내지 않거나 살짝 변하는 글자예요',
    sounds: ['silent-kn', 'silent-gn', 'silent-wr', 'soft-c', 'soft-g', 'schwa'],
  },
];

// label = 화면에 크게 보여줄 글자 / ko = 한글로 적은 소리 / tip = 입 모양 힌트 / words = 예시 단어
export const SOUND_INFO = {
  // ── 짧은 모음 ──
  'short-a': { label: 'a', ko: '애', tip: '입을 크게 벌리고 "애"', words: ['cat', 'map', 'bag', 'hand'] },
  'short-e': { label: 'e', ko: '에', tip: '입을 조금 벌리고 "에"', words: ['bed', 'pen', 'red', 'ten'] },
  'short-i': { label: 'i', ko: '이', tip: '입을 옆으로 살짝 "이"', words: ['pig', 'sit', 'big', 'fish'] },
  'short-o': { label: 'o', ko: '아', tip: '입을 동그랗게 "아"', words: ['dog', 'box', 'hot', 'pot'] },
  'short-u': { label: 'u', ko: '어', tip: '입에 힘을 빼고 "어"', words: ['cup', 'sun', 'bus', 'duck'] },

  // ── 기본 자음 ──
  'm': { label: 'm', ko: '므', tip: '입을 다물고 "음~"', words: ['man', 'map', 'mom', 'milk'] },
  's': { label: 's', ko: '스', tip: '이 사이로 바람을 "스~"', words: ['sun', 'sit', 'six', 'sock'] },
  't': { label: 't', ko: '트', tip: '혀끝을 붙였다 톡 떼요', words: ['top', 'ten', 'toy', 'tap'] },
  'p': { label: 'p', ko: '프', tip: '입술을 붙였다 팡 터뜨려요', words: ['pig', 'pen', 'pot', 'pan'] },
  'b': { label: 'b', ko: '브', tip: 'p와 같은 입, 목소리를 더해요', words: ['bat', 'bed', 'box', 'bus'] },
  'n': { label: 'n', ko: '느', tip: '혀끝을 붙이고 "은~"', words: ['net', 'nose', 'nut', 'nap'] },
  'd': { label: 'd', ko: '드', tip: 't와 같은 입, 목소리를 더해요', words: ['dog', 'dad', 'duck', 'door'] },
  'k': { label: 'c / k', ko: '크', tip: '혀 뒤를 올렸다 떼요', words: ['cat', 'cup', 'kid', 'key'] },
  'g': { label: 'g', ko: '그', tip: 'k와 같은 입, 목소리를 더해요', words: ['go', 'gum', 'goat', 'game'] },
  'f': { label: 'f', ko: '프', tip: '윗니로 아랫입술을 살짝 물어요', words: ['fish', 'fan', 'fox', 'five'] },
  'l': { label: 'l', ko: '르', tip: '혀끝을 윗잇몸에 붙여요', words: ['leg', 'lip', 'log', 'lion'] },
  'h': { label: 'h', ko: '흐', tip: '입김을 "후" 불어요', words: ['hat', 'hot', 'hand', 'hop'] },
  'r': { label: 'r', ko: '르', tip: '혀를 뒤로 살짝 말아요', words: ['red', 'run', 'rain', 'rock'] },
  'j': { label: 'j', ko: '즈', tip: '혀를 붙였다 떼며 소리 내요', words: ['jam', 'jog', 'jump', 'job'] },
  'v': { label: 'v', ko: '브', tip: 'f와 같은 입, 목소리를 더해요', words: ['van', 'vet', 'vine', 'voice'] },
  'w': { label: 'w', ko: '우', tip: '입술을 동그랗게 모아 "우"', words: ['web', 'win', 'wet', 'wall'] },
  'y': { label: 'y', ko: '이', tip: '짧게 "이~" 하고 이어요', words: ['yes', 'yak', 'yell', 'yard'] },
  'z': { label: 'z', ko: '즈', tip: 's에 목소리를 더해요', words: ['zip', 'zoo', 'zebra', 'buzz'] },
  'ks': { label: 'x', ko: '크스', tip: '두 소리가 빠르게 이어져요', words: ['box', 'fox', 'six', 'mix'] },

  // ── 두 글자 한 소리 ──
  'sh': { label: 'sh', ko: '쉬', tip: '조용히 할 때처럼 "쉿"', words: ['ship', 'shop', 'fish', 'shell'] },
  'ch': { label: 'ch', ko: '치', tip: '기차 소리처럼 "치치"', words: ['chin', 'chip', 'lunch', 'chair'] },
  'th': { label: 'th', ko: '쓰', tip: '혀를 살짝 물고 바람만 내요', words: ['thin', 'think', 'bath', 'math'] },
  'th-voiced': { label: 'th', ko: '드', tip: '혀를 물고 목을 울려요', words: ['the', 'this', 'that', 'they'] },
  'ng': { label: 'ng', ko: '응', tip: '코로 "응~"', words: ['ring', 'sing', 'king', 'long'] },
  'qu': { label: 'qu', ko: '쿠', tip: 'q는 늘 u와 함께 다녀요', words: ['queen', 'quick', 'quiz', 'quiet'] },
  'wh': { label: 'wh', ko: '후', tip: '촛불을 끄듯 "후"', words: ['what', 'when', 'white', 'wheel'] },

  // ── 마법의 e ──
  'long-a': { label: 'a_e', ko: '에이', tip: '끝의 e가 a를 이름으로 만들어요', words: ['cake', 'game', 'name', 'gate'] },
  'long-i': { label: 'i_e', ko: '아이', tip: '끝의 e가 i를 이름으로 만들어요', words: ['kite', 'bike', 'five', 'time'] },
  'long-o': { label: 'o_e', ko: '오우', tip: '끝의 e가 o를 이름으로 만들어요', words: ['home', 'nose', 'rope', 'bone'] },
  'long-u': { label: 'u_e', ko: '우-', tip: '입술을 모아 길게 "우-"', words: ['flute', 'rule', 'blue', 'glue'] },
  'yoo': { label: 'u_e', ko: '유-', tip: 'u를 이름 그대로 "유"', words: ['cute', 'use', 'cube', 'music'] },

  // ── 모음 팀 ──
  'long-e': { label: 'ee / ea', ko: '이-', tip: '입을 옆으로 길게 "이-"', words: ['see', 'tree', 'team', 'read'] },
  'ou': { label: 'ou / ow', ko: '아우', tip: '놀랐을 때처럼 "아우!"', words: ['out', 'house', 'cow', 'now'] },
  'oi': { label: 'oi / oy', ko: '오이', tip: '"오"에서 "이"로 미끄러져요', words: ['coin', 'oil', 'boy', 'toy'] },
  'oo-long': { label: 'oo', ko: '우-', tip: '입술을 동그랗게 길게 "우-"', words: ['moon', 'boot', 'food', 'zoo'] },
  'oo-short': { label: 'oo', ko: '우', tip: '짧게 툭 "우"', words: ['book', 'look', 'good', 'foot'] },
  'aw': { label: 'au / aw', ko: '오-', tip: '입을 크게 벌리고 "오-"', words: ['saw', 'draw', 'ball', 'talk'] },

  // ── r 모음 ──
  'ar': { label: 'ar', ko: '아r', tip: '"아" 하면서 혀를 말아요', words: ['car', 'star', 'park', 'farm'] },
  'or': { label: 'or', ko: '오r', tip: '"오" 하면서 혀를 말아요', words: ['fork', 'corn', 'horse', 'short'] },
  'er': { label: 'er / ir / ur', ko: '어r', tip: '"어" 하면서 혀를 말아요', words: ['bird', 'girl', 'turn', 'her'] },
  'air': { label: 'air / are', ko: '에어r', tip: '"에어" 하고 이어요', words: ['hair', 'chair', 'care', 'share'] },
  'ear': { label: 'ear', ko: '이어r', tip: '"이어" 하고 이어요', words: ['ear', 'hear', 'near', 'year'] },
  'ure': { label: 'ure', ko: '유어r', tip: '"유어" 하고 이어요', words: ['pure', 'cure', 'sure', 'lure'] },

  // ── 조용한 글자 ──
  'silent-kn': { label: 'kn', ko: '느', tip: 'k는 소리를 내지 않아요', words: ['knee', 'knife', 'knock', 'know'] },
  'silent-gn': { label: 'gn', ko: '느', tip: 'g는 소리를 내지 않아요', words: ['gnome', 'gnat', 'gnaw', 'gnu'] },
  'silent-wr': { label: 'wr', ko: '르', tip: 'w는 소리를 내지 않아요', words: ['wrist', 'write', 'wrong', 'wrap'] },
  'soft-c': { label: 'c', ko: '스', tip: 'e, i, y 앞에서 c는 "스"', words: ['cent', 'city', 'cycle', 'cell'] },
  'soft-g': { label: 'g', ko: '즈', tip: 'e, i, y 앞에서 g는 "즈"', words: ['gem', 'giant', 'gym', 'magic'] },
  'schwa': { label: 'a', ko: '어', tip: '힘을 빼고 흐릿하게 "어"', words: ['sofa', 'banana', 'panda', 'pizza'] },
};

// ─────────────────────────────────────────────────────────────
// 혼자 낼 때와 단어 속에서 다르게 들리는 소리 안내
//   자음은 혼자 발음하면 뒤에 "으/우"가 붙어 실제 단어 소리와 달라진다.
//   특히 l, r, w, y는 차이가 커서 아이가 헷갈리기 쉽다.
// ─────────────────────────────────────────────────────────────
export const ALONE_NOTE = {
  'l': '혼자 내면 "울"처럼 들려요. 단어에서는 뒤 모음에 딱 붙여 "라·리·루"로 나요. (lamb → 래-)',
  'r': '혼자 내면 "얼"처럼 들려요. 단어에서는 모음에 붙여 "라·리·루"로 나요. (red → 뤠-)',
  'w': '혼자 내면 "우"예요. 단어에서는 뒤 모음으로 미끄러져요. (web → 웨-)',
  'y': '혼자 내면 "이"예요. 단어에서는 뒤 모음으로 미끄러져요. (yes → 예-)',
  'm': '입을 다물고 내는 소리라 "음~"처럼 길게 들려요. 단어에서는 짧게 붙어요.',
  'n': '"은~"처럼 들리지만 단어에서는 짧게 붙어요.',
  'ng': '단어 끝에서만 나는 소리예요. 혼자 시작할 수 없어요.',
  'b': '혼자 내면 "브"지만 단어에서는 "으"가 거의 안 들려요.',
  'd': '혼자 내면 "드"지만 단어에서는 "으"가 거의 안 들려요.',
  'g': '혼자 내면 "그"지만 단어에서는 "으"가 거의 안 들려요.',
  'k': '혼자 내면 "크"지만 단어에서는 "으"가 거의 안 들려요.',
  'p': '혼자 내면 "프"지만 단어에서는 "으"가 거의 안 들려요.',
  't': '혼자 내면 "트"지만 단어에서는 "으"가 거의 안 들려요.',
  'schwa': '힘이 빠진 소리라 또렷하지 않아요. 흐릿하게 지나가는 게 맞아요.',
};

/** 자음처럼 혼자 낼 때 "으"가 붙는 소리인지 */
const CONSONANT_LIKE = new Set([
  'b', 'k', 'd', 'f', 'g', 'h', 'j', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'y', 'z', 'ks',
  'sh', 'ch', 'th', 'th-voiced', 'ng', 'qu', 'wh', 'soft-c', 'soft-g',
  'silent-kn', 'silent-gn', 'silent-wr',
]);

// 모음 무리별 안내 (모음은 혼자서도 단어와 같은 소리라 다른 이야기를 해 준다)
const VOWEL_NOTE = [
  { ids: ['short-a', 'short-e', 'short-i', 'short-o', 'short-u'],
    text: '모음은 혼자서도 단어에서와 같은 소리예요. 길게 늘이지 말고 짧게 툭 끊어 내는 게 중요해요.' },
  { ids: ['long-a', 'long-e', 'long-i', 'long-o', 'long-u', 'yoo'],
    text: '알파벳 이름과 똑같은 소리예요. 짧은 소리와 헷갈리지 않게 충분히 길게 내 주세요.' },
  { ids: ['ou', 'oi'],
    text: '한 소리에서 다른 소리로 미끄러지듯 이어져요. 입 모양이 중간에 바뀌는 걸 느껴 보세요.' },
  { ids: ['oo-long', 'oo-short'],
    text: '같은 oo인데 길이가 달라요. moon은 길게, book은 짧게 툭 — 이 차이만 잡으면 돼요.' },
  { ids: ['aw'],
    text: '한국어 "오"보다 입을 더 크게 벌리고 턱을 내려요.' },
  { ids: ['ar', 'or', 'er', 'air', 'ear', 'ure'],
    text: 'r 때문에 혀가 뒤로 말려요. 한국어에 없는 움직임이라 거울을 보며 천천히 연습하면 좋아요.' },
];

/** 그 소리의 "혼자 낼 때 vs 단어 속" 안내 문구 */
export function aloneNote(soundId) {
  if (ALONE_NOTE[soundId]) return ALONE_NOTE[soundId];
  const v = VOWEL_NOTE.find(g => g.ids.includes(soundId));
  if (v) return v.text;
  if (CONSONANT_LIKE.has(soundId)) return '혼자 내면 뒤에 "으"가 살짝 붙어요. 단어에서는 뒤 모음에 바로 붙여 읽어요.';
  return null;
}

// ─────────────────────────────────────────────────────────────
// 이어 읽기(블렌딩)에서 조각마다 붙는 설명
//   배우는 소리가 a여도, lamb에는 "울"처럼 들리는 l과 묵음 b가 함께 나온다.
//   아이가 "왜 저래?" 하고 막히지 않게 조각별로 짧게 알려 준다.
// ─────────────────────────────────────────────────────────────
const SILENT_NOTE = {
  e: '끝의 e는 소리를 내지 않아요. 대신 앞의 모음을 이름 소리로 길게 만들어 줘요.',
  b: 'm 뒤의 b는 소리를 내지 않아요. (lamb, comb, thumb)',
  n: 'm 뒤의 n은 소리를 내지 않아요. (autumn)',
  l: '여기 l은 소리를 내지 않아요. (walk, half, calm)',
};

const DIGRAPHS = ['sh', 'ch', 'th', 'ng', 'ck', 'qu', 'wh', 'ph', 'kn', 'gn', 'wr', 'igh', 'tch', 'dge'];
const DOUBLES = ['ll', 'ss', 'ff', 'zz', 'tt', 'dd', 'pp', 'bb', 'gg', 'nn', 'mm', 'rr', 'cc'];
const VOWEL_TEAMS = ['ai', 'ay', 'ea', 'ee', 'ey', 'ie', 'oa', 'oe', 'oi', 'oy', 'ou', 'ow', 'oo', 'ue', 'ui', 'au', 'aw'];
const R_CONTROLLED = ['ar', 'er', 'ir', 'or', 'ur', 'air', 'ear', 'are', 'ure'];

/**
 * 조각 하나에 대한 설명 (설명할 게 없으면 null)
 * @param chunk  { text, sound, silent }
 * @param i      조각 위치
 * @param chunks 전체 조각
 */
export function chunkNote(chunk, i, chunks = []) {
  const t = chunk.text;
  if (chunk.silent) return SILENT_NOTE[t] || `${t}는 소리를 내지 않아요.`;

  // 소리로 먼저 판단해야 하는 것들 (같은 글자라도 소리가 다름)
  if (chunk.sound === 'th-voiced') return '이 th는 목이 울려요. thin의 바람 소리 th와 달라요.';
  if (chunk.sound === 'th') return 'th는 혀를 살짝 물고 바람만 내보내요.';
  if (chunk.sound === 'oo-short') return '여기 oo는 짧게 "우"예요. moon의 긴 "우-"와 달라요.';
  if (chunk.sound === 'oo-long') return '여기 oo는 길게 "우-"예요. book의 짧은 "우"와 달라요.';
  if (R_CONTROLLED.includes(t)) return `${t}는 r이 앞 모음의 소리를 바꿔 놓은 소리예요.`;

  if (DOUBLES.includes(t)) return `${t}은 같은 글자가 둘이지만 소리는 한 번만 나요.`;
  if (t === 'le') return '끝의 le는 "을"처럼 한 덩어리로 소리 나요.';
  if (DIGRAPHS.includes(t)) return `${t}는 두 글자가 모여 하나의 소리를 내요.`;
  if (VOWEL_TEAMS.includes(t)) return `${t}는 모음 둘이 모여 하나의 소리를 내요.`;
  if (chunk.sound === 'soft-c') return 'e, i, y 앞이라 c가 "크"가 아니라 "스"로 나요.';
  if (chunk.sound === 'soft-g') return 'e, i, y 앞이라 g가 "그"가 아니라 "즈"로 나요.';
  if (chunk.sound === 'yoo') return '여기 u는 알파벳 이름 그대로 "유"로 나요.';
  if (chunk.sound === 'aw' && t === 'a') return 'l 앞의 a는 "애"가 아니라 "오-"로 나요.';

  // 매직 e 덕분에 길어진 모음
  const hasSilentE = chunks.some(c => c.silent && c.text === 'e');
  if (hasSilentE && t.length === 1 && 'aeiou'.includes(t) && /^long-/.test(chunk.sound || '')) {
    return `끝의 e 덕분에 ${t}가 이름 소리로 길어졌어요.`;
  }

  // 혼자 들으면 헷갈리는 자음 (뒤에 모음이 오면 붙어서 달라짐)
  if (ALONE_NOTE[chunk.sound] && ['l', 'r', 'w', 'y'].includes(chunk.sound)) {
    return ALONE_NOTE[chunk.sound];
  }
  return null;
}

/** 이 앱이 가르치는 모든 소리 id */
export const ALL_SOUNDS = STAGES.flatMap(s => s.sounds);

/** 소리가 속한 단계 */
export function stageOf(soundId) {
  return STAGES.find(s => s.sounds.includes(soundId)) || null;
}
