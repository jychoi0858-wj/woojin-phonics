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

/** 이 앱이 가르치는 모든 소리 id */
export const ALL_SOUNDS = STAGES.flatMap(s => s.sounds);

/** 소리가 속한 단계 */
export function stageOf(soundId) {
  return STAGES.find(s => s.sounds.includes(soundId)) || null;
}
