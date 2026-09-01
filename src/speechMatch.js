// ============================================================
// 읽기 평가 판정: 원어민 발음이 아니라 "알맞은 단어를 말했는가"로 통과
// 아이 목소리는 발음 점수가 낮게 나오므로, 인식된 텍스트가 목표와 맞으면 정답 처리
// + 유사 발음 허용: ASR이 비슷한 단어로 오인식해도 통과 (fridge → bridge 등)
// ============================================================

// Azure가 숫자로 바꿔버리는 경우 복원 (four → "4")
const NUM_WORDS = { 0:'zero',1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten',11:'eleven',12:'twelve',13:'thirteen',14:'fourteen',15:'fifteen',16:'sixteen',17:'seventeen',18:'eighteen',19:'nineteen',20:'twenty',30:'thirty',40:'forty',50:'fifty',60:'sixty',70:'seventy',80:'eighty',90:'ninety',100:'hundred' };

export function normText(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b(\d+)\b/g, (m) => NUM_WORDS[Number(m)] || m) // 숫자 → 영단어
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 표기 변형·동음이의어 그룹 — 같은 그룹이면 정답 처리 (ASR이 어느 쪽으로 적어도 통과)
const HOMO_GROUPS = [
  ['okay', 'ok'], ['says', 'sez', 'say'], ['no', 'know'], ['right', 'write'],
  ['see', 'sea'], ['eight', 'ate'], ['to', 'too', 'two'], ['for', 'four'],
  ['one', 'won'], ['by', 'buy', 'bye'], ['hi', 'high'], ['here', 'hear'],
  ['there', 'their'], ['where', 'wear'], ['red', 'read'], ['blue', 'blew'],
  ['sun', 'son'], ['i', 'eye'], ['be', 'bee'], ['meet', 'meat'],
  ['week', 'weak'], ['flower', 'flour'], ['hair', 'hare'], ['pair', 'pear'],
  ['tail', 'tale'], ['sail', 'sale'], ['made', 'maid'], ['mail', 'male'],
  ['night', 'knight'], ['new', 'knew'], ['hour', 'our'], ['would', 'wood'],
  ['grey', 'gray'], ['aunt', 'ant'], ['deer', 'dear'], ['plane', 'plain'],
];
const HOMO_MAP = (() => { const m = {}; HOMO_GROUPS.forEach(g => g.forEach(w => { m[w] = g[0]; })); return m; })();
const canon = (w) => HOMO_MAP[w] || w;

// 편집 거리 (Levenshtein) — 두 단어가 몇 글자 다른지
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// 단어 길이에 따른 허용 오차: 3글자 이하 정확히, 4~6글자 1글자, 7글자+ 2글자
function tolerance(word) {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

// 두 단어가 "같다고 봐줄 수 있는가" (ASR 오인식 허용)
export function fuzzyEq(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  return lev(a, b) <= Math.min(tolerance(a), tolerance(b) + 1);
}

// 인식 토큰들 중 target 단어와 (유사)일치하는 게 있는지 (동음이의어·표기 변형 포함)
// + 아이가 음절을 늘려 말해 한 단어가 두 토큰으로 쪼개진 경우("퍼~스트" → "fur st")도
//   인접 토큰을 이어붙여 유사 비교로 잡아냄
function tokenMatch(tokens, word) {
  const cw = canon(word);
  if (tokens.some(tk => canon(tk) === cw || fuzzyEq(tk, word))) return true;
  // 인접 2~3개 토큰 병합 후 재시도 (단어가 쪼개져 인식된 경우)
  for (let i = 0; i < tokens.length - 1; i++) {
    const two = tokens[i] + tokens[i + 1];
    if (two === word || fuzzyEq(two, word)) return true;
    if (i < tokens.length - 2) {
      const three = two + tokens[i + 2];
      if (three === word || fuzzyEq(three, word)) return true;
    }
  }
  return false;
}

// recognized(인식 텍스트)가 target(목표 단어/문장)과 맞는지
// - 단어(1개): 인식 토큰과 (유사)일치하거나 문자열에 포함되면 통과
// - 문장(여러 단어): 목표 단어 중 ratio(기본 60%) 이상이 (유사)인식되면 통과
export function isSpeechMatch(recognized, target, ratio = 0.6) {
  const t = normText(target).split(' ').filter(Boolean);
  if (t.length === 0) return false;
  const r = normText(recognized);
  const rtokens = r.split(' ').filter(Boolean);
  if (t.length === 1) {
    return tokenMatch(rtokens, t[0]) || r.replace(/\s/g, '').includes(t[0]);
  }
  const matched = t.filter(w => tokenMatch(rtokens, w)).length;
  return matched / t.length >= ratio;
}

// 목표 단어별 인식 여부 (문장 평가 피드백용)
export function matchedWords(recognized, target) {
  const rtokens = normText(recognized).split(' ').filter(Boolean);
  return normText(target).split(' ').filter(Boolean).map(w => ({ word: w, ok: tokenMatch(rtokens, w) }));
}
