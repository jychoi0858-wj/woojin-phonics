// ============================================================
// 영어 단어 음절 분리 유틸리티
// CMU Pronouncing Dictionary + IPA 변환
// ============================================================

let cmuDict = null;

function getCmuDict() {
  if (cmuDict === null) {
    try {
      const mod = require('cmu-pronouncing-dictionary');
      // 모듈이 { dictionary: {...} } 형태로 내보냄 → 실제 사전 객체를 꺼냄
      cmuDict = mod.dictionary || mod.default || mod;
    } catch (e) {
      cmuDict = {};
      console.warn('CMU 발음 사전 미설치. npm install cmu-pronouncing-dictionary 를 실행하세요.');
    }
  }
  return cmuDict;
}

// ─── CMU 음소 → IPA 변환 맵 ───
const CMU_TO_IPA = {
  'AA': 'ɑ', 'AE': 'æ', 'AH': 'ə', 'AO': 'ɔ', 'AW': 'aʊ', 'AY': 'aɪ',
  'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð',
  'EH': 'ɛ', 'ER': 'ɝ', 'EY': 'eɪ',
  'F': 'f', 'G': 'ɡ', 'HH': 'h',
  'IH': 'ɪ', 'IY': 'i',
  'JH': 'dʒ', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ',
  'OW': 'oʊ', 'OY': 'ɔɪ',
  'P': 'p', 'R': 'ɹ', 'S': 's', 'SH': 'ʃ',
  'T': 't', 'TH': 'θ',
  'UH': 'ʊ', 'UW': 'u',
  'V': 'v', 'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ'
};

// 강세 표시가 있는 모음 특별 처리
const STRESSED_VOWELS = {
  'AH1': 'ʌ', 'AH2': 'ə', 'AH0': 'ə'
};

function cmuToIpa(phoneme) {
  if (STRESSED_VOWELS[phoneme]) return STRESSED_VOWELS[phoneme];
  const base = phoneme.replace(/[0-2]$/, '');
  return CMU_TO_IPA[base] || phoneme.toLowerCase();
}

function isVowelPhoneme(p) {
  return /[0-2]$/.test(p);
}

// 음소 단위 onset 블렌드 (다음 음절 첫소리로 함께 가는 자음 묶음)
const ONSET_BLEND_PHONEMES = new Set([
  'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F',
  'P R', 'P L', 'B R', 'B L', 'T R', 'D R', 'K R', 'K L', 'G R', 'G L',
  'F R', 'F L', 'TH R', 'SH R',
  'S P R', 'S T R', 'S K R', 'S P L', 'S K W',
]);

// ─── CMU 음소를 음절 단위로 분리 ───
function splitPhonemesIntoSyllables(phonemeStr) {
  const phonemes = phonemeStr.split(' ');

  // 모음 위치 찾기
  const vowelPositions = [];
  phonemes.forEach((p, i) => {
    if (isVowelPhoneme(p)) vowelPositions.push(i);
  });

  if (vowelPositions.length <= 1) return [phonemes];

  // 모음 사이 자음 분배로 분리점 결정
  const splitPoints = [];
  for (let v = 0; v < vowelPositions.length - 1; v++) {
    const currVowel = vowelPositions[v];
    const nextVowel = vowelPositions[v + 1];
    const gapSize = nextVowel - currVowel - 1;

    if (gapSize === 0) {
      splitPoints.push(nextVowel);
    } else if (gapSize === 1) {
      const consonant = phonemes[currVowel + 1];
      // R, L은 앞 모음과 함께 (영어 특성: rhotic, lateral)
      if (consonant === 'R' || consonant === 'L') {
        splitPoints.push(currVowel + 2); // R/L 뒤에서 분리
      } else {
        splitPoints.push(currVowel + 1); // 자음은 다음 음절로
      }
    } else {
      // 자음 2개 이상: onset 블렌드(sp, st, tr…)면 통째로 다음 음절로,
      // 아니면 마지막 1개만 다음 음절 (철자 분리 규칙과 일치시킴)
      let splitAt = nextVowel - 1;
      for (let len = Math.min(3, gapSize); len >= 2; len--) {
        const cluster = phonemes.slice(nextVowel - len, nextVowel).join(' ');
        if (ONSET_BLEND_PHONEMES.has(cluster)) { splitAt = nextVowel - len; break; }
      }
      if (splitAt <= currVowel) splitAt = currVowel + 1;
      splitPoints.push(splitAt);
    }
  }

  const syllables = [];
  let prev = 0;
  for (const sp of splitPoints) {
    syllables.push(phonemes.slice(prev, sp));
    prev = sp;
  }
  syllables.push(phonemes.slice(prev));

  return syllables;
}

// ─── 음소 배열 → IPA 문자열 변환 ───
function phonemesToIpa(phonemeArr) {
  return phonemeArr.map(cmuToIpa).join('');
}

// ─── 스펠링을 음절 수에 맞춰 분리 (음소 비율 기반) ───
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const ONSET_BLENDS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr',
  'ph', 'pl', 'pr', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st',
  'sw', 'th', 'tr', 'tw', 'wr', 'wh',
  'str', 'spl', 'spr', 'scr', 'shr', 'squ'
]);

function isVowelLetter(c) { return VOWELS.has(c); }

function splitSpellingBySyllableCount(word, targetCount) {
  if (targetCount <= 1) return [word];

  // 모음 클러스터 위치 찾기
  const clusters = [];
  let i = 0;
  while (i < word.length) {
    if (isVowelLetter(word[i])) {
      const start = i;
      while (i < word.length && isVowelLetter(word[i])) i++;
      clusters.push({ start, end: i - 1 });
    } else {
      i++;
    }
  }

  // 묵음 e 처리
  if (clusters.length > targetCount) {
    const last = clusters[clusters.length - 1];
    if (last.start === last.end && last.start === word.length - 1 && word[last.start] === 'e') {
      clusters.pop();
    }
  }

  // 모음 클러스터가 부족하면 기본 분리
  if (clusters.length < targetCount) {
    return evenSplit(word, targetCount);
  }

  // 모음 클러스터가 목표보다 많으면 인접한 것을 합침
  while (clusters.length > targetCount) {
    // 가장 가까운 두 클러스터를 합침
    let minGap = Infinity, mergeIdx = 0;
    for (let c = 0; c < clusters.length - 1; c++) {
      const gap = clusters[c + 1].start - clusters[c].end;
      if (gap < minGap) { minGap = gap; mergeIdx = c; }
    }
    clusters[mergeIdx].end = clusters[mergeIdx + 1].end;
    clusters.splice(mergeIdx + 1, 1);
  }

  // 모음 클러스터 사이에서 분리점 결정
  const splits = [];
  for (let c = 0; c < clusters.length - 1; c++) {
    const vowelEnd = clusters[c].end;
    const nextVowelStart = clusters[c + 1].start;
    const gapSize = nextVowelStart - vowelEnd - 1;

    if (gapSize === 0) {
      splits.push(nextVowelStart);
    } else if (gapSize === 1) {
      const consonant = word[vowelEnd + 1];
      // r, l은 앞 모음과 함께 (음소 분리와 일관되게)
      if (consonant === 'r' || consonant === 'l') {
        splits.push(vowelEnd + 2);
      } else {
        splits.push(vowelEnd + 1);
      }
    } else {
      let splitAt = nextVowelStart - 1;
      // onset blend 확인
      for (let len = Math.min(3, gapSize); len >= 2; len--) {
        const possibleBlend = word.slice(nextVowelStart - len, nextVowelStart);
        if (ONSET_BLENDS.has(possibleBlend)) {
          splitAt = nextVowelStart - len;
          break;
        }
      }
      if (splitAt <= vowelEnd) splitAt = vowelEnd + 2;
      splits.push(splitAt);
    }
  }

  const result = [];
  let prev = 0;
  for (const sp of splits) {
    result.push(word.slice(prev, sp));
    prev = sp;
  }
  result.push(word.slice(prev));

  return result.filter(s => s.length > 0);
}

function evenSplit(word, count) {
  const chunkSize = Math.ceil(word.length / count);
  const result = [];
  for (let i = 0; i < word.length; i += chunkSize) {
    result.push(word.slice(i, i + chunkSize));
  }
  return result;
}

// ─── 모음 클러스터 수로 음절 수 추정 ───
function estimateSyllableCount(word) {
  const clusters = [];
  let i = 0;
  while (i < word.length) {
    if (isVowelLetter(word[i])) {
      const start = i;
      while (i < word.length && isVowelLetter(word[i])) i++;
      clusters.push({ start, end: i - 1 });
    } else {
      i++;
    }
  }
  // 묵음 e 처리
  if (clusters.length > 1) {
    const last = clusters[clusters.length - 1];
    if (last.start === last.end && last.start === word.length - 1 && word[last.start] === 'e') {
      clusters.pop();
    }
  }
  return Math.max(1, clusters.length);
}

// ─── 메인 함수: 규칙 기반 분리 (CMU 없을 때) ───
function splitSpellingRuleBased(word) {
  // 자음+le 패턴 (ta-ble, ap-ple)
  const cleMatch = word.match(/([^aeiouy])le$/);
  if (cleMatch && word.length > 3) {
    const suffix = cleMatch[0];
    const stem = word.slice(0, -suffix.length);
    if (stem.length > 0 && [...stem].some(c => isVowelLetter(c))) {
      const stemCount = estimateSyllableCount(stem);
      const stemSyllables = splitSpellingBySyllableCount(stem, stemCount);
      return [...stemSyllables.map(s => ({ text: s, ipa: null })), { text: suffix, ipa: null }];
    }
  }
  const count = estimateSyllableCount(word);
  const parts = splitSpellingBySyllableCount(word, count);
  return parts.map(s => ({ text: s, ipa: null }));
}

// ============================================================
// 외부 공개 함수
// ============================================================

/**
 * 영어 단어를 음절 단위로 분리
 * @param {string} word - 영어 단어
 * @returns {Array<{text: string, ipa: string|null}>}
 *   - text: 스펠링 조각 (예: "grand", "par", "ents")
 *   - ipa: IPA 발음 기호 (예: "ɡɹænd", "pɛɹ", "ənts") — CMU 데이터 없으면 null
 */
export function splitIntoSyllables(word) {
  if (!word) return [];
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length <= 2) return [{ text: clean, ipa: null }];

  // CMU 사전에서 음소 조회
  const dict = getCmuDict();
  const phonemeStr = dict[clean];

  if (!phonemeStr) {
    // CMU에 없으면 규칙 기반
    return splitSpellingRuleBased(clean);
  }

  // CMU 음소 → 음절 분리
  const phonemeSyllables = splitPhonemesIntoSyllables(phonemeStr);
  const syllableCount = phonemeSyllables.length;

  // 각 음절의 IPA 생성
  const ipas = phonemeSyllables.map(phonemesToIpa);

  // 스펠링을 음절 수에 맞춰 분리
  const spellingParts = splitSpellingBySyllableCount(clean, syllableCount);

  // 스펠링과 IPA를 매칭
  const result = [];
  for (let i = 0; i < syllableCount; i++) {
    result.push({
      text: spellingParts[i] || '',
      ipa: ipas[i] || null
    });
  }

  return result.filter(s => s.text.length > 0);
}

/**
 * 단어의 음절 수 반환
 */
export function getSyllableCount(word) {
  return splitIntoSyllables(word).length;
}

/**
 * 단어를 음소(phoneme) 단위 IPA 배열로 반환 (파닉스 소리내기용)
 * 예: "door" → ["d", "ɔ", "ɹ"]
 * CMU 사전에 없으면 null
 */
export function getIpaPhonemes(word) {
  if (!word) return null;
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  const dict = getCmuDict();
  const phonemeStr = dict[clean];
  if (!phonemeStr) return null;
  return phonemeStr.split(' ').map(cmuToIpa).filter(Boolean);
}
