import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { splitIntoSyllables } from './syllableUtils';
import { addSpeechUsageFirestore } from './firebase';
import { getCachedAudio, setCachedAudio, playCachedAudio, makeCacheKey, unlockAudio, stopCachedAudio } from './ttsCache';
import SongModal from './SongModal';
import SentenceSetCourse from './SentenceSetCourse';
import SlingshotGame from './SlingshotGame';
import SliceGame from './SliceGame';
import { isSpeechMatch, matchedWords } from './speechMatch';
import { isWeakStat, reasonList } from './learningStats';
import { sortLessons } from './lessonSort';
import useBackHandler from './useBackHandler';
import { showNotice, VOICE_MSG } from './notice';
import FireworksCelebration from './FireworksCelebration';

// ─── 단일 글자 파닉스 IPA (알파벳 소리) ───
const PHONICS_IPA = {
  'a': 'æ', 'b': 'b', 'c': 'k', 'd': 'd', 'e': 'ɛ', 'f': 'f',
  'g': 'ɡ', 'h': 'h', 'i': 'ɪ', 'j': 'dʒ', 'k': 'k', 'l': 'l',
  'm': 'm', 'n': 'n', 'o': 'ɑ', 'p': 'p', 'q': 'kw', 'r': 'ɹ',
  's': 's', 't': 't', 'u': 'ʌ', 'v': 'v', 'w': 'w', 'x': 'ks',
  'y': 'j', 'z': 'z'
};

// ─── 활성 Azure Synthesizer 추적 (외부에서 중지 가능) ───
let _activeSynthesizer = null;
let _speakCancelled = false;

function cancelAllSpeak() {
  _speakCancelled = true;
  if (_activeSynthesizer) {
    try { _activeSynthesizer.close(); } catch (e) { /* ignore */ }
    _activeSynthesizer = null;
  }
}

function resetSpeakCancel() {
  _speakCancelled = false;
}

// ─── Azure TTS 헬퍼 (캐시 + 오디오 디바이스 해제 대기) ───
async function speakAzure(text, azureKey, azureRegion, azureVoice, rate = '-10%', ttsLimitReached = false) {
  if (_speakCancelled) return;
  const cacheKey = makeCacheKey(text, azureVoice, rate);

  // 캐시 확인 — 히트 시 Azure 호출 없이 재생
  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    if (_speakCancelled) return;
    await playCachedAudio(cached);
    return;
  }

  // TTS 제한 체크 (캐시 미스일 때만)
  if (ttsLimitReached) {
    console.warn('TTS 제한 초과');
    showNotice(VOICE_MSG.limit); // 조용히 무음이 되지 않게 안내
    return;
  }

  // 캐시 미스 — Azure 호출 (null = 직접 재생 안 함, 데이터만 받음)
  addSpeechUsageFirestore(text.length);
  return new Promise((resolve) => {
    const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    sc.speechSynthesisVoiceName = azureVoice;
    const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
    _activeSynthesizer = synthesizer;

    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${azureVoice}">
        <prosody rate="${rate}">${text}</prosody>
      </voice>
    </speak>`;

    synthesizer.speakSsmlAsync(ssml,
      (result) => {
        _activeSynthesizer = null;
        synthesizer.close();
        if (_speakCancelled) { resolve(); return; }
        if (result.audioData && result.audioData.byteLength > 0) {
          const audioArr = new Uint8Array(result.audioData);
          setCachedAudio(cacheKey, audioArr);
          playCachedAudio(audioArr).then(() => setTimeout(resolve, 150));
        } else {
          showNotice(VOICE_MSG.fail);
          setTimeout(resolve, 150);
        }
      },
      (error) => {
        _activeSynthesizer = null; synthesizer.close();
        console.error('Azure TTS 에러:', error);
        showNotice(VOICE_MSG.network);
        setTimeout(resolve, 150);
      }
    );
  });
}


// ─── Azure TTS 호환 IPA 변환 ───
// CMU 사전의 일부 IPA 기호가 Azure에서 지원되지 않아 합성이 취소됨
function sanitizeIpa(ipa) {
  return ipa
    .replace(/ɹ/g, 'r')     // turned r → 일반 r
    .replace(/ɝ/g, 'ər')    // r-colored schwa → schwa + r
    .replace(/ɡ/g, 'g')     // script g → 일반 g
    .replace(/ˈ/g, '')      // 강세 기호 제거 (짧은 음절에서 오류 유발)
    .replace(/ˌ/g, '');     // 부강세 기호 제거
}

// ─── IPA 발음 기호로 정확한 음절 발음 (캐시 + Azure TTS) ───
async function speakWithIpa(displayText, ipa, azureKey, azureRegion, azureVoice, rate = '-20%', ttsLimitReached = false) {
  if (_speakCancelled) return;
  const cacheKey = makeCacheKey(displayText, azureVoice, rate, ipa);

  // 캐시 확인
  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    if (_speakCancelled) return;
    await playCachedAudio(cached);
    return;
  }

  // TTS 제한 체크 (캐시 미스일 때만)
  if (ttsLimitReached) {
    console.warn('TTS 제한 초과');
    showNotice(VOICE_MSG.limit); // 조용히 무음이 되지 않게 안내
    return;
  }

  // 캐시 미스 — Azure 호출 (null = 직접 재생 안 함)
  addSpeechUsageFirestore(displayText.length);
  return new Promise((resolve) => {
    const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    sc.speechSynthesisVoiceName = azureVoice;
    const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
    _activeSynthesizer = synthesizer;

    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${azureVoice}">
        <prosody rate="${rate}">
          <phoneme alphabet="ipa" ph="${sanitizeIpa(ipa)}">${displayText}</phoneme>
        </prosody>
      </voice>
    </speak>`;

    synthesizer.speakSsmlAsync(ssml,
      (result) => {
        _activeSynthesizer = null;
        synthesizer.close();
        if (_speakCancelled) { resolve(); return; }
        if (result.reason === speechsdk.ResultReason.Canceled) {
          console.warn('IPA 합성 취소됨, 폴백 시도:', displayText);
          // 짧은 음절은 x-sampa로 재시도, 그래도 안 되면 텍스트 폴백
          speakAzureSyllable(displayText, ipa, azureKey, azureRegion, azureVoice, rate).then(resolve);
        } else if (result.audioData && result.audioData.byteLength > 0) {
          const audioArr = new Uint8Array(result.audioData);
          setCachedAudio(cacheKey, audioArr);
          playCachedAudio(audioArr).then(() => setTimeout(resolve, 150));
        } else {
          setTimeout(resolve, 150);
        }
      },
      (error) => {
        console.warn('IPA TTS 실패, 폴백 시도:', error);
        synthesizer.close();
        speakAzureSyllable(displayText, ipa, azureKey, azureRegion, azureVoice, rate).then(resolve);
      }
    );
  });
}

// ─── 짧은 음절 폴백: 단독 글자가 알파벳 이름으로 읽히지 않도록 처리 ───
async function speakAzureSyllable(text, ipa, azureKey, azureRegion, azureVoice, rate) {
  if (_speakCancelled) return;
  // 방법: x-sampa (Microsoft 호환 음성기호)로 재시도
  const xsampa = ipaToXsampa(ipa);
  if (xsampa) {
    const cacheKey = makeCacheKey(text, azureVoice, rate, 'xs_' + xsampa);
    const cached = await getCachedAudio(cacheKey);
    if (cached) { if (_speakCancelled) return; await playCachedAudio(cached); return; }

    addSpeechUsageFirestore(text.length);
    return new Promise((resolve) => {
      const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      sc.speechSynthesisVoiceName = azureVoice;
      const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
      _activeSynthesizer = synthesizer;
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${azureVoice}">
          <prosody rate="${rate}">
            <phoneme alphabet="x-microsoft-ups" ph="${xsampa}">${text}</phoneme>
          </prosody>
        </voice>
      </speak>`;
      synthesizer.speakSsmlAsync(ssml,
        (result) => {
          _activeSynthesizer = null;
          synthesizer.close();
          if (_speakCancelled) { resolve(); return; }
          if (result.audioData && result.audioData.byteLength > 0 && result.reason !== speechsdk.ResultReason.Canceled) {
            const audioArr = new Uint8Array(result.audioData);
            setCachedAudio(cacheKey, audioArr);
            playCachedAudio(audioArr).then(() => setTimeout(resolve, 150));
          } else {
            // 최종 폴백: 원래 speakAzure
            speakAzure(text, azureKey, azureRegion, azureVoice, rate).then(resolve);
          }
        },
        () => {
          _activeSynthesizer = null;
          synthesizer.close();
          if (_speakCancelled) { resolve(); return; }
          speakAzure(text, azureKey, azureRegion, azureVoice, rate).then(resolve);
        }
      );
    });
  }
  // x-sampa 변환 불가 시 일반 텍스트
  return speakAzure(text, azureKey, azureRegion, azureVoice, rate);
}

// ─── IPA → Microsoft UPS 변환 (Azure 호환) ───
function ipaToXsampa(ipa) {
  if (!ipa) return null;
  const map = {
    'ɑ': 'AA', 'æ': 'AE', 'ə': 'AX', 'ʌ': 'AH', 'ɔ': 'AO',
    'aʊ': 'AW', 'aɪ': 'AY', 'ɛ': 'EH', 'eɪ': 'EY',
    'ɪ': 'IH', 'i': 'IY', 'oʊ': 'OW', 'ɔɪ': 'OY',
    'ʊ': 'UH', 'u': 'UW', 'ər': 'AXR', 'ɝ': 'AXR', 'ɚ': 'AXR',
    'b': 'B', 'd': 'D', 'f': 'F', 'g': 'G', 'ɡ': 'G',
    'h': 'HH', 'dʒ': 'JH', 'k': 'K', 'l': 'L', 'm': 'M',
    'n': 'N', 'ŋ': 'NG', 'p': 'P', 'r': 'R', 'ɹ': 'R',
    's': 'S', 'ʃ': 'SH', 't': 'T', 'θ': 'TH', 'ð': 'DH',
    'v': 'V', 'w': 'W', 'j': 'Y', 'z': 'Z', 'ʒ': 'ZH',
    'tʃ': 'CH'
  };

  let result = '';
  let i = 0;
  while (i < ipa.length) {
    // 2글자 매칭 먼저
    if (i + 1 < ipa.length && map[ipa.substring(i, i + 2)]) {
      result += ' ' + map[ipa.substring(i, i + 2)];
      i += 2;
    } else if (map[ipa[i]]) {
      result += ' ' + map[ipa[i]];
      i++;
    } else {
      i++; // 알 수 없는 문자 스킵
    }
  }
  return result.trim() || null;
}

// ─── 퀴즈 효과음 (Web Audio API) ───
function _getQuizAudioCtx() {
  if (!window._quizAudioCtx) {
    window._quizAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (window._quizAudioCtx.state === 'suspended') window._quizAudioCtx.resume();
  return window._quizAudioCtx;
}

function playTone(freq, duration, type = 'sine', vol = 0.25) {
  try {
    const ctx = _getQuizAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* ignore */ }
}

function sfxCorrect() {
  // 짧은 상승음 (띵!)
  playTone(523, 0.12, 'sine', 0.3);      // C5
  setTimeout(() => playTone(659, 0.12, 'sine', 0.3), 80);  // E5
  setTimeout(() => playTone(784, 0.18, 'sine', 0.3), 160);  // G5
}

function sfxWrong() {
  // 낮은 버저음
  playTone(200, 0.25, 'square', 0.15);
  setTimeout(() => playTone(160, 0.3, 'square', 0.12), 150);
}

function sfxComplete() {
  // 문장 완성 — 밝은 아르페지오
  playTone(523, 0.15, 'sine', 0.25);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.25), 100);
  setTimeout(() => playTone(784, 0.15, 'sine', 0.25), 200);
  setTimeout(() => playTone(1047, 0.3, 'sine', 0.3), 300);
}

function sfxFinish() {
  // 퀴즈 완료 — 팡파레
  const notes = [523, 659, 784, 1047, 784, 1047, 1319];
  notes.forEach((f, i) => {
    setTimeout(() => playTone(f, 0.2, 'sine', 0.25), i * 110);
  });
}

// ─── 브라우저 TTS 폴백 ───
function speakBrowser(text) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    const voices = synth.getVoices();
    let voice = voices.find(v => v.name === 'Google US English');
    if (!voice) voice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
    if (voice) utterance.voice = voice;
    const timeout = setTimeout(resolve, 5000);
    utterance.onend = () => { clearTimeout(timeout); resolve(); };
    utterance.onerror = () => { clearTimeout(timeout); resolve(); };
    synth.speak(utterance);
  });
}

// ============================================================
// 메인 문장 학습 컴포넌트
// ============================================================
export default function SentenceLearning({
  sentenceData,
  selectedYear, selectedMonth,
  handleYearChange, handleMonthChange,
  azureKey, azureRegion, azureVerified, azureVoice,
  onGoAdmin,
  ttsLimitReached = false,
  youtubeKey, addSongToDay, removeSongFromDay,
  onQuizCleared, onGameCleared, onSentenceResult,
  lessonSortKey = 'name', lessonSortOrder = 'asc'
}) {
  const currentKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const days = useMemo(() => sentenceData[currentKey] || [], [sentenceData, currentKey]);

  const [selectedDayIndex, setSelectedDayIndex] = useState(-1);
  const [selectedSentenceIdx, setSelectedSentenceIdx] = useState(-1);
  const [selectedWord, setSelectedWord] = useState(null);
  const [syllables, setSyllables] = useState([]);
  const [playingType, setPlayingType] = useState(null); // 'syllable-0', 'word', 'sentence'
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [syllableGap, setSyllableGap] = useState(1); // 음절 간 인터벌(초)
  const [repeatCount, setRepeatCount] = useState(1); // 반복 횟수
  const [sentenceSpeed, setSentenceSpeed] = useState('-20%'); // 문장 재생 속도
  const [showDetail, setShowDetail] = useState(false); // 끊어 읽기 팝업
  const [showSong, setShowSong] = useState(false); // 레슨 노래 팝업
  const [courseView, setCourseView] = useState(false); // 문장 세트학습 모드
  const [showGame, setShowGame] = useState(false); // 단어 새총 게임
  const [showSlice, setShowSlice] = useState(false); // 문장 베기 게임
  const [rangeStart, setRangeStart] = useState(null); // 범위 선택 시작 인덱스
  const [rangeEnd, setRangeEnd] = useState(null); // 범위 선택 끝 인덱스
  const isDraggingRange = useRef(false); // 드래그 중 여부
  const [showAssessPopup, setShowAssessPopup] = useState(false); // 읽기 평가 팝업
  const [showQuiz, setShowQuiz] = useState(false); // 단어 퀴즈 팝업
  const [openMeaningIdx, setOpenMeaningIdx] = useState(-1); // 한글 뜻을 펼친 문장 (기본 숨김)
  const [whySentence, setWhySentence] = useState(null);     // ⚠️ 눌렀을 때 이유 팝업
  const gameFromCourseRef = useRef(false); // 게임이 세트학습에서 열렸는가 (메달은 이 경우에만)

  // 뒤로가기: 팝업/세트학습을 한 단계씩 닫기 (App의 핸들러보다 먼저 처리됨)
  useBackHandler(() => {
    if (showSlice) { setShowSlice(false); return true; }
    if (showGame) { setShowGame(false); return true; }
    if (showSong) { setShowSong(false); return true; }
    if (showQuiz) { setShowQuiz(false); return true; }
    if (showAssessPopup) { closeAssessPopup(); return true; } // 마이크·인식도 함께 정리
    if (showDetail) { setShowDetail(false); return true; }
    if (courseView) { setCourseView(false); return true; }
    return false; // 문장학습 첫 화면 — App 쪽에서 처리
  });
  const [quizQuestions, setQuizQuestions] = useState([]); // 퀴즈 문제 배열
  const [quizIndex, setQuizIndex] = useState(0); // 현재 문제 인덱스
  const [quizScore, setQuizScore] = useState(0); // 맞은 개수
  const [quizFinished, setQuizFinished] = useState(false); // 퀴즈 완료 여부
  const [quizAnswers, setQuizAnswers] = useState({}); // { blankIdx: word } 현재 문제의 빈칸에 넣은 답
  const [quizFeedback, setQuizFeedback] = useState(null); // 'correct' | 'wrong' | null
  const [dragWord, setDragWord] = useState(null); // 현재 드래그 중인 단어
  const [dragOverBlank, setDragOverBlank] = useState(null); // 드래그가 올라간 빈칸 인덱스
  const [quizPlayingSentence, setQuizPlayingSentence] = useState(false); // 퀴즈에서 문장 재생 중
  const dragGhostRef = useRef(null); // 터치 드래그 시 따라다니는 고스트 엘리먼트
  const [contentScale, setContentScale] = useState(() => {
    const saved = localStorage.getItem('sl-content-scale');
    return saved ? parseFloat(saved) : 1;
  });


  // 발음 평가 상태
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessReady, setAssessReady] = useState(false); // 마이크 녹음 준비 완료 여부
  const [passThreshold, setPassThreshold] = useState(() => parseInt(localStorage.getItem('woojin-pass-threshold')) || 60); // 합격 점수(난이도)
  const [assessResult, setAssessResult] = useState(null); // {overallScore, words: [{word, score, errorType}]}
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null); // 녹음 재생용 URL
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const recognizerRef = useRef(null);
  const assessTextRef = useRef('');       // 연속 인식으로 모은 텍스트
  const assessScoresRef = useRef([]);     // 발음 점수(발음판정 모드)
  const assessTimeoutRef = useRef(null);  // 2분 안전장치
  const assessStreamRef = useRef(null);   // 마이크 스트림 (해제 보장)
  const noSpeechTimerRef = useRef(null);  // 30초 무발화 종료
  const assessTargetRef = useRef('');     // 채점 기준 문장 (시작 시점 고정)
  const assessBusyRef = useRef(false);    // 진행/종료 중복 방지
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordedAudioRef = useRef(null); // Audio element for playback
  const assessResultRef = useRef(null); // 결과 영역 스크롤용
  const isPlayingAllRef = useRef(false);
  const playingTypeRef = useRef(null);

  const selectedDay = days[selectedDayIndex] || null;
  const sentences = selectedDay?.sentences || [];
  const currentSentence = selectedSentenceIdx >= 0 ? (sentences[selectedSentenceIdx] || '') : '';

  // 문장을 단어 단위로 분리
  const words = currentSentence.split(/\s+/).filter(Boolean);

  // TTS 헬퍼
  const speak = (text, rate) => {
    if (azureVerified && azureKey && azureRegion) {
      return speakAzure(text, azureKey, azureRegion, azureVoice, rate, ttsLimitReached);
    }
    return speakBrowser(text);
  };

  // ─── Lesson 선택 ───
  const handleDaySelect = (idx) => {
    setSelectedDayIndex(idx);
    setSelectedSentenceIdx(-1);
    setSelectedWord(null);
    setSyllables([]);
    setCourseView(false);
  };

  // ─── 문장 선택 ───
  const handleSentenceSelect = (idx) => {
    setSelectedSentenceIdx(idx);
    setSelectedWord(null);
    setSyllables([]);
  };

  // ─── 문장 자동 반복 재생 (반복 횟수만큼, 인터벌 1초 고정) ───
  const playMainSentence = async (idx, text) => {
    handleSentenceSelect(idx);
    resetSpeakCancel();
    playingTypeRef.current = 'sentence';
    setPlayingType('sentence');
    const times = Math.max(1, repeatCount);
    for (let r = 0; r < times; r++) {
      if (playingTypeRef.current !== 'sentence') break;
      await speak(text, sentenceSpeed);
      if (r < times - 1 && playingTypeRef.current === 'sentence') {
        await new Promise(res => setTimeout(res, 1000)); // 인터벌 1초 고정
      }
    }
    setPlayingType(null);
    playingTypeRef.current = null;
  };

  // ─── 단어 클릭 → 음절 분리 ───
  const handleWordClick = (word) => {
    const clean = word.replace(/[^a-zA-Z']/g, '');
    if (!clean || clean.length <= 1) return;
    setSelectedWord(word);
    setSyllables(splitIntoSyllables(clean));
  };

  // ─── 음절 하나 듣기 (IPA 있으면 정확한 발음, 없으면 텍스트 기반) ───
  const speakSyllable = async (syl) => {
    if (azureVerified && azureKey && azureRegion && syl.ipa) {
      return speakWithIpa(syl.text, syl.ipa, azureKey, azureRegion, azureVoice, '-20%', ttsLimitReached);
    }
    return speak(syl.text, '-20%');
  };

  const handleSyllableClick = async (syl, index) => {
    unlockAudio();
    resetSpeakCancel();
    setPlayingType(`syllable-${index}`);
    await speakSyllable(syl);
    setPlayingType(null);
  };

  // ─── 단어 전체 듣기 (반복 지원) ───
  const handleWordListen = async () => {
    unlockAudio();
    resetSpeakCancel();
    if (!selectedWord) return;
    const clean = selectedWord.replace(/[^a-zA-Z']/g, '');
    playingTypeRef.current = 'word';
    setPlayingType('word');
    for (let r = 0; r < repeatCount; r++) {
      if (!playingTypeRef.current) break;
      await speak(clean, '-10%');
      if (r < repeatCount - 1 && playingTypeRef.current) {
        await new Promise(res => setTimeout(res, syllableGap * 1000));
      }
    }
    playingTypeRef.current = null;
    setPlayingType(null);
  };

  // ─── 음절 순서대로 재생 (반복 지원) ───
  const handlePlayAllSyllables = async () => {
    unlockAudio();
    resetSpeakCancel();
    if (isPlayingAll) return;
    isPlayingAllRef.current = true;
    setIsPlayingAll(true);
    for (let r = 0; r < repeatCount; r++) {
      for (let i = 0; i < syllables.length; i++) {
        if (!isPlayingAllRef.current) { setPlayingType(null); setIsPlayingAll(false); return; }
        setPlayingType(`syllable-${i}`);
        await speakSyllable(syllables[i]);
        if (i < syllables.length - 1 || r < repeatCount - 1) {
          await new Promise(res => setTimeout(res, syllableGap * 1000));
        }
      }
    }
    setPlayingType(null);
    isPlayingAllRef.current = false;
    setIsPlayingAll(false);
  };

  // ─── 문장 전체 듣기 ───
  const handleSentenceListen = async () => {
    resetSpeakCancel();
    setPlayingType('sentence');
    await speak(currentSentence, sentenceSpeed);
    setPlayingType(null);
  };

  // ─── 끊어 읽기 팝업 문장 듣기 ───
  // 드래그 바 — 범위 선택 핸들러
  const getIdxFromPoint = (x, y) => {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el.dataset && el.dataset.rangeidx !== undefined) {
        return parseInt(el.dataset.rangeidx);
      }
    }
    return null;
  };

  const handleBarTouchStart = (e) => {
    const touch = e.touches[0];
    const idx = getIdxFromPoint(touch.clientX, touch.clientY);
    if (idx !== null) {
      isDraggingRange.current = true;
      setRangeStart(idx);
      setRangeEnd(idx);
    }
  };

  const handleBarTouchMove = (e) => {
    if (!isDraggingRange.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const idx = getIdxFromPoint(touch.clientX, touch.clientY);
    if (idx !== null) {
      setRangeEnd(idx);
    }
  };

  const handleBarTouchEnd = () => {
    isDraggingRange.current = false;
  };

  const handleBarMouseDown = (e) => {
    const idx = getIdxFromPoint(e.clientX, e.clientY);
    if (idx !== null) {
      isDraggingRange.current = true;
      setRangeStart(idx);
      setRangeEnd(idx);
    }
  };

  const handleBarMouseMove = (e) => {
    if (!isDraggingRange.current) return;
    const idx = getIdxFromPoint(e.clientX, e.clientY);
    if (idx !== null) {
      setRangeEnd(idx);
    }
  };

  const handleBarMouseUp = () => {
    isDraggingRange.current = false;
  };

  // 선택된 범위의 텍스트
  const getRangeText = () => {
    if (rangeStart === null || !words.length) return currentSentence;
    const start = Math.min(rangeStart, rangeEnd ?? rangeStart);
    const end = Math.max(rangeStart, rangeEnd ?? rangeStart);
    return words.slice(start, end + 1).join(' ');
  };

  const handleDetailSentenceListen = async () => {
    unlockAudio();
    resetSpeakCancel();
    setPlayingType('sentence');
    const textToSpeak = getRangeText();
    // 단일 글자(a, I 등)만 선택된 경우 파닉스 발음으로 재생
    const clean = textToSpeak.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (clean.length === 1 && PHONICS_IPA[clean] && azureVerified && azureKey && azureRegion) {
      await speakWithIpa(clean, PHONICS_IPA[clean], azureKey, azureRegion, azureVoice, sentenceSpeed, ttsLimitReached);
    } else {
      await speak(textToSpeak, sentenceSpeed);
    }
    setPlayingType(null);
  };

  const handleStopDetail = () => {
    // 반복 재생 루프 중지
    isPlayingAllRef.current = false;
    setIsPlayingAll(false);
    playingTypeRef.current = null;
    // 모든 TTS 즉시 취소 (Azure synthesizer + 취소 플래그)
    cancelAllSpeak();
    // 브라우저 TTS 중지
    window.speechSynthesis.cancel();
    // 캐시 오디오 중지
    stopCachedAudio();
    setPlayingType(null);
  };

  // ─── 배율 변경 ───
  const handleScaleChange = (scale) => {
    setContentScale(scale);
    localStorage.setItem('sl-content-scale', String(scale));
  };

  // ─── 연도 목록 ───
  const availableYears = [...new Set([
    selectedYear,
    ...Object.keys(sentenceData).map(k => parseInt(k.split('-')[0]))
  ])].sort();

  // ─── 발음 평가 (Azure Pronunciation Assessment) ───
  const startPronunciationAssessment = async () => {
    if (!azureKey || !azureRegion || !currentSentence) return;
    if (assessBusyRef.current) return;      // 중복 시작 방지
    stopAssessment();                       // 이전 세션이 남아 있으면 먼저 정리
    assessBusyRef.current = true;
    assessTargetRef.current = currentSentence; // 채점 기준 문장 고정 (타이머 지연 대비)

    unlockAudio();
    setIsAssessing(true);
    setAssessReady(false);
    setAssessResult(null);
    setRecordedAudioUrl(null);

    // 녹음 캡처 시작 (MediaRecorder)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
      assessStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        // 마이크 스트림 해제
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* */ }
        if (assessStreamRef.current === stream) assessStreamRef.current = null;
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
    } catch (e) {
      console.warn('MediaRecorder 시작 실패 (재생 불가):', e);
      if (assessStreamRef.current) { try { assessStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e2) { /* */ } assessStreamRef.current = null; }
    }

    try {
      const speechConfig = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      speechConfig.speechRecognitionLanguage = 'en-US';

      // 타임아웃 설정 (recognizer 생성 전에 설정해야 적용됨)
      speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '8000');
      speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '3500');

      const judgeModeNow = localStorage.getItem('woojin-judge-mode') || 'word';
      const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);
      // 목표 문장을 인식 힌트로 제공 (PhraseList) — 비슷한 발음을 목표 문장 단어들로 우선 인식
      try { speechsdk.PhraseListGrammar.fromRecognizer(recognizer).addPhrase(currentSentence.replace(/[^a-zA-Z\s']/g, '')); } catch (e) { /* */ }
      // 발음 판정 모드에서만 발음평가 적용 (단어 판정에 적용하면 result.text가 기준 문장으로 강제되는 버그)
      if (judgeModeNow === 'pron') {
        const pronConfig = new speechsdk.PronunciationAssessmentConfig(
          currentSentence.replace(/[^a-zA-Z\s']/g, ''),
          speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
          speechsdk.PronunciationAssessmentGranularity.Word,
          false
        );
        pronConfig.applyTo(recognizer);
      }
      recognizerRef.current = recognizer;

      // 마이크 세션 시작 + 0.6초(초기 잡음 구간) 뒤 "지금 말하세요" 표시
      recognizer.sessionStarted = () => { setTimeout(() => setAssessReady(true), 600); };

      // ─── 연속 인식: 침묵으로 끝나지 않고, 아이가 [다 읽었어요]를 누를 때까지 계속 들음 ───
      // (아이가 문장을 보며 고민하는 동안 평가가 끝나버리는 문제 방지)
      assessTextRef.current = '';
      assessScoresRef.current = [];

      recognizer.recognized = (s, e) => {
        if (!e || !e.result) return;
        if (e.result.reason !== speechsdk.ResultReason.RecognizedSpeech) return;
        const t = (e.result.text || '').trim();
        if (t) assessTextRef.current = (assessTextRef.current + ' ' + t).trim(); // 여러 번 나눠 말해도 이어붙임
        if (judgeModeNow === 'pron') {
          try {
            const pr = speechsdk.PronunciationAssessmentResult.fromResult(e.result);
            if (pr && typeof pr.accuracyScore === 'number') assessScoresRef.current.push(pr.accuracyScore);
          } catch (e2) { /* */ }
        }
      };

      recognizer.canceled = (s, e) => {
        console.warn('발음 평가 취소:', e && e.errorDetails);
      };

      // 세션이 끊기면(네트워크 등) 방치되지 않게 정리
      recognizer.sessionStopped = () => { if (assessBusyRef.current) finishAssessment(judgeModeNow); };

      recognizer.startContinuousRecognitionAsync(
        () => { /* 시작됨 — 종료는 [다 읽었어요] 버튼 또는 2분 안전장치 */ },
        (error) => {
          console.error('발음 평가 시작 에러:', error);
          assessBusyRef.current = false;
          try { recognizer.close(); } catch (e) { /* ignore */ }
          recognizerRef.current = null;
          setAssessResult({ overallScore: -1, words: [], error: '마이크 연결을 확인해 주세요. 마이크가 켜져 있는지 확인하고 다시 시도해 보세요!' });
          setIsAssessing(false);
          setAssessReady(false);
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try { mediaRecorderRef.current.stop(); } catch (e) { /* */ }
          }
          if (assessStreamRef.current) { try { assessStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } assessStreamRef.current = null; }
        }
      );

      // 안전장치: 아무도 멈추지 않아도 2분 뒤에는 자동 종료 (마이크 방치 방지)
      if (assessTimeoutRef.current) clearTimeout(assessTimeoutRef.current);
      assessTimeoutRef.current = setTimeout(() => { finishAssessment(judgeModeNow); }, 120000);
      // 종료는 항상 수동([다 읽었어요]) — 묵음으로는 끊지 않음 (2분 안전장치만 유지)
    } catch (err) {
      console.error('발음 평가 시작 실패:', err);
      setAssessResult({ overallScore: -1, words: [], error: '발음 평가를 시작할 수 없어요. 인터넷 연결과 마이크 권한을 확인해 주세요!' });
      setIsAssessing(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
  };

  // 녹음 재생
  const playRecordedAudio = () => {
    if (!recordedAudioUrl) return;
    if (recordedAudioRef.current) { recordedAudioRef.current.pause(); }
    const audio = new Audio(recordedAudioUrl);
    recordedAudioRef.current = audio;
    setIsPlayingRecording(true);
    audio.onended = () => setIsPlayingRecording(false);
    audio.onerror = () => setIsPlayingRecording(false);
    // 녹음 시작부 마이크 잡음(스~/치~) 건너뛰기
    audio.onloadedmetadata = () => {
      try { if (isFinite(audio.duration) && audio.duration > 1.0) audio.currentTime = 0.6; } catch (e) { /* */ }
    };
    audio.play();
  };

  const stopRecordedAudio = () => {
    if (recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      recordedAudioRef.current.currentTime = 0;
      setIsPlayingRecording(false);
    }
  };

  // ─── 인식 종료 + 채점 (아이가 [다 읽었어요]를 눌렀을 때) ───
  const finishAssessment = (judgeModeNow) => {
    if (!assessBusyRef.current) return; // 이미 끝났으면 무시 (이중 호출 방지)
    assessBusyRef.current = false;
    if (assessTimeoutRef.current) { clearTimeout(assessTimeoutRef.current); assessTimeoutRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
    const mode = judgeModeNow || localStorage.getItem('woojin-judge-mode') || 'word';
    const target = assessTargetRef.current || currentSentence; // 시작 시점 문장으로 채점
    const rec = recognizerRef.current;
    recognizerRef.current = null;

    const evaluate = () => {
      // 마이크는 어떤 경로로 끝나든 반드시 해제
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* */ }
      }
      if (assessStreamRef.current) { try { assessStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } assessStreamRef.current = null; }
      // 중복 단어 정리 (같은 말 반복 인식 방지)
      const toks = [];
      (assessTextRef.current || '').trim().split(/\s+/).filter(Boolean).forEach(w => {
        const prev = toks[toks.length - 1];
        if (prev && prev.toLowerCase() === w.toLowerCase()) return;
        toks.push(w);
      });
      const recognizedText = toks.join(' ');

      if (!recognizedText.trim()) {
        setAssessResult({ ok: false, words: [], error: '목소리를 인식하지 못했어요. 다시 시도해 보세요.' });
      } else {
        const words = matchedWords(recognizedText, target);
        let ok, score;
        if (mode === 'pron') {
          // 끊어 읽으면 조각마다 낮은 점수가 나오므로 최고 점수를 기준으로 (부당한 감점 방지)
          const arr = assessScoresRef.current;
          score = arr.length ? Math.round(Math.max(...arr)) : 0;
          const threshold = parseInt(localStorage.getItem('woojin-pass-threshold')) || 60;
          ok = score >= threshold;
        } else {
          ok = isSpeechMatch(recognizedText, target, 0.6); // 알맞은 단어를 말했는가
        }
        setAssessResult({ ok, recognizedText, words, mode, score });
        // 말하기(읽기평가)는 인식이 불안정 → ⚠️ 감점 없음, 통과만 졸업(streak)에 반영
        if (onSentenceResult && ok) onSentenceResult(target, true, '');
      }
      setIsAssessing(false);
      setAssessReady(false);
    };

    if (rec) {
      // 마지막 발화까지 받아서 채점 (실패해도 지금까지 인식된 걸로 채점)
      try {
        rec.stopContinuousRecognitionAsync(
          () => { try { rec.close(); } catch (e) { /* */ } evaluate(); },
          () => { try { rec.close(); } catch (e) { /* */ } evaluate(); }
        );
      } catch (e) { try { rec.close(); } catch (e2) { /* */ } evaluate(); }
    } else {
      evaluate();
    }
  };

  // 채점 없이 중단 (팝업 닫기·화면 이탈용)
  const stopAssessment = () => {
    assessBusyRef.current = false; // 진행 중이던 채점도 무효화
    if (assessTimeoutRef.current) { clearTimeout(assessTimeoutRef.current); assessTimeoutRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
    const rec = recognizerRef.current;
    recognizerRef.current = null;
    if (rec) {
      try { rec.stopContinuousRecognitionAsync(() => { try { rec.close(); } catch (e) { /* */ } }, () => { try { rec.close(); } catch (e) { /* */ } }); }
      catch (e) { try { rec.close(); } catch (e2) { /* */ } }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { /* */ }
    }
    mediaRecorderRef.current = null;
    // 녹음기가 없거나 실패해도 마이크는 반드시 끔
    if (assessStreamRef.current) { try { assessStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } assessStreamRef.current = null; }
    setIsAssessing(false);
    setAssessReady(false);
  };

  // 화면을 벗어나면 마이크 정리 (켜진 채 남지 않게)
  useEffect(() => () => {
    if (assessTimeoutRef.current) clearTimeout(assessTimeoutRef.current);
    const rec = recognizerRef.current; recognizerRef.current = null;
    if (rec) { try { rec.close(); } catch (e) { /* */ } }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { try { mediaRecorderRef.current.stop(); } catch (e) { /* */ } }
    if (assessStreamRef.current) { try { assessStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } assessStreamRef.current = null; }
  }, []);

  // 읽기 평가 팝업 닫기 (녹음 + 재생 모두 중지)
  const closeAssessPopup = () => {
    stopAssessment();
    handleStopDetail();
    stopRecordedAudio();
    if (recordedAudioUrl) { URL.revokeObjectURL(recordedAudioUrl); }
    setRecordedAudioUrl(null);
    setShowAssessPopup(false);
    setAssessResult(null);
  };

  // 점수에 따른 색상 클래스
  const getScoreClass = (score) => {
    if (score >= 80) return 'score-good';
    if (score >= 50) return 'score-ok';
    return 'score-bad';
  };

  const getScoreEmoji = (score) => {
    if (score >= 90) return '🌟';
    if (score >= 80) return '😊';
    if (score >= 60) return '🙂';
    if (score >= 40) return '😐';
    return '😢';
  };

  // 결과가 나오면 자동 스크롤
  useEffect(() => {
    if (assessResult && assessResultRef.current) {
      setTimeout(() => {
        assessResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [assessResult]);

  // ─── 단어 퀴즈 로직 ───
  const SKIP_WORDS = new Set(['a', 'i', 'an', 'the', 'is', 'am', 'to', 'of', 'it', 'in', 'on', 'no', 'so', 'at', 'or', 'do', 'be', 'my', 'me', 'he', 'we', 'up', 'if']);

  const generateQuiz = () => {
    if (sentences.length < 1) return;

    // 모든 문장에서 사용 가능한 단어 수집 (오답 후보)
    const allWords = [];
    sentences.forEach(s => {
      s.split(/\s+/).forEach(w => {
        const clean = w.replace(/[^a-zA-Z']/g, '').toLowerCase();
        if (clean.length >= 2 && !SKIP_WORDS.has(clean)) allWords.push(clean);
      });
    });
    const uniqueAllWords = [...new Set(allWords)];

    // 최대 5문제, 문장이 부족하면 가능한 만큼
    const shuffled = [...sentences].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(5, sentences.length));

    const questions = picked.map(sentence => {
      const wordArr = sentence.split(/\s+/).filter(Boolean);
      // 빈칸 후보: 2글자 이상, SKIP_WORDS 아닌 것
      const candidates = [];
      wordArr.forEach((w, idx) => {
        const clean = w.replace(/[^a-zA-Z']/g, '').toLowerCase();
        if (clean.length >= 2 && !SKIP_WORDS.has(clean)) {
          candidates.push(idx);
        }
      });

      if (candidates.length === 0) {
        // 후보가 없으면 첫 번째 단어를 빈칸
        candidates.push(0);
      }

      // 1~2개 빈칸 (후보가 1개면 1개만)
      const blankCount = candidates.length >= 3 ? Math.min(2, Math.floor(Math.random() * 2) + 1) : 1;
      const shuffledCandidates = [...candidates].sort(() => Math.random() - 0.5);
      const blankIndices = shuffledCandidates.slice(0, blankCount).sort((a, b) => a - b);

      // 정답 단어
      const correctWords = blankIndices.map(idx => wordArr[idx].replace(/[^a-zA-Z']/g, ''));

      // 오답 단어 생성 (같은 레슨의 다른 단어에서)
      const correctLower = new Set(correctWords.map(w => w.toLowerCase()));
      const distractorPool = uniqueAllWords.filter(w => !correctLower.has(w));
      const shuffledDistractors = distractorPool.sort(() => Math.random() - 0.5);
      const distractorCount = Math.min(1, shuffledDistractors.length);
      const distractors = shuffledDistractors.slice(0, distractorCount);

      // 보기 = 정답 + 오답 → 셔플
      const options = [...correctWords.map(w => w.toLowerCase()), ...distractors].sort(() => Math.random() - 0.5);

      return {
        sentence,
        wordArr,
        blankIndices,
        correctWords: correctWords.map(w => w.toLowerCase()),
        options,
      };
    });

    setQuizQuestions(questions);
    setQuizIndex(0);
    setQuizScore(0);
    setQuizFinished(false);
    setQuizAnswers({});
    setQuizFeedback(null);
    setDragWord(null);
    setDragOverBlank(null);
    setShowQuiz(true);
  };

  const currentQuestion = quizQuestions[quizIndex] || null;

  // 드래그 시작 (마우스)
  const handleDragStart = (e, word) => {
    setDragWord(word);
    e.dataTransfer.setData('text/plain', word);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 빈칸 위로 (마우스)
  const handleDragOver = (e, blankIdx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverBlank(blankIdx);
  };

  const handleDragLeave = () => {
    setDragOverBlank(null);
  };

  // 드롭 (마우스)
  const handleDrop = (e, blankIdx) => {
    e.preventDefault();
    const word = e.dataTransfer.getData('text/plain') || dragWord;
    setDragOverBlank(null);
    setDragWord(null);
    if (word) placeWord(blankIdx, word);
  };

  // 터치 드래그
  const handleTouchStart = (e, word) => {
    e.preventDefault();
    setDragWord(word);
    const touch = e.touches[0];
    // 고스트 엘리먼트 생성
    const ghost = document.createElement('div');
    ghost.className = 'sl-quiz-drag-ghost';
    ghost.textContent = word;
    ghost.style.left = `${touch.clientX - 30}px`;
    ghost.style.top = `${touch.clientY - 20}px`;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
  };

  const handleTouchMove = (e) => {
    if (!dragGhostRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragGhostRef.current.style.left = `${touch.clientX - 30}px`;
    dragGhostRef.current.style.top = `${touch.clientY - 20}px`;

    // 빈칸 위인지 확인
    const els = document.elementsFromPoint(touch.clientX, touch.clientY);
    let found = null;
    for (const el of els) {
      if (el.dataset && el.dataset.blankidx !== undefined) {
        found = parseInt(el.dataset.blankidx);
        break;
      }
    }
    setDragOverBlank(found);
  };

  const handleTouchEnd = (e) => {
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
    if (dragWord && dragOverBlank !== null) {
      placeWord(dragOverBlank, dragWord);
    }
    setDragWord(null);
    setDragOverBlank(null);
  };

  // 단어 배치 + 정답 체크
  const placeWord = async (blankIdx, word) => {
    if (!currentQuestion || quizFeedback) return;
    const q = currentQuestion;
    const correctWord = q.correctWords[blankIdx];

    if (word.toLowerCase() === correctWord) {
      // 개별 정답 효과음
      sfxCorrect();
      const newAnswers = { ...quizAnswers, [blankIdx]: word };
      setQuizAnswers(newAnswers);

      // 모든 빈칸 채웠는지 확인
      if (Object.keys(newAnswers).length === q.blankIndices.length) {
        setQuizFeedback('correct');
        setQuizScore(prev => prev + 1);

        // 문장 완성 효과음
        setTimeout(() => sfxComplete(), 300);

        // 문장 TTS 재생 후 다음 문제로
        setQuizPlayingSentence(true);
        await new Promise(res => setTimeout(res, 800));
        resetSpeakCancel();
        await speak(q.sentence, '-10%');
        setQuizPlayingSentence(false);

        // 다음 문제 또는 완료 (1.5초 쉬었다가)
        await new Promise(res => setTimeout(res, 1500));
        if (quizIndex + 1 < quizQuestions.length) {
          setQuizIndex(quizIndex + 1);
          setQuizAnswers({});
          setQuizFeedback(null);
        } else {
          sfxFinish();
          setQuizFinished(true);
          if (onQuizCleared) onQuizCleared(selectedDayIndex);
        }
      }
    } else {
      // 오답 효과음 + 깜빡임
      sfxWrong();
      setQuizFeedback('wrong');
      setTimeout(() => setQuizFeedback(null), 800);
    }
  };

  // 빈칸 클릭으로도 배치 (터치 드래그가 어려울 때 대안)
  const handleBlankClick = (blankIdx) => {
    if (dragWord && !quizFeedback) {
      placeWord(blankIdx, dragWord);
      setDragWord(null);
    }
  };

  // 단어 칩 탭 (터치 기기에서 탭→탭 방식)
  const handleWordChipTap = (word) => {
    if (quizFeedback) return;
    if (dragWord === word) {
      setDragWord(null); // 같은 단어 다시 탭하면 해제
    } else {
      setDragWord(word);
    }
  };

  const closeQuiz = () => {
    setShowQuiz(false);
    setQuizQuestions([]);
    setQuizIndex(0);
    setQuizScore(0);
    setQuizFinished(false);
    setQuizAnswers({});
    setQuizFeedback(null);
    setDragWord(null);
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
  };

  // 사용된 단어 (이미 빈칸에 넣은 단어는 비활성화)
  const usedWords = currentQuestion ? new Set(Object.values(quizAnswers).map(w => w.toLowerCase())) : new Set();

  return (
    <main className="learning-main">
      {/* ===== 좌측: 문장 표시 영역 ===== */}
      <section className="learning-left sl-content">
        {/* 배율 설정 (속도와 분리, 우측 상단) */}
        <div className="sl-scale-float">
          {[
            { label: '기본', value: 1 },
            { label: '크게', value: 1.2 },
            { label: '아주 크게', value: 1.4 },
          ].map(opt => (
            <button
              key={opt.value}
              className={`sl-scale-btn ${contentScale === opt.value ? 'active' : ''}`}
              onClick={() => handleScaleChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {selectedDay && sentences.length > 0 && courseView ? (
          <SentenceSetCourse
            onSentenceResult={onSentenceResult}
            progressId={selectedDay ? `${currentKey}-${selectedDay.id || selectedDayIndex}` : ''}
            sentences={sentences}
            meanings={selectedDay ? (selectedDay.meanings || {}) : {}}
            speak={speak}
            azureKey={azureKey}
            azureRegion={azureRegion}
            onStartQuiz={() => { gameFromCourseRef.current = true; if (Math.random() < 0.5) setShowGame(true); else setShowSlice(true); }} /* 세트학습 마지막 게임 → 메달 대상 */
            onClose={() => setCourseView(false)}
          />
        ) : selectedDay && sentences.length > 0 ? (
          <>
            {/* 설정 바 */}
            <div className="sm-settings-bar">
              <div className="sm-setting-group">
                <span className="sm-setting-label">속도:</span>
                {[
                  { label: '아주 느리게', value: '-50%' },
                  { label: '느리게', value: '-40%' },
                  { label: '조금 느리게', value: '-30%' },
                  { label: '보통', value: '-20%' },
                  { label: '빠르게', value: '0%' },
                ].map(opt => (
                  <label key={opt.value} className="sm-radio">
                    <input type="radio" name="slSpeed" value={opt.value}
                      checked={sentenceSpeed === opt.value} onChange={() => setSentenceSpeed(opt.value)} />
                    <span className="sm-radio-text">{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">반복:</span>
                {[1, 2, 3, 5].map(n => (
                  <label key={n} className="sm-radio">
                    <input type="radio" name="slRepeat" value={n}
                      checked={repeatCount === n} onChange={() => setRepeatCount(n)} disabled={!!playingType} />
                    <span className="sm-radio-text">{n}번</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 문장 리스트 — 클릭으로 선택 */}
            <div className="sm-sentence-list" style={{ zoom: contentScale }}>
              {sentences.map((s, idx) => (
                <div
                  key={idx}
                  className={`sm-sentence-item ${selectedSentenceIdx === idx ? 'selected' : ''}`}
                  onClick={() => handleSentenceSelect(idx)}
                >
                  <span className="sm-sentence-num">{idx + 1}</span>
                  <div className="sm-sentence-col">
                    <span className="sm-sentence-text">
                      {s}
                      {/* 어려워한 문장 표시 — 누르면 이유 */}
                      {isWeakStat((selectedDay && selectedDay.sentStats || {})[s]) && (
                        <span className="sm-weak" title="눌러서 이유 보기"
                          onClick={(e) => { e.stopPropagation(); setWhySentence({ text: s, st: (selectedDay.sentStats || {})[s] }); }}>⚠️</span>
                      )}
                    </span>
                    {/* 한글 뜻 — 눌렀을 때만 표시 (평소엔 숨김) */}
                    {openMeaningIdx === idx && (
                      <span className="sm-sentence-ko">
                        {(selectedDay && (selectedDay.meanings || {})[s]) || '뜻이 등록되지 않았어요'}
                      </span>
                    )}
                  </div>
                  <div className="sm-item-btns">
                    <button className={`sm-ko-btn ${openMeaningIdx === idx ? 'on' : ''}`}
                      title="한글 뜻 보기"
                      onClick={(e) => { e.stopPropagation(); setOpenMeaningIdx(openMeaningIdx === idx ? -1 : idx); }}>
                      {openMeaningIdx === idx ? '🙈' : '💡'}
                    </button>
                    {playingType === 'sentence' && selectedSentenceIdx === idx ? (
                      <button className="sm-play-btn stop" onClick={(e) => { e.stopPropagation(); handleStopDetail(); }}>
                        ⏹️
                      </button>
                    ) : (
                      <button className="sm-play-btn" onClick={(e) => { e.stopPropagation(); playMainSentence(idx, s); }} disabled={playingType === 'sentence'}>
                        ▶️
                      </button>
                    )}
                    <button className="sm-detail-btn" onClick={(e) => { e.stopPropagation(); handleSentenceSelect(idx); setSelectedWord(null); setSyllables([]); setShowDetail(true); }}>
                      🔤
                    </button>
                    {azureVerified && azureKey && (
                      <button className="sm-assess-btn" onClick={(e) => { e.stopPropagation(); handleSentenceSelect(idx); setAssessResult(null); setShowAssessPopup(true); }} disabled={!!playingType}>
                        🎤
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {sentences.length >= 2 && (
              <button className="sl-quiz-bottom-btn"
                onClick={() => { gameFromCourseRef.current = false; if (Math.random() < 0.5) setShowGame(true); else setShowSlice(true); }}>
                🎮 문장을 다 배웠다면 도전! {/* 재미용 — 메달은 세트학습을 거쳐야 */}
              </button>
            )}
          </>
        ) : (
          <div className="image-area">
            <div className="image-placeholder">
              <span className="placeholder-emoji">📖</span>
              {selectedDay ? '이 Lesson에 문장이 없어요. 문장 관리에서 추가해 주세요!' : '문장을 선택하고 학습을 시작해봐!'}
            </div>
          </div>
        )}
      </section>

      {/* ===== 끊어 읽기 팝업 ===== */}
      {showDetail && currentSentence && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) { handleStopDetail(); setShowDetail(false); setSelectedWord(null); setSyllables([]); setRangeStart(null); setRangeEnd(null); } }}>
          <div className="sl-detail-modal">
            <div className="sl-detail-header">
              <h2 className="modal-title">🔤 끊어 읽기</h2>
              <button className="sentence-admin-close" onClick={() => { handleStopDetail(); setShowDetail(false); setSelectedWord(null); setSyllables([]); setRangeStart(null); setRangeEnd(null); }}>✕</button>
            </div>

            <div className="sl-detail-body">
              {/* 문장 — 드래그 바로 범위 선택 + 단어 클릭으로 끊어읽기 */}
              <div className="sl-sentence-area">
                {/* 드래그 범위 선택 바 */}
                <div
                  className="sl-range-bar-row"
                  onTouchStart={handleBarTouchStart}
                  onTouchMove={handleBarTouchMove}
                  onTouchEnd={handleBarTouchEnd}
                  onMouseDown={handleBarMouseDown}
                  onMouseMove={handleBarMouseMove}
                  onMouseUp={handleBarMouseUp}
                >
                  {(() => {
                    const start = rangeStart !== null ? Math.min(rangeStart, rangeEnd ?? rangeStart) : -1;
                    const end = rangeStart !== null ? Math.max(rangeStart, rangeEnd ?? rangeStart) : -1;
                    return words.map((word, idx) => {
                      const inRange = rangeStart !== null && idx >= start && idx <= end;
                      const isEdge = rangeStart !== null && (idx === start || idx === end);
                      const isLast = rangeStart !== null && idx === end;
                      return (
                        <React.Fragment key={idx}>
                          <div
                            className={`sl-range-segment ${inRange ? 'active' : ''} ${isEdge ? 'edge' : ''}`}
                            data-rangeidx={idx}
                          >
                            <span className="sl-range-segment-label" data-rangeidx={idx}>{word}</span>
                          </div>
                          {isLast && (
                            <button className="sl-range-clear-btn" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setRangeStart(null); setRangeEnd(null); }}>✕</button>
                          )}
                        </React.Fragment>
                      );
                    });
                  })()}
                  {rangeStart === null && <span className="sl-swipe-hint">👆</span>}
                </div>

                <div className="sl-sentence-row">
                  <div className="sl-sentence-text">
                    {words.map((word, idx) => {
                      const clean = word.replace(/[^a-zA-Z']/g, '');
                      const isWordSelected = selectedWord === word;
                      const isClickable = clean.length > 1;
                      const start = rangeStart !== null ? Math.min(rangeStart, rangeEnd ?? rangeStart) : -1;
                      const end = rangeStart !== null ? Math.max(rangeStart, rangeEnd ?? rangeStart) : -1;
                      const inRange = rangeStart !== null && idx >= start && idx <= end;
                      return (
                        <span
                          key={idx}
                          className={`sl-word ${isWordSelected ? 'selected' : ''} ${isClickable ? 'clickable' : ''} ${inRange ? 'in-range' : ''}`}
                          onClick={() => {
                            if (isClickable) handleWordClick(word);
                          }}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </div>
                  {playingType === 'sentence' ? (
                    <button className="sl-sentence-play-btn stop" onClick={handleStopDetail}>
                      ⏹️
                    </button>
                  ) : (
                    <button className="sl-sentence-play-btn" onClick={handleDetailSentenceListen} disabled={!!playingType}>
                      ▶️
                    </button>
                  )}
                </div>
                <div className="sl-sentence-hint">
                  {rangeStart !== null
                    ? `"${getRangeText()}" 재생 (▶ 클릭)`
                    : '위 바를 드래그하여 범위 선택 · 단어를 탭하면 끊어 읽기'}
                </div>
              </div>

              {/* 속도 설정 */}
              <div className="sl-detail-settings">
                <div className="sm-setting-group">
                  <span className="sm-setting-label">속도:</span>
                  {[
                    { label: '아주 느리게', value: '-50%' },
                    { label: '느리게', value: '-40%' },
                    { label: '조금 느리게', value: '-30%' },
                    { label: '보통', value: '-20%' },
                  ].map(opt => (
                    <label key={opt.value} className="sm-radio">
                      <input type="radio" name="detailSpeed" value={opt.value}
                        checked={sentenceSpeed === opt.value} onChange={() => setSentenceSpeed(opt.value)} disabled={!!playingType} />
                      <span className="sm-radio-text">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 음절 블록 */}
              {selectedWord && syllables.length > 0 && (
                <div className="sl-syllable-popup">
                  <div className="sl-syllable-title">
                    "<strong>{selectedWord.replace(/[^a-zA-Z']/g, '')}</strong>"
                  </div>

                  <div className="sl-syllable-blocks">
                    {syllables.map((syl, idx) => (
                      <button
                        key={idx}
                        className={`sl-syllable-block ${playingType === `syllable-${idx}` ? 'playing' : ''}`}
                        onClick={() => handleSyllableClick(syl, idx)}
                      >
                        <span className="sl-syl-text">{syl.text}</span>
                        <span className="sl-syl-icon">🔊</span>
                      </button>
                    ))}
                  </div>

                  {/* 반복 횟수 설정 */}
                  <div className="sl-detail-settings">
                    <div className="sm-setting-group">
                      <span className="sm-setting-label">반복:</span>
                      {[1, 2, 3, 5].map(n => (
                        <label key={n} className="sm-radio">
                          <input type="radio" name="repeatCount" value={n}
                            checked={repeatCount === n} onChange={() => setRepeatCount(n)} disabled={!!playingType} />
                          <span className="sm-radio-text">{n}회</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 간격 설정 */}
                  <div className="sl-detail-settings">
                    <div className="sm-setting-group">
                      <span className="sm-setting-label">간격:</span>
                      {[1, 2, 3].map(sec => (
                        <label key={sec} className="sm-radio">
                          <input type="radio" name="detailGap" value={sec}
                            checked={syllableGap === sec} onChange={() => setSyllableGap(sec)} disabled={!!playingType} />
                          <span className="sm-radio-text">{sec}초</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 재생 버튼 */}
                  <div className="sl-action-btns">
                    {isPlayingAll ? (
                      <button className="sl-action-btn play-all" onClick={() => { isPlayingAllRef.current = false; setIsPlayingAll(false); setPlayingType(null); }}>
                        ⏹️ 중지
                      </button>
                    ) : (
                      <button className="sl-action-btn play-all" onClick={handlePlayAllSyllables}>
                        ▶️ 순서대로 듣기{repeatCount > 1 ? ` x${repeatCount}` : ''}
                      </button>
                    )}
                    {playingType === 'word' ? (
                      <button className="sl-action-btn listen-word" onClick={() => { playingTypeRef.current = null; window.speechSynthesis.cancel(); setPlayingType(null); }}>
                        ⏹️ 중지
                      </button>
                    ) : (
                      <button className="sl-action-btn listen-word" onClick={handleWordListen} disabled={!!playingType}>
                        🎧 단어 전체 듣기{repeatCount > 1 ? ` x${repeatCount}` : ''}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 읽기 평가 팝업 ===== */}
      {showAssessPopup && currentSentence && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) closeAssessPopup(); }}>
          <div className="sl-assess-modal">
            <div className="sl-detail-header">
              <h2 className="modal-title">🎤 읽기 평가</h2>
              <button className="sentence-admin-close" onClick={closeAssessPopup}>✕</button>
            </div>

            <div className="sl-assess-modal-body">
              {/* 문장 + 듣기 + 녹음 버튼 한 줄 */}
              <div className="sl-assess-sentence">
                <p className="sl-assess-sentence-text">{currentSentence}</p>
              </div>

              {/* 듣기 / 녹음 버튼 (문장 아래 한 줄, 같은 크기) */}
              <div className="sl-assess-btn-row">
                <button
                  className="sl-assess-action-btn play"
                  onClick={() => { unlockAudio(); resetSpeakCancel(); setPlayingType('sentence'); speak(currentSentence, sentenceSpeed).then(() => setPlayingType(null)); }}
                  disabled={!!playingType || isAssessing}
                >
                  ▶️ 듣기
                </button>
                {isAssessing ? (
                  /* 침묵으로 끝나지 않음 — 다 읽고 직접 눌러야 채점 */
                  <button
                    className="sl-assess-action-btn rec"
                    style={{ background: assessReady ? '#2e9e5b' : '#9e9e9e' }}
                    onClick={() => finishAssessment()}
                    disabled={!assessReady}
                  >
                    {assessReady ? '✅ 다 읽었어요' : '⏳ 준비 중...'}
                  </button>
                ) : (
                  <button className="sl-assess-action-btn rec" onClick={startPronunciationAssessment} disabled={!!playingType}>
                    🎤 녹음하기
                  </button>
                )}
              </div>

              {/* 수동 종료 안내 — 천천히 읽어도 중간에 끊기지 않음 */}
              {isAssessing && assessReady && (
                <div className="sl-assess-guide">천천히 읽어도 괜찮아요. 다 읽으면 <b>✅ 다 읽었어요</b>를 눌러 주세요!</div>
              )}

              {/* 녹음 재생 */}
              {recordedAudioUrl && !isAssessing && (
                <div className="sl-assess-playback">
                  {isPlayingRecording ? (
                    <button className="sl-playback-btn playing" onClick={stopRecordedAudio}>
                      ⏹️ 재생 중지
                    </button>
                  ) : (
                    <button className="sl-playback-btn" onClick={playRecordedAudio}>
                      🔊 내 발음 다시 듣기
                    </button>
                  )}
                </div>
              )}

              {/* 결과 */}
              {assessResult && (
                <div className="sl-assess-result" ref={assessResultRef}>
                  {assessResult.error ? (
                    <div className="sl-assess-error">{assessResult.error}</div>
                  ) : (
                    <>
                      {assessResult.mode === 'pron' && (
                        <div style={{ textAlign: 'center', fontSize: '1.8rem', fontWeight: 800, color: assessResult.ok ? '#2e9e5b' : '#d14848' }}>
                          {assessResult.score}점
                        </div>
                      )}
                      <div style={{
                        textAlign: 'center', fontFamily: 'var(--font-kr)', fontWeight: 700,
                        fontSize: '1.3rem', margin: '4px 0 10px',
                        color: assessResult.ok ? '#2e9e5b' : '#e67e22'
                      }}>
                        {assessResult.ok ? '🌟 잘 읽었어요!' : '조금 더 연습해봐요!'}
                      </div>
                      {/* 목표 단어별로 잘 읽은 단어 표시 (초록=인식됨) */}
                      <div className="sl-assess-words">
                        {assessResult.words.map((w, i) => (
                          <span key={i} className={`sl-assess-word ${w.ok ? 'wa-score-good' : 'wa-score-bad'}`}>
                            {w.word}
                          </span>
                        ))}
                      </div>
                      {assessResult.recognizedText && (
                        <div className="sl-assess-recognized" style={{ marginTop: 8, fontSize: '0.9rem', color: '#666', textAlign: 'center' }}>
                          인식된 단어: <strong>{assessResult.recognizedText}</strong>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 단어 퀴즈 팝업 ===== */}
      {showQuiz && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) closeQuiz(); }}>
          <div className="sl-quiz-modal">
            <div className="sl-detail-header">
              <h2 className="modal-title">📝 단어 퀴즈</h2>
              {!quizFinished && currentQuestion && (
                <span className="sl-quiz-progress-big">{quizIndex + 1} / {quizQuestions.length}</span>
              )}
              <button className="sentence-admin-close" onClick={closeQuiz}>✕</button>
            </div>

            <div className="sl-quiz-body">
              {quizFinished ? (
                /* ── 결과 화면 ── */
                <div className="sl-quiz-result">
                  <div className="sl-quiz-result-celebration">
                    <FireworksCelebration size={120} />
                  </div>
                  <div className="sl-quiz-result-score">
                    {quizScore} / {quizQuestions.length} 정답
                  </div>
                  <div className="sl-quiz-result-msg">
                    {quizScore === quizQuestions.length ? '완벽해요!' : quizScore >= quizQuestions.length * 0.5 ? '잘했어요!' : '다시 도전해봐요!'}
                  </div>
                  <button className="sl-quiz-retry-btn" onClick={generateQuiz}>
                    🔄 다시 하기
                  </button>
                </div>
              ) : currentQuestion ? (
                /* ── 문제 화면 ── */
                <div className={`sl-quiz-question ${quizFeedback === 'correct' ? 'quiz-correct' : ''} ${quizFeedback === 'wrong' ? 'quiz-wrong' : ''}`}>
                  {/* 문장 + 빈칸 + 듣기 버튼 */}
                  <div className="sl-quiz-sentence-area">
                    <div className="sl-quiz-sentence">
                      {currentQuestion.wordArr.map((word, idx) => {
                        const blankPos = currentQuestion.blankIndices.indexOf(idx);
                        if (blankPos >= 0) {
                          const answered = quizAnswers[blankPos];
                          return (
                            <span
                              key={idx}
                              className={`sl-quiz-blank ${dragOverBlank === blankPos ? 'drag-over' : ''} ${answered ? 'filled' : ''} ${quizFeedback === 'wrong' && !answered ? 'shake' : ''}`}
                              data-blankidx={blankPos}
                              onDragOver={(e) => handleDragOver(e, blankPos)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, blankPos)}
                              onClick={() => handleBlankClick(blankPos)}
                            >
                              {answered || '      '}
                            </span>
                          );
                        }
                        return <span key={idx} className="sl-quiz-word">{word}</span>;
                      })}
                    </div>
                    <button
                      className={`sl-quiz-listen-btn ${quizPlayingSentence ? 'playing' : ''}`}
                      onClick={() => {
                        if (quizPlayingSentence) return;
                        setQuizPlayingSentence(true);
                        resetSpeakCancel();
                        speak(currentQuestion.sentence, '-10%').then(() => setQuizPlayingSentence(false));
                      }}
                      disabled={quizPlayingSentence}
                    >
                      {quizPlayingSentence ? '🔊' : '▶️'}
                    </button>
                  </div>

                  {/* 힌트 */}
                  <div className="sl-quiz-hint">
                    {quizPlayingSentence ? '문장을 듣고 있어요...' : dragWord ? '빈칸을 탭하세요' : '단어를 선택하고 빈칸에 넣어보세요'}
                  </div>

                  {/* 단어 보기 */}
                  <div className="sl-quiz-options">
                    {currentQuestion.options.map((word, idx) => {
                      const isUsed = usedWords.has(word.toLowerCase());
                      const isSelected = dragWord === word;
                      return (
                        <div
                          key={idx}
                          className={`sl-quiz-chip ${isUsed ? 'used' : ''} ${isSelected ? 'selected' : ''}`}
                          draggable={!isUsed}
                          onDragStart={(e) => !isUsed && handleDragStart(e, word)}
                          onDragEnd={() => { setDragWord(null); setDragOverBlank(null); }}
                          onTouchStart={(e) => !isUsed && handleTouchStart(e, word)}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={handleTouchEnd}
                          onClick={() => !isUsed && handleWordChipTap(word)}
                        >
                          {word}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ===== 우측: Lesson 선택 패널 ===== */}
      <aside className="learning-right">
        {/* 년/월 선택 */}
        <div className="day-selector">
          <div className="section-title">📅 년/월 선택</div>
          <div className="ym-row">
            <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)}>◀</button>
            <span className="ym-label">{selectedYear}년</span>
            <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)}>▶</button>
          </div>
          <div className="month-buttons">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
              <button
                key={m}
                className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
                onClick={() => handleMonthChange(m)}
              >
                {m}월              </button>
            ))}
          </div>

          {/* Lesson 선택 */}
          <div className="section-title" style={{ marginTop: 8 }}>📚 Lesson 선택</div>
          <div className="day-buttons">
            {sortLessons(days, lessonSortKey, lessonSortOrder).map(({ d, i }) => (
              <button
                key={d.id || i}
                className={`day-btn ${selectedDayIndex === i ? 'active' : ''}`}
                onClick={() => handleDaySelect(i)}
              >
                {d.setClearedAt && <span className="day-medal" title="퀴즈까지 완료!">🏅</span>}
                {d.gameClearedAt && <span className="day-medal" title="게임 클리어!">🎮</span>}
                {d.name}{d.date ? ` (${d.date})` : ''}
                {d.sentences && d.sentences.length > 0 && (
                  <span className="day-progress">{d.sentences.length}문장</span>
                )}
              </button>
            ))}
          </div>
          {days.length === 0 && (
            <div style={{ color: 'var(--color-text-light)', marginTop: 8, fontFamily: 'var(--font-kr)', fontSize: '0.9rem' }}>
              이 달에는 아직 Lesson이 없어요!
            </div>
          )}
        </div>

        {selectedDayIndex < 0 && (
          <div className="no-day-message">
            <span className="msg-emoji">👆</span>
            <span className="msg-text">위에서 Lesson을 선택해 주세요!</span>
          </div>
        )}

        {selectedDay && sentences.length > 0 && (
          <div className="sl-entry-btns">
            <button className={`sl-entry-btn ${!courseView ? 'active' : ''}`} onClick={() => setCourseView(false)}>
              📄 문장 학습
            </button>
            <button className={`sl-entry-btn ${courseView ? 'active' : ''}`} onClick={() => setCourseView(true)}>
              🎒 세트 학습
            </button>
          </div>
        )}

        {selectedDay && (
          <button className="sl-song-btn" onClick={() => setShowSong(true)}>
            🎵 노래 {selectedDay.songs && selectedDay.songs.length > 0 ? `(${selectedDay.songs.length})` : ''}
          </button>
        )}

        {onGoAdmin && (
          <button className="sl-admin-btn" onClick={onGoAdmin}>
            📋 문장 관리
          </button>
        )}
      </aside>

      {showGame && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowGame(false); }}>
          <div className="srg-modal">
            <SlingshotGame
              sentences={sentences}
              speak={speak}
              onClear={() => { if (gameFromCourseRef.current && onQuizCleared) onQuizCleared(selectedDayIndex); }} /* 메달은 세트학습 경유만 */
              onClose={() => setShowGame(false)}
            />
          </div>
        </div>
      )}

      {showSlice && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowSlice(false); }}>
          <div className="srg-modal">
            <SliceGame
              mode="sentence"
              sentences={sentences}
              allWords={sentences.join(' ').split(/\s+/)}
              speak={speak}
              onClear={() => { if (gameFromCourseRef.current && onQuizCleared) onQuizCleared(selectedDayIndex); }} /* 메달은 세트학습 경유만 */
              onClose={() => setShowSlice(false)}
            />
          </div>
        </div>
      )}

      {/* 어려워한 이유 팝업 */}
      {whySentence && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setWhySentence(null); }}>
          <div className="why-modal">
            <div className="why-title">⚠️ 어려워한 문장</div>
            <div className="why-sentence">{whySentence.text}</div>
            <div className="why-count">{whySentence.st.ng || 0}번 어려워했어요</div>
            <ul className="why-list">
              {reasonList(whySentence.st).length === 0 ? (
                <li>자세한 이유는 아직 기록되지 않았어요.</li>
              ) : (
                reasonList(whySentence.st).map(r => (
                  <li key={r.key}>{r.text} <b>{r.count}번</b></li>
                ))
              )}
            </ul>
            <div className="why-note">연속 3번 잘하면 표시가 사라져요. (지금 {whySentence.st.streak || 0}번)</div>
            <div className="wa-actions">
              <button className="wa-btn wa-hint" onClick={() => {
                const idx = sentences.indexOf(whySentence.text);
                setWhySentence(null);
                if (idx >= 0) { handleSentenceSelect(idx); setAssessResult(null); setShowAssessPopup(true); } // 이 문장만 바로 읽기평가
              }}>
                🔁 이 문장만 다시
              </button>
              <button className="wa-btn wa-reset" onClick={() => setWhySentence(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      <SongModal
        open={showSong}
        onClose={() => setShowSong(false)}
        youtubeKey={youtubeKey}
        songs={selectedDay ? (selectedDay.songs || []) : []}
        onAddSong={(song) => addSongToDay && addSongToDay(selectedDayIndex, song)}
        onRemoveSong={(id) => removeSongFromDay && removeSongFromDay(selectedDayIndex, id)}
        defaultQuery={selectedDay ? (selectedDay.name || '') : ''}
        sentences={selectedDay ? (selectedDay.sentences || []) : []}
      />
    </main>
  );
}
