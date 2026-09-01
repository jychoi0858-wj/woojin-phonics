// ============================================================
// 파닉스 패턴 분석
//   등록된 단어에서 "소리 조각"(그래핌)을 찾아내고, 같은 소리를 가진
//   다른 단어들을 묶어 준다. 새 데이터 입력 없이 기존 단어만 사용.
//
//   sound  = 소리 id (음원 파일과 1:1)
//   label  = 화면에 보여줄 글자 (ow, igh, a_e ...)
//   desc   = 아이에게 보여줄 설명
// ============================================================

// 소리 → 음원 파일 (Read Naturally 발음 예시, 앞부분만 잘라 소리만 남김)
export const SOUND_FILES = {
  'schwa': 'Schwa-What.mp3',
  'short-a': 'a-apple.mp3',
  'short-e': 'e-elephant.mp3',
  'short-i': 'i-igloo.mp3',
  'short-o': 'o-octopus.mp3',
  'short-u': 'u-up.mp3',
  'long-a': 'a-cake.mp3',
  'long-e': 'e-team.mp3',
  'long-i': 'i-kite.mp3',
  'long-o': 'o-rope.mp3',
  'long-u': 'u-lute-glue.mp3',
  'yoo': 'u-use-cue.mp3',
  'ou': 'ou-how-out.mp3',
  'oi': 'oi-soil-toy.mp3',
  'oo-long': 'oo-boot-new.mp3',
  'oo-short': 'oo-book-bush.mp3',
  'aw': 'aw-haul-hawk-ball.mp3',
  'ar': 'ar-jar.mp3',
  'er': 'er-herd-bird-turn.mp3',
  'or': 'or-fork.mp3',
  'ear': 'ear-hear.mp3',
  'air': 'air-pair-share.mp3',
  'ure': 'ure-lure.mp3',
  'sh': 'sh-ship.mp3',
  'ch': 'ch-chick.mp3',
  'th': 'th-thin.mp3',
  'th-voiced': 'th-the.mp3',
  'ng': 'ng-ring.mp3',
  'qu': 'qu-quest.mp3',
  'wh': 'hw-whip.mp3',
  'b': 'b-bat.mp3', 'k': 'c-cut.mp3', 'd': 'd-dip.mp3', 'f': 'f-fun.mp3',
  'g': 'g-get.mp3', 'h': 'h-hat.mp3', 'j': 'j-jog.mp3', 'l': 'l-lip.mp3',
  'm': 'm-mug.mp3', 'n': 'n-nap.mp3', 'p': 'p-pick.mp3', 'r': 'r-rid.mp3',
  's': 's-sit-mess.mp3', 'z': 'z-zip-buzz.mp3', 't': 't-tuck.mp3',
  'v': 'v-van.mp3', 'w': 'w-will.mp3', 'y': 'y-yes.mp3', 'ks': 'x-mix-rocks.mp3',
  'soft-c': 's-cent-cirus-cycle.mp3', 'soft-g': 'j-gem-giant-gym.mp3',
  'silent-kn': 'n-knife.mp3', 'silent-gn': 'n-gnome.mp3', 'silent-wr': 'wr-wrist.mp3',
};

// 패턴 규칙 — 위에서부터 먼저 맞는 것을 사용 (구체적인 것 → 일반적인 것)
// re: 정규식 (소문자 단어에 적용), sound: 소리 id, desc: 설명
const RULES = [
  // 묵음으로 시작하는 자음
  { re: /^kn/, sound: 'silent-kn', desc: 'k는 소리가 안 나요' },
  { re: /^gn/, sound: 'silent-gn', desc: 'g는 소리가 안 나요' },
  { re: /^wr/, sound: 'silent-wr', desc: 'w는 소리가 안 나요' },

  // ── 예외를 먼저 (자주 틀리는 조합) ──
  { re: /^wor/, sound: 'er', desc: '어r 소리가 나요', mark: /or/ },   // word, work, world
  // ↓ 단어 전체가 일치할 때만 (^…$) — 다른 단어의 일부에 잘못 걸리지 않게
  { re: /^(bear|pear|wear|tear)s?$/, sound: 'air', desc: '에어r 소리가 나요', mark: /ear/ },
  { re: /^(learn|heard|earth|early|search|earn)\w*$/, sound: 'er', desc: '어r 소리가 나요', mark: /ear/ },
  { re: /^(great|break|steak)\w*$/, sound: 'long-a', desc: '에이 소리가 나요', mark: /ea/ },
  { re: /^(book|good|look|took|foot|wood|cook|hook|stood|wool)\w*$/, sound: 'oo-short', desc: '짧은 우 소리가 나요', mark: /oo/ },
  { re: /^(know|snow|show|low|slow|grow|blow|throw|yellow|window|below|own|bowl|elbow|pillow|rainbow)\w*$/, sound: 'long-o', desc: '오우 소리가 나요', mark: /ow/ },
  // th가 목을 울리는 낱말들 (the/this… — 나머지 th는 바람 소리)
  { re: /^(the|this|that|these|those|they|them|then|there|their|than|though|father|mother|brother|other|weather|together|feather|leather)\w*$/, sound: 'th-voiced', desc: '혀를 물고 목을 울려요', mark: /th/ },
  // u가 이름 그대로 "유"로 소리 나는 낱말들 (매직 e보다 먼저)
  { re: /^(cute|use|used|cube|mute|fuse|huge|music|human|unit|uniform|menu|cucumber)\w*$/, sound: 'yoo', desc: '유- 소리가 나요', mark: /u/ },

  // r 모음 중 먼저 잡아야 하는 것 (oor/oar 은 모음팀 oo/oa 보다 우선)
  { re: /(oor|oar)/, sound: 'or', desc: '오r 소리가 나요' },
  { re: /ear/, sound: 'ear', desc: '이어r 소리가 나요' },
  { re: /air/, sound: 'air', desc: '에어r 소리가 나요' },
  { re: /are$/, sound: 'air', desc: '에어r 소리가 나요' },       // share, care (sh 규칙보다 먼저)
  { re: /ure$/, sound: 'ure', desc: '유어r 소리가 나요' },       // pure, sure (매직 e보다 먼저)

  // 모음 팀 (두 글자가 한 소리)
  { re: /igh/, sound: 'long-i', desc: '아이 소리가 나요' },
  { re: /(ai|ay)/, sound: 'long-a', desc: '에이 소리가 나요' },
  { re: /(ee|ea)/, sound: 'long-e', desc: '이- 소리가 나요' },
  { re: /oa/, sound: 'long-o', desc: '오우 소리가 나요' },
  { re: /(oi|oy)/, sound: 'oi', desc: '오이 소리가 나요' },
  { re: /(ou|ow)/, sound: 'ou', desc: '아우 소리가 나요' },
  { re: /oo/, sound: 'oo-long', desc: '우- 소리가 나요' },
  { re: /(au|aw)/, sound: 'aw', desc: '오- 소리가 나요' },
  { re: /ue/, sound: 'long-u', desc: '우- 소리가 나요' },

  // 나머지 r 모음
  { re: /ar/, sound: 'ar', desc: '아r 소리가 나요' },
  { re: /or/, sound: 'or', desc: '오r 소리가 나요' },
  { re: /(er|ir|ur)/, sound: 'er', desc: '어r 소리가 나요' },

  // 매직 e (a_e, i_e, o_e, u_e)
  { re: /a[bcdfgklmnprstvz]e$/, sound: 'long-a', desc: '끝의 e가 a를 이름으로 만들어요', magic: 'a' },
  { re: /i[bcdfgklmnprstvz]e$/, sound: 'long-i', desc: '끝의 e가 i를 이름으로 만들어요', magic: 'i' },
  { re: /o[bcdfgklmnprstvz]e$/, sound: 'long-o', desc: '끝의 e가 o를 이름으로 만들어요', magic: 'o' },
  { re: /u[bcdfgklmnprstvz]e$/, sound: 'long-u', desc: '끝의 e가 u를 이름으로 만들어요', magic: 'u' },

  // 이중 자음
  { re: /sh/, sound: 'sh', desc: '쉬 소리가 나요' },
  { re: /ch/, sound: 'ch', desc: '치 소리가 나요' },
  { re: /th/, sound: 'th', desc: '혀를 살짝 물고 내는 소리예요' },
  { re: /ng/, sound: 'ng', desc: '응 소리가 나요' },
  { re: /qu/, sound: 'qu', desc: '쿠 소리가 나요' },
  { re: /wh/, sound: 'wh', desc: '후 소리가 나요' },
  { re: /ck/, sound: 'k', desc: '크 소리가 나요' },

  // c와 g가 e·i·y를 만나면 소리가 바뀜 (단모음 폴백보다 먼저)
  { re: /^(get|give|given|gift|girl|geese|gear|gecko|giggle|guess|guest|gill)\w*$/, sound: 'g', desc: '그 소리가 나요', mark: /g/ }, // 예외: 딱딱한 g
  { re: /c(?=[eiy])/, sound: 'soft-c', desc: 'e, i, y 앞에서 c는 스 소리예요' },
  { re: /g(?=[eiy])/, sound: 'soft-g', desc: 'e, i, y 앞에서 g는 즈 소리예요' },

  // 끝의 a는 힘이 빠져 흐릿한 "어"가 됨 (sofa, banana)
  { re: /a$/, sound: 'schwa', desc: '힘을 빼고 흐릿하게 어' },

  // 단모음 (마지막 폴백) — 끝에 오는 e는 소리가 안 나므로 제외
  { re: /a/, sound: 'short-a', desc: '짧은 애 소리가 나요' },
  { re: /e(?!$)/, sound: 'short-e', desc: '짧은 에 소리가 나요' },
  { re: /i/, sound: 'short-i', desc: '짧은 이 소리가 나요' },
  { re: /o/, sound: 'short-o', desc: '짧은 아 소리가 나요' },
  { re: /u/, sound: 'short-u', desc: '짧은 어 소리가 나요' },
];

const norm = (w) => (w || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * 단어에서 파닉스 패턴을 찾음
 * @returns { label, sound, desc, start, end, magicE } | null
 *   start~end = 강조할 글자 위치 (원본 단어 기준)
 */
export function findPattern(word) {
  const raw = word || '';
  // 정규화하면서 "정규화 위치 → 원본 위치" 대응표를 함께 만듦
  // (공백·아포스트로피가 든 단어에서 강조 위치가 어긋나지 않게)
  let w = '';
  const map = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i].toLowerCase();
    if (c >= 'a' && c <= 'z') { w += c; map.push(i); }
  }
  if (!w || w.length < 2) return null;

  for (const rule of RULES) {
    const m = w.match(rule.re);
    if (!m) continue;
    let start = m.index;
    let end = m.index + m[0].length;
    let label = m[0];
    // 예외 규칙(단어 전체 매칭)은 강조할 글자를 따로 지정
    if (rule.mark) {
      const mm = w.match(rule.mark);
      if (mm) { start = mm.index; end = mm.index + mm[0].length; label = mm[0]; }
    }
    const at = (k) => map[k];   // 정규화 인덱스 → 원본 인덱스

    if (rule.magic) {
      // 매직 e: 모음과 끝 e만 강조 (사이 자음은 제외)
      return {
        label: `${rule.magic}_e`,
        sound: rule.sound,
        desc: rule.desc,
        magicE: true,
        marks: [at(start), at(end - 1)].filter(x => x !== undefined),
      };
    }
    return {
      label,
      sound: rule.sound,
      desc: rule.desc,
      marks: Array.from({ length: end - start }, (_, i) => at(start + i)).filter(x => x !== undefined),
    };
  }
  return null;
}

/**
 * 같은 소리를 가진 다른 단어 찾기 (등록된 전체 단어에서)
 * @param word 기준 단어
 * @param allWords 등록된 모든 단어 (여러 레슨·여러 달)
 * @param limit 최대 개수
 */
export function findSoundFriends(word, allWords = [], limit = 4) {
  const p = findPattern(word);
  if (!p) return [];
  const self = norm(word);
  const seen = new Set([self]);
  const out = [];
  for (const w of allWords) {
    const n = norm(w);
    if (!n || seen.has(n)) continue;
    const q = findPattern(n);
    if (q && q.sound === p.sound) {
      seen.add(n);
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// 소리 id → 음원 파일명
export function soundFile(soundId) {
  return SOUND_FILES[soundId] || '';
}

// ============================================================
// 예외 단어 (sight word / heart word)
//   파닉스 규칙으로 읽어낼 수 없는 단어들. eye를 ey+e로 쪼개면 "이-에"가 되지만
//   실제로는 "아이"다. 이런 단어는 쪼개지 말고 통째로 익히게 한다.
// ============================================================
const IRREGULAR = new Set([
  'eye', 'eyes', 'one', 'once', 'two', 'who', 'whose', 'whom',
  'said', 'says', 'was', 'were', 'are', 'been',
  'come', 'comes', 'some', 'done', 'gone', 'none',
  'love', 'above', 'move', 'moves', 'prove', 'glove',
  'could', 'would', 'should', 'put', 'push', 'pull', 'full',
  'of', 'do', 'does', 'to', 'too', 'into',
  'friend', 'friends', 'laugh', 'listen', 'many', 'money', 'monkey',
  'honey', 'only', 'people', 'pretty', 'school', 'sign', 'tongue', 'touch',
  'women', 'young', 'your', 'youre', 'busy', 'buy', 'build', 'built',
  'sure', 'sugar', 'heart', 'sew', 'their', 'there', 'where', 'here',
  'give', 'gives', 'live', 'lives', 'have', 'has',
  'said', 'again', 'against', 'break', 'great', 'steak',
  'island', 'iron', 'onion', 'ocean', 'colour', 'color',
  // ough / augh — 같은 철자인데 소리가 다 달라 규칙으로 못 읽음
  'though', 'through', 'thought', 'thorough', 'bought', 'brought', 'fought',
  'enough', 'rough', 'tough', 'cough', 'dough', 'doughnut', 'plough',
  'height', 'weight',
  // 그 밖에 자주 나오는 예외
  'answer', 'because', 'beautiful', 'blood', 'flood', 'bury', 'castle',
  'chocolate', 'clothes', 'cousin', 'front', 'guard', 'guess', 'guitar',
  'hour', 'machine', 'nothing', 'orange', 'quiet',
  'shoe', 'shoes', 'special', 'squirrel', 'straight', 'sword',
  'vegetable', 'wednesday', 'whole', 'wolf', 'woman',
]);

/** 파닉스 규칙으로 읽히지 않는 단어인지 */
export function isIrregular(word) {
  return IRREGULAR.has(norm(word));
}

// ============================================================
// 블렌딩 — 단어를 "소리 조각"으로 쪼개기
//   cat  → c · a · t
//   ship → sh · i · p
//   cake → c · a(길게) · k · e(묵음)
//   조각마다 낼 소리(sound id)를 함께 알려 준다.
// ============================================================

// 두 글자 이상이 한 소리를 내는 조합 (긴 것부터 먼저 확인)
const GRAPHEMES = [
  'tion', 'sion', 'ture', 'augh', 'eigh', 'ough',
  'igh', 'air', 'ear', 'are', 'ure', 'tch', 'dge',
  'sh', 'ch', 'th', 'ng', 'ck', 'qu', 'wh', 'ph', 'gh', 'kn', 'gn', 'wr',
  'ai', 'ay', 'ea', 'ee', 'ey', 'ie', 'oa', 'oe', 'oi', 'oy', 'ou', 'ow', 'oo',
  'ue', 'ui', 'au', 'aw', 'ar', 'er', 'ir', 'or', 'ur',
  // 겹자음은 한 소리 (ball의 ll, mess의 ss)
  'll', 'ss', 'ff', 'zz', 'tt', 'dd', 'pp', 'bb', 'gg', 'nn', 'mm', 'rr', 'cc',
];

const G_SOUND = {
  sh: 'sh', ch: 'ch', th: 'th', ng: 'ng', ck: 'k', qu: 'qu', wh: 'wh', ph: 'f',
  kn: 'silent-kn', gn: 'silent-gn', wr: 'silent-wr',
  ai: 'long-a', ay: 'long-a', ea: 'long-e', ee: 'long-e', ey: 'long-e', ie: 'long-i',
  oa: 'long-o', oe: 'long-o', oi: 'oi', oy: 'oi', ou: 'ou', ow: 'ou',
  oo: 'oo-long', ue: 'long-u', ui: 'oo-long', au: 'aw', aw: 'aw',
  ar: 'ar', er: 'er', ir: 'er', or: 'or', ur: 'er',
  igh: 'long-i', air: 'air', ear: 'ear', are: 'air', ure: 'ure', tch: 'ch', dge: 'j',
  tion: 'sh', sion: 'sh', ture: 'ch', augh: 'aw', eigh: 'long-a', ough: 'aw', gh: 'g',
  ll: 'l', ss: 's', ff: 'f', zz: 'z', tt: 't', dd: 'd', pp: 'p', bb: 'b',
  gg: 'g', nn: 'n', mm: 'm', rr: 'r', cc: 'k',
  b: 'b', c: 'k', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', m: 'm',
  n: 'n', p: 'p', r: 'r', s: 's', t: 't', v: 'v', w: 'w', x: 'ks', y: 'y', z: 'z',
};
const LONG_V = { a: 'long-a', e: 'long-e', i: 'long-i', o: 'long-o', u: 'long-u' };
const SHORT_V = { a: 'short-a', e: 'short-e', i: 'short-i', o: 'short-o', u: 'short-u' };

/**
 * 단어를 소리 조각으로 쪼갬
 * @returns [{ text, sound, silent }]  silent=true면 소리가 나지 않는 글자
 */
export function splitGraphemes(word) {
  const w = norm(word);
  if (!w) return [];
  // 예외 단어는 쪼개지 않음 — 통째로 익히는 단어
  if (IRREGULAR.has(w)) return [{ text: w, sound: null, whole: true }];
  const magicE = /[aeiou][bcdfgklmnprstvz]e$/.test(w);   // cake, kite, rope …
  const out = [];
  let i = 0;
  while (i < w.length) {
    // 매직 e의 끝 e는 소리가 없음
    if (magicE && i === w.length - 1 && w[i] === 'e') {
      out.push({ text: 'e', sound: null, silent: true });
      i += 1;
      continue;
    }
    let hit = null;
    for (const g of GRAPHEMES) {
      if (!w.startsWith(g, i)) continue;
      if ((g === 'kn' || g === 'gn' || g === 'wr' || g === 'gh') && i !== 0) continue;   // 단어 맨 앞에서만
      if ((g === 'are' || g === 'ure' || g === 'ture') && i + g.length !== w.length) continue; // 끝에서만
      hit = g;
      break;
    }
    if (hit) {
      out.push({ text: hit, sound: G_SOUND[hit] || null });
      i += hit.length;
      continue;
    }
    const c = w[i];
    const next = w[i + 1];
    let sound;
    if (SHORT_V[c]) {
      if (magicE && i === w.length - 3) {
        sound = LONG_V[c];                     // 매직 e 앞의 모음은 길게 (cake의 a)
      } else if (c === 'a' && i > 0 && w[i - 1] === 'w') {
        sound = 'short-o';                     // w 뒤의 a는 "아" (want, watch, wash)
      } else if (c === 'o' && i === w.length - 1 && w.length > 1) {
        sound = 'long-o';                      // 단어 끝의 o는 "오우" (go, also, hello)
      } else if (c === 'a' && i === w.length - 1 && w.length > 1) {
        sound = 'schwa';                       // 단어 끝의 a는 힘 빠진 "어" (sofa, panda)
      } else {
        sound = SHORT_V[c];
      }
    } else if (c === 'y' && i > 0 && i < w.length - 1) {
      sound = 'short-i';                       // 단어 가운데 y는 짧은 이 (gym, myth, crystal)
    } else if (c === 'c' && 'eiy'.includes(next)) {
      sound = 'soft-c';
    } else if (c === 'g' && 'eiy'.includes(next)) {
      sound = 'soft-g';
    } else if (c === 'y' && i === w.length - 1 && w.length >= 2) {
      // 단어 끝의 y는 모음 — 앞에 다른 모음이 있으면 "이-"(city), 없으면 "아이"(fly)
      sound = /[aeiou]/.test(w.slice(0, i)) ? 'long-e' : 'long-i';
    } else {
      sound = G_SOUND[c] || null;
    }
    out.push({ text: c, sound });
    i += 1;
  }
  return applyBlendExceptions(w, out);
}

// 규칙만으로는 틀리는 낱말들 보정
const OO_SHORT_WORDS = /^(book|good|look|took|foot|wood|cook|hook|stood|wool|hood|shook|brook|crook)\w*$/;
const YOO_WORDS = /^(cute|use|used|cube|mute|fuse|huge|music|human|unit|uniform|menu|cucumber)\w*$/;
const TH_VOICED_WORDS = /^(the|this|that|these|those|they|them|then|there|their|than|though|father|mother|brother|other|weather|together|feather|leather)\w*$/;
const EY_LONG_A_WORDS = /^(they|grey|obey|prey|hey|whey|convey|survey)$/;
// ow가 "아우"가 아니라 "오우"인 낱말 (findPattern의 예외 목록과 같은 기준)
const OW_LONG_O_WORDS = /^(know|snow|show|low|slow|grow|blow|throw|crow|row|mow|tow|flow|glow|bow|own|owe|bowl|yellow|window|below|elbow|pillow|rainbow|shadow|arrow|narrow|follow|hollow|borrow|tomorrow|snowman)\w*$/;
// 위 목록의 앞부분과 겹치지만 실제로는 "아우"인 낱말 (flow→flower, show→shower)
const OW_OU_WORDS = /^(flower|power|tower|shower|towel|vowel|coward|allow|however|browse|growl|howl|owl|prowl|crowd|crown|drown|clown|frown|down|town|brown|gown)\w*$/;
// ea가 짧은 "에"인 낱말
const EA_SHORT_E_WORDS = /^(bread|head|dead|deaf|ready|already|heavy|health|breath|breakfast|sweater|feather|leather|weather|instead|meant|pleasant|treasure|measure)\w*$/;
// ie가 "이-"인 낱말 (아니면 "아이" — pie, tie, lie)
const IE_LONG_E_WORDS = /^(field|chief|piece|believe|thief|brief|niece|shield|priest|achieve|relief)\w*$/;

// 소리가 나지 않는 글자들
//   mb$  lamb, comb, thumb, climb      mn$  autumn, column
//   bt   doubt, debt                   alk/alf/alm  walk, half, calm (l 묵음 + a는 "오-")
function applySilentLetters(w, chunks) {
  const mark = (idx) => { if (chunks[idx]) { chunks[idx].sound = null; chunks[idx].silent = true; } };
  const last = chunks.length - 1;
  if (/mb$/.test(w) && chunks[last] && chunks[last].text === 'b') mark(last);
  if (/mn$/.test(w) && chunks[last] && chunks[last].text === 'n') mark(last);
  if (/bt/.test(w)) {
    const i = chunks.findIndex((c, k) => c.text === 'b' && chunks[k + 1] && chunks[k + 1].text === 't');
    if (i >= 0) mark(i);
  }
  // walk, half, calm — l이 묵음이고 a는 "오-" (almost처럼 l이 살아 있는 낱말과 구분)
  if (/^(walk|talk|chalk|stalk|half|calf|behalf|calm|palm|balm|almond|salmon)\w*$/.test(w)) {
    const i = chunks.findIndex((c, k) => c.text === 'l' && k > 0 && chunks[k - 1].text === 'a');
    if (i > 0) { mark(i); chunks[i - 1].sound = 'aw'; }
  }
  // ball, call, salt, bald — l 앞의 a는 "오-"
  if (/a(ll|lt|ld)/.test(w)) {
    const i = chunks.findIndex((c, k) => c.text === 'a' && chunks[k + 1] && chunks[k + 1].text[0] === 'l');
    if (i >= 0) chunks[i].sound = 'aw';
  }
  // old, cold, most, post / find, mind, child, wild — 모음이 길어짐
  const longVowel = (want, re, letter) => {
    if (!re.test(w)) return;
    const i = chunks.findIndex(c => c.text === letter);
    if (i >= 0) chunks[i].sound = want;
  };
  longVowel('long-o', /o(ld|lt|st|mb)$/, 'o');   // old, most, comb
  longVowel('long-i', /i(nd|ld|mb)$/, 'i');      // find, child, climb

  // apple, little, table — 끝의 le는 한 덩어리로 "을"
  const n = chunks.length;
  if (/[bcdfgkpstvz]le$/.test(w) && n >= 2 && chunks[n - 2].text === 'l' && chunks[n - 1].text === 'e') {
    chunks.splice(n - 2, 2, { text: 'le', sound: 'l' });
  }

  // nature, future — ture 앞의 모음은 길어짐
  const tureAt = chunks.findIndex(c => c.text === 'ture');
  if (tureAt > 0) {
    const v = chunks[tureAt - 1];
    if (v.text.length === 1 && 'aeiou'.includes(v.text) && LONG_V[v.text]) {
      v.sound = v.text === 'u' ? 'yoo' : LONG_V[v.text];
    }
  }

  // 과거형 -ed — jumped는 "트", played는 "드", wanted는 "이드"
  //   bed·red처럼 과거형이 아닌 짧은 낱말에는 적용하지 않는다
  const m = chunks.length;
  if (w.length >= 5 && /[a-z]ed$/.test(w) && m >= 3 && chunks[m - 1].text === 'd' && chunks[m - 2].text === 'e') {
    const before = chunks[m - 3] ? chunks[m - 3].text : '';
    const voiceless = ['p', 'k', 'c', 'f', 's', 'x', 'sh', 'ch', 'th', 'ck', 'ss', 'ff', 'ph'];
    if (before === 't' || before === 'd') {
      chunks.splice(m - 2, 2, { text: 'ed', sound: 'd', tail: 'id' });   // wanted, needed
    } else if (voiceless.includes(before)) {
      chunks.splice(m - 2, 2, { text: 'ed', sound: 't', tail: 't' });    // jumped, looked
    } else {
      chunks.splice(m - 2, 2, { text: 'ed', sound: 'd', tail: 'd' });    // played, opened
    }
  }

  // 복수형 -s — dogs는 "즈", cats는 "스"
  const k = chunks.length;
  if (k >= 2 && chunks[k - 1].text === 's' && w.length > 2) {
    const before = chunks[k - 2];
    const bt = before.text;
    const voicelessEnd = ['p', 'k', 't', 'f', 'ck', 'th', 'ph', 'tt', 'pp'];
    if (!voicelessEnd.includes(bt)) chunks[k - 1].sound = 'z';
  }
  return chunks;
}

function applyBlendExceptions(w, chunks) {
  if (OO_SHORT_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'oo') c.sound = 'oo-short';
  }
  if (YOO_WORDS.test(w)) {
    const u = chunks.find(c => c.text === 'u');
    if (u) u.sound = 'yoo';
  }
  if (TH_VOICED_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'th') c.sound = 'th-voiced';
  }
  // ey는 단어에 따라 갈림 — they/grey는 "에이", honey는 "이-"
  if (EY_LONG_A_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'ey') c.sound = 'long-a';
  }
  // ow — snow는 "오우", cow·flower는 "아우"
  if (OW_LONG_O_WORDS.test(w) && !OW_OU_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'ow') c.sound = 'long-o';
  }
  // -ation은 a가 길어짐 (nation, station) — action, fiction과 다름
  if (/ation/.test(w)) {
    const i = chunks.findIndex((c, k) => c.text === 'a' && chunks[k + 1] && chunks[k + 1].text === 'tion');
    if (i >= 0) chunks[i].sound = 'long-a';
  }
  // ea — bread는 짧은 "에", team은 "이-"
  if (EA_SHORT_E_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'ea') c.sound = 'short-e';
  }
  // ie — field는 "이-", pie는 "아이"
  if (IE_LONG_E_WORDS.test(w)) {
    for (const c of chunks) if (c.text === 'ie') c.sound = 'long-e';
  }
  // w 뒤의 ar / or — warm은 "오r", work은 "어r"
  if (/^war/.test(w)) { for (const c of chunks) if (c.text === 'ar') c.sound = 'or'; }
  if (/^wor/.test(w)) { for (const c of chunks) if (c.text === 'or') c.sound = 'er'; }
  // also, almost, always — l 앞의 a는 "오-"
  if (/^al(so|most|ways|right)/.test(w)) {
    const i = chunks.findIndex(c => c.text === 'a');
    if (i >= 0) chunks[i].sound = 'aw';
  }
  return applySilentLetters(w, chunks);
}

// ============================================================
// 소리 기준으로 단어 찾기 (파닉스 학습 탭용)
//   findPattern은 "단어 → 대표 소리 하나"만 준다.
//   여기서는 반대로 "소리 → 그 소리가 든 단어들"이 필요하므로
//   splitGraphemes로 쪼갠 조각들을 본다.
// ============================================================

/**
 * 이 단어에 이 소리가 들어 있는가
 *   단어를 소리 조각으로 쪼갠 뒤 그 안에 해당 소리가 있는지 본다.
 *   (findPattern은 단어당 "대표 소리" 하나만 주므로 fish의 짧은 i를 놓친다)
 *   예외 단어는 파닉스 연습에 쓰지 않는다.
 */
export function wordHasSound(word, soundId) {
  const w = norm(word);
  if (!w || w.length < 2) return false;
  if (IRREGULAR.has(w)) return false;
  return splitGraphemes(w).some(c => c.sound === soundId);
}

/**
 * 이 단어를 그 소리 연습에 쓸 수 있는지 검사 (단어 추가 팝업에서 안내용)
 * @returns { ok, code, text, chunks }
 *   code: 'short' | 'irregular' | 'unknown' | 'nosound' | 'ok'
 */
export function checkWordForSound(word, soundId, soundLabel = '') {
  const w = norm(word);
  if (!w || w.length < 2) {
    return { ok: false, code: 'short', text: '두 글자 이상인 영어 단어를 넣어 주세요.' };
  }
  if (IRREGULAR.has(w)) {
    return {
      ok: false, code: 'irregular',
      text: '파닉스 규칙대로 읽히지 않는 단어예요. 소리를 쪼갤 수 없어서 통째로 외우는 편이 좋아요.',
    };
  }
  const chunks = splitGraphemes(w);
  const unknown = chunks.filter(c => !c.sound && !c.silent).map(c => c.text);
  if (unknown.length) {
    return {
      ok: false, code: 'unknown', chunks,
      text: `"${unknown.join(', ')}" 가 어떤 소리인지 알 수 없어요. 소리 조각으로 나눌 수 없는 단어예요.`,
    };
  }
  if (!chunks.some(c => c.sound === soundId)) {
    return {
      ok: false, code: 'nosound', chunks,
      text: `이 단어에는 ${soundLabel || '그'} 소리가 없어요. 조각은 ${chunks.map(c => c.text).join(' · ')} 예요.`,
    };
  }
  return { ok: true, code: 'ok', chunks };
}

/** 그 소리가 단어의 첫 조각인가 (첫소리 단어를 먼저 보여 주기 위함) */
function soundAtStart(word, soundId) {
  const chunks = splitGraphemes(norm(word));
  return chunks.length > 0 && chunks[0].sound === soundId;
}

/**
 * 이 소리가 들어간 단어 모으기
 * @param soundId 소리 id
 * @param allWords 등록된 모든 단어 (아이가 이미 배운 것 우선)
 * @param extras  기본 예시 단어 (등록 단어가 모자랄 때 채움)
 * @param limit   최대 개수
 */
export function wordsForSound(soundId, allWords = [], extras = [], limit = 6) {
  const seen = new Set();
  const head = [];   // 그 소리로 시작하는 단어 (초보에게 쉬움)
  const tail = [];   // 단어 가운데·끝에 그 소리가 있는 단어
  const push = (w) => {
    const n = norm(w);
    if (!n || n.length < 2 || seen.has(n)) return;
    seen.add(n);
    (soundAtStart(n, soundId) ? head : tail).push(n);
  };
  for (const w of allWords) if (wordHasSound(w, soundId)) push(w);
  for (const w of extras) if (wordHasSound(w, soundId)) push(w);
  return [...head, ...tail].slice(0, limit);
}

/**
 * 이 단어에서 그 소리를 내는 글자 위치 (원본 단어 기준)
 * 없으면 빈 배열
 */
export function marksForSound(word, soundId) {
  const raw = word || '';
  // 정규화 위치 → 원본 위치 대응표 (공백·아포스트로피가 있어도 위치가 어긋나지 않게)
  let w = '';
  const map = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i].toLowerCase();
    if (c >= 'a' && c <= 'z') { w += c; map.push(i); }
  }
  if (!w) return [];
  const chunks = splitGraphemes(w);
  let pos = 0;
  for (const ch of chunks) {
    if (ch.whole) return [];                     // 예외 단어는 짚을 곳이 없음
    if (ch.sound === soundId) {
      const out = [];
      for (let k = 0; k < ch.text.length; k++) {
        if (map[pos + k] !== undefined) out.push(map[pos + k]);
      }
      return out;
    }
    pos += ch.text.length;
  }
  return [];
}

/** 이 소리가 "들어 있지 않은" 단어 모으기 (오답 보기용) */
export function wordsWithoutSound(soundId, pool = [], count = 2) {
  const out = [];
  const seen = new Set();
  for (const w of pool) {
    const n = norm(w);
    if (!n || n.length < 2 || seen.has(n)) continue;
    if (wordHasSound(n, soundId)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= count) break;
  }
  return out;
}
