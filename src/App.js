import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './App.css';
import {
  loadDataFromFirestore, saveDataToFirestore,
  onDataChange,
  loadSentenceDataFromFirestore, saveSentenceDataToFirestore, onSentenceDataChange,
  loadMemorizeDataFromFirestore, saveMemorizeDataToFirestore, onMemorizeDataChange,
  addSpeechUsageFirestore, addVisionUsageFirestore, onUsageChange,
  onAuthChange, logoutUser, migrateOldDataToUser, mergeUserData, deleteAccount,
  onUserUsageChange, loadAppConfig, saveAppConfig,
  addAiTranslateUsage, loadAiTranslateUsage
} from './firebase';
import LoginScreen from './LoginScreen';
import LogoIcon from './LogoIcon';
import { getCachedAudio, setCachedAudio, playCachedAudio, makeCacheKey, getCacheStats, clearCache, unlockAudio, resetAudioModule, stopCachedAudio } from './ttsCache';
import { getLogsText, clearLogs } from './logger';
import { forceUpdate } from './updateCheck';
import { isSpeechMatch } from './speechMatch';
import { sortLessons } from './lessonSort';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { createWorker } from 'tesseract.js';
import SentenceLearning from './SentenceLearning';
import SentenceMemorize from './SentenceMemorize';
import BookReading from './BookReading';
import WordSetCourse from './WordSetCourse';
import WordList from './WordList';
import ReviewQuiz from './ReviewQuiz';
import PhonicsCourse from './PhonicsCourse';
import SlingshotGame from './SlingshotGame';
import SliceGame from './SliceGame';
import TraceWord from './TraceWord';
import PronunceCheck from './PronunceCheck';
import { isWeakStat } from './learningStats';
import useBackHandler from './useBackHandler';
import { subscribeNotice, showNotice, clearNotice, VOICE_MSG } from './notice';
import { uploadPhonicsSound, listPhonicsSounds } from './phonicsAudio';
import { getUnseenNote, markNoteSeen, resetNotesSeen } from './patchNotes';

// 🔑 Pixabay API Key — Firestore(shared/config)에서 로드 (소스/Git에 노출 안 함)
let pixabayApiKey = '';

// GitHub 저장소 (토큰 유효성 확인용)
const GH_OWNER = 'jychoi0858-wj';
const GH_REPO = 'woojin-phonics';

// 단어→이미지 URL 세션 메모리 캐시 (앱 켜진 동안만, 같은 단어 재요청 시 즉시)
const imageUrlCache = new Map();

// ─── Pixabay 단일 타입 검색 (상위 결과 배열 반환) ───
async function pixabayFetch(q, type) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://pixabay.com/api/?key=${pixabayApiKey}&q=${encodeURIComponent(q)}&image_type=${type}&safesearch=true&per_page=20&order=popular&lang=en`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.hits && data.hits.length > 0) return data.hits;
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return [];
}

// 아이용으로 선호/기피할 태그
const GOOD_TAGS = ['cartoon', 'clip', 'clipart', 'drawing', 'draw', 'cute', 'character', 'animal', 'vector', 'kid', 'sticker', 'illustration', 'doodle', 'comic', 'icon'];
const BAD_TAGS = ['background', 'backdrop', 'texture', 'wallpaper', 'abstract', 'pattern', 'grunge', 'dark', 'frame', 'banner', 'board', 'blur', 'bokeh', 'wall', 'religion', 'jesus', 'church', 'cross'];
// 글자/문자가 그려진 이미지 → 정답이 그림에 적혀 있으면 학습에 방해 (제외)
const TEXT_TAGS = ['text', 'lettering', 'letter', 'letters', 'font', 'fonts', 'typography', 'typographic', 'alphabet',
  'word', 'words', 'writing', 'written', 'handwriting', 'calligraphy', 'script', 'quote', 'quotes', 'message',
  'sign', 'signage', 'signboard', 'label', 'poster', 'headline', 'title', 'logo', 'logotype', 'slogan',
  'greeting', 'card', 'invitation', 'billboard', 'nameplate', 'inscription', 'caption', 'subtitle', 'spelling'];

// 어간 비교 — dig/digging/digs, fox/foxes 등을 같은 단어로 취급
function stemEq(a, b) {
  if (a === b) return true;
  const strip = (w) => w.replace(/(ing|ed|es|s)$/,'').replace(/([a-z])\1$/, '$1'); // 어미 + 자음중복 제거
  return strip(a) === strip(b) && strip(a).length >= 2;
}

// 이 이미지가 검색어와 실제로 관련이 있는가 (태그에 단어가 있어야 함)
function isRelevant(h, q) {
  const tags = (h.tags || '').split(',').map(t => t.trim().toLowerCase());
  return tags.some(t => t === q || t.split(' ').some(w => stemEq(w, q)));
}

// 글자가 그려진 이미지인가
function hasTextArt(h) {
  const tags = (h.tags || '').split(',').map(t => t.trim().toLowerCase());
  return tags.some(t => t.split(' ').some(w => TEXT_TAGS.includes(w)));
}

// 검색어 관련성 + 아이 친화도로 점수 매기기
function scoreHit(h, q) {
  const tags = (h.tags || '').split(',').map(t => t.trim().toLowerCase());
  let s = 0;
  if (tags[0] === q) s += 14;                  // 첫 태그가 검색어 = 가장 관련성 높음
  else if (tags.includes(q)) s += 8;           // 태그에 검색어 그대로
  else if (isRelevant(h, q)) s += 5;           // 어간 일치 (digging 등)
  tags.forEach(t => {
    if (GOOD_TAGS.some(g => t.includes(g))) s += 2;
    if (BAD_TAGS.some(b => t.includes(b))) s -= 4;
  });
  return s;
}

// 결과 중 "관련 있고 글자 없는" 이미지만 남겨 점수순 선택 (없으면 빈 값 → 이미지 안 띄움)
function pickBestHit(hits, q) {
  if (!hits || hits.length === 0) return '';
  let pool = hits.filter(h => isRelevant(h, q) && !hasTextArt(h)); // 1순위: 관련 + 글자 없음
  if (pool.length === 0) pool = hits.filter(h => isRelevant(h, q)); // 2순위: 관련 있으면 글자 감수
  if (pool.length === 0) return '';                                 // 관련 이미지 없으면 포기 (엉뚱한 그림 금지)
  const h = [...pool].sort((a, b) => scoreHit(b, q) - scoreHit(a, q))[0];
  return h.webformatURL || h.previewURL || '';
}

// ─── (보관) Pixabay 이미지 검색 — 현재 미사용, ARASAAC로 대체 ───
// eslint-disable-next-line no-unused-vars
async function pixabaySearch(word) {
  const q = (word || '').toLowerCase().trim();
  if (!q || !pixabayApiKey) return '';
  const [illu, vec] = await Promise.all([
    pixabayFetch(q, 'illustration'),
    pixabayFetch(q, 'vector'),
  ]);
  const drawn = [...illu, ...vec];
  const best = pickBestHit(drawn, q);
  if (best) return best;
  return pickBestHit(await pixabayFetch(q, 'photo'), q);
}

// ============================================================
// 🖼️ ARASAAC 픽토그램 검색 (교육용 그림, 무료·키 불필요, 그림에 글자 없음)
//    https://api.arasaac.org/v1/pictograms/en/search/{word}
//    이미지: https://static.arasaac.org/pictograms/{id}/{id}_500.png
// ============================================================
async function arasaacFetch(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.arasaac.org/v1/pictograms/en/search/${encodeURIComponent(word)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return [];
}

// 픽토그램 목록에서 검색어와 가장 잘 맞는 그림 고르기
function pickPictogram(list, q) {
  if (!list || !list.length) return 0;
  const kw = (p) => (p.keywords || []).map(k => (k.keyword || '').toLowerCase());
  // 1순위: 키워드가 검색어와 정확히 일치
  const exact = list.find(p => kw(p).includes(q));
  if (exact) return exact._id;
  // 2순위: 키워드가 검색어로 시작 (dig → dig up)
  const starts = list.find(p => kw(p).some(k => k.startsWith(q + ' ')));
  if (starts) return starts._id;
  // 3순위: 검색 점수가 가장 높은 것 (API가 score를 줄 때만)
  const scored = [...list].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return scored ? scored._id : 0;
}

// 픽토그램 후보 목록 (이미지 고르기 팝업용) — 최대 12개 URL
async function arasaacCandidates(word) {
  const q = (word || '').toLowerCase().trim();
  if (!q) return [];
  let list = await arasaacFetch(q);
  if (!list.length) {
    for (const alt of altQueries(q)) {
      list = await arasaacFetch(alt);
      if (list.length) break;
    }
  }
  return list.slice(0, 12).map(p => `https://static.arasaac.org/pictograms/${p._id}/${p._id}_500.png`);
}

// 이미지 URL 반환 (없으면 '' → 화면에 "이미지를 찾을 수 없어요" 표시)
async function arasaacSearch(word) {
  const q = (word || '').toLowerCase().trim();
  if (!q) return '';
  let id = pickPictogram(await arasaacFetch(q), q);
  if (!id) {
    // 대체 검색어로 재시도 (dig → digging / digs, 구는 마지막 단어로)
    for (const alt of altQueries(q)) {
      id = pickPictogram(await arasaacFetch(alt), alt);
      if (id) break;
    }
  }
  return id ? `https://static.arasaac.org/pictograms/${id}/${id}_500.png` : '';
}

// 대체 검색어 (dig → digging / digs, "try on" → "try")
function altQueries(q) {
  const out = [];
  if (q.includes(' ')) {
    const parts = q.split(/\s+/).filter(Boolean);
    out.push(parts[parts.length - 1], parts[0]); // 구는 핵심 단어로
    return out;
  }
  if (q.length > 8) return out;
  const last = q[q.length - 1];
  const dbl = /[aeiou]/.test(q[q.length - 2] || '') && !/[aeiouwxy]/.test(last) ? q + last : q;
  [dbl + 'ing', q + 's', q.replace(/e$/, '') + 'ing'].forEach(a => { if (a !== q && !out.includes(a)) out.push(a); });
  return out;
}

// ============================================================
// 🇰🇷 한글 뜻 자동 번역
//    1순위: Azure Translator 사전 조회 (품사별 여러 뜻 → 다의어에 강함)
//    2순위: Azure Translator 일반 번역
//    3순위: MyMemory 무료 번역 (키가 없을 때만)
//    단어 등록 시 1회 호출 → 단어 데이터에 저장 (언제든 수정 가능)
// ============================================================
let azureTranslatorKey = '';
let azureTranslatorRegion = 'koreacentral';
let googleTranslateKey = ''; // 선택 사항
const meaningCache = new Map(); // 세션 캐시 (중복 호출 방지)

const AZ_TR_HOST = 'https://api.cognitive.microsofttranslator.com';

function azTrHeaders() {
  return {
    'Ocp-Apim-Subscription-Key': azureTranslatorKey,
    'Ocp-Apim-Subscription-Region': azureTranslatorRegion,
    'Content-Type': 'application/json',
  };
}

// 사전 조회 → 후보 목록 (신뢰도 순, 최대 6개). 뜻 고르기 팝업에서 사용
async function azureDictionaryCandidates(word) {
  if (!azureTranslatorKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${AZ_TR_HOST}/dictionary/lookup?api-version=3.0&from=en&to=ko`, {
      method: 'POST', headers: azTrHeaders(),
      body: JSON.stringify([{ Text: word }]), signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const trs = data?.[0]?.translations || [];
      const out = [...trs]
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .filter(t => (t.confidence || 0) >= 0.03)
        .map(t => (t.displayTarget || '').trim())
        .filter(t => t && /[가-힣]/.test(t)); // 한글이 없는 후보 제외
      return [...new Set(out)].slice(0, 6);
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return [];
}

// 자동 입력용: 가장 확실한 뜻 1개만 (여러 개는 아이 화면에서 방해)
async function azureDictionary(word) {
  const c = await azureDictionaryCandidates(word);
  return c[0] || '';
}

// 일반 번역 (사전에 없는 단어·구 대비)
async function azureTranslate(word) {
  if (!azureTranslatorKey) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${AZ_TR_HOST}/translate?api-version=3.0&from=en&to=ko`, {
      method: 'POST', headers: azTrHeaders(),
      body: JSON.stringify([{ Text: word }]), signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      return data?.[0]?.translations?.[0]?.text || '';
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return '';
}

// 무료 번역 (MyMemory) — 키 불필요
async function myMemoryTranslate(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ko`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      let txt = data?.responseData?.translatedText || '';
      // 실패 시 안내문이 그대로 오는 경우가 있어 걸러냄
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(txt)) return '';
      txt = txt.trim();
      // 원문 그대로 돌아오면 번역 실패로 간주
      if (!txt || txt.toLowerCase() === word.toLowerCase()) return '';
      return txt;
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return '';
}

// Google 번역 (키가 있을 때만)
async function googleTranslate(word) {
  if (!googleTranslateKey) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${googleTranslateKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: word, source: 'en', target: 'ko', format: 'text' }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      return data?.data?.translations?.[0]?.translatedText || '';
    }
  } catch { /* ignore */ }
  clearTimeout(timer);
  return '';
}

// ─── Gemini 번역 (1순위) — 아이 눈높이 + 말투 통일 + 문맥 반영 ───
let geminiKey = '';
// 무료 한도가 넉넉한 순서. 앞 모델이 404 등으로 실패하면 다음 것을 시도하고, 성공한 모델을 기억
// AI 번역 하루 한도 (무료 등급 RPD). 태평양시(PT) 자정에 초기화됨
export const AI_DAILY_LIMIT = 20;

// PT 기준 날짜 키 (한도 초기화 기준과 맞춤)
export function ptDayKey(d = new Date()) {
  const pt = new Date(d.getTime() - 8 * 3600 * 1000); // UTC-8 근사 (서머타임 오차 1시간은 무해)
  return pt.toISOString().slice(0, 10);
}

// ⚠️ 무료 등급 한도가 매우 빡빡함 (모델당 분당 5회 / 하루 20회)
//    → 호출을 최소로 쓰는 게 최우선. 한 번에 몰아서 요청하고, 실패해도 남발하지 않음
// flash-lite가 분당 한도(10회)가 가장 넉넉해 1순위
// (모델 제공 여부는 계정마다 다르므로, 실패 시 아래 discoverGeminiModels로 실제 목록을 조회해 고름)
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];

// 이 키로 쓸 수 있는 모델 목록을 조회해 적합한 것을 고름 (추측 대신 실제 목록 사용)
async function discoverGeminiModels() {
  if (!geminiKey) return [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`);
    if (!res.ok) return [];
    const data = await res.json();
    const usable = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => (m.name || '').replace(/^models\//, ''))
      .filter(n => /flash/i.test(n) && !/thinking|image|audio|native|tts|preview|exp/i.test(n));
    // flash-lite 우선 (분당 한도가 넉넉), 그다음 일반 flash
    const lite = usable.filter(n => /lite/i.test(n));
    const flash = usable.filter(n => !/lite/i.test(n));
    return [...lite, ...flash];
  } catch (e) { return []; }
}
// 한 번 성공한 조합을 기억해 다음부터는 곧바로 그 모델만 호출 (한도 낭비 방지)
let geminiModel = localStorage.getItem('woojin-gemini-model') || '';

async function geminiTranslate(text, context) {
  if (!geminiKey) return '';
  const isPhrase = /\s/.test(text.trim());
  const prompt = isPhrase
    ? `다음 영어 문장을 한국 초등학교 1학년이 이해할 수 있는 자연스러운 한국어로 번역해 주세요.
규칙:
- 말투는 '~해요' 로 통일 (예: "토끼가 꽃을 따요.")
- 연결어미(~고, ~며)로 끝내지 말고 완결된 한 문장으로
- 설명이나 따옴표 없이 번역문만 출력
${context ? `- 이 문장은 다음 이야기의 일부예요: ${context}` : ''}

영어: ${text}`
    : `다음 영어 단어의 한국어 뜻을 단어장에 쓰는 사전형(기본형)으로 알려주세요.
규칙:
- 동사는 '~다' (dig → 파다, leave → 떠나다), 형용사는 '~ㄴ/은' (large → 큰, safe → 안전한), 명사는 그대로
- 문장으로 만들지 말고, 원문에 없는 목적어·조사를 덧붙이지 마세요 ("땅을 파요" ✕ → "파다" ○)
- 초등학교 1학년이 아는 쉬운 말로, 가장 흔한 뜻 하나만 (꼭 필요하면 쉼표로 최대 2개)
- 설명이나 따옴표 없이 뜻만 출력
${context ? `- 이 단어는 다음 문맥에서 쓰여요: ${context}` : ''}

영어: ${text}`;

  const out = await geminiCall(prompt, 4096); // 생각 토큰까지 감안해 넉넉히
  return pickKoLine(out);
}

let lastGeminiError = ''; // 진단용: 마지막 Gemini 실패 사유
export function getLastGeminiError() { return lastGeminiError; }

// AI 호출 수 (한도 표시용) — 성공 시 증가, 앱이 콜백으로 Firestore에 누적
let aiCallCount = 0;
let onAiUsage = null;
export function setAiUsageHook(fn) { onAiUsage = fn; }

// ─── 번역 진단 로그 (개발자용, 최근 30건) ───
const translateLog = [];
export function addTranslateLog(entry) {
  translateLog.push({ at: new Date().toLocaleTimeString('ko-KR'), ...entry });
  if (translateLog.length > 30) translateLog.shift();
  try { localStorage.setItem('woojin-translate-log', JSON.stringify(translateLog)); } catch (e) { /* */ }
}
export function getTranslateLog() {
  if (translateLog.length === 0) {
    try { const s = localStorage.getItem('woojin-translate-log'); if (s) return JSON.parse(s); } catch (e) { /* */ }
  }
  return translateLog;
}

// 채우기 결과 → 사용자용 안내 문구
export function translateResultMsg(r, label) {
  if (!r || !r.total) return `채울 ${label} 뜻이 없어요.`;
  const lines = [`${label} ${r.done}/${r.total}개의 뜻을 채웠어요.`];
  if (r.byAi > 0) lines.push(`· AI 번역 ${r.byAi}개${r.done > r.byAi ? `, 일반 번역 ${r.done - r.byAi}개` : ''}`);
  else if (r.done > 0) lines.push('· 일반 번역으로 채웠어요');
  const friendly = friendlyTranslateError(r.error);
  if (friendly) lines.push(`\n⚠️ ${friendly}`);
  if (r.skipped) lines.push(`\n${r.skipped}개는 AI 번역을 못 받아서 기존 뜻을 그대로 뒀어요.\n(일반 번역으로 덮어쓰면 품질이 떨어져서요)`);
  else if (r.done < r.total) lines.push(`\n${r.total - r.done}개는 채우지 못했어요.`);
  return lines.join('\n');
}

// 기술적 오류 → 일반 사용자용 한 줄 안내
export function friendlyTranslateError(err) {
  const e = err || '';
  if (!e) return '';
  if (/429/.test(e)) {
    const m = /retry=(\d+(?:\.\d+)?)s/.exec(e);
    return m
      ? `AI 번역 사용량이 잠시 가득 찼어요. ${Math.ceil(parseFloat(m[1]))}초 뒤에 다시 눌러 주세요.`
      : 'AI 번역의 오늘 사용량(하루 20회)을 다 썼어요. 내일 다시 시도해 주세요. (지금은 일반 번역으로 채웠어요)';
  }
  if (/HTTP 40[13]/.test(e)) return 'AI 번역 키가 올바르지 않아요. 설정에서 키를 다시 확인해 주세요.';
  if (/HTTP 400/.test(e)) return 'AI 번역 요청이 거부됐어요. 설정에서 키를 다시 확인해 주세요.';
  if (/시간 초과/.test(e)) return 'AI 번역이 응답하지 않았어요. 잠시 뒤 다시 눌러 주세요.';
  if (/네트워크/.test(e)) return '인터넷 연결을 확인해 주세요.';
  if (/MAX_TOKENS|잘림/.test(e)) return 'AI 번역 결과가 너무 길어 일부를 일반 번역으로 채웠어요.';
  return 'AI 번역에 실패해서 일반 번역으로 채웠어요.';
}

// Gemini 호출 — 모델을 순서대로 시도 (404면 다음 모델로)
// thinkingConfig를 거부하는 모델이면 true (한 번 확인되면 계속 유지)
let geminiNoThinking = localStorage.getItem('woojin-gemini-nothink') === '1';

// 오류 문자열에서 retry=12s 같은 대기 시간 추출 (ms)
function parseRetryDelay(msg) {
  const m = /retry=(\d+(?:\.\d+)?)s/.exec(msg || '');
  return m ? Math.round(parseFloat(m[1]) * 1000) : 0;
}

async function geminiCall(prompt, maxTokens) {
  let models = geminiModel ? [geminiModel] : GEMINI_MODELS;
  let discovered = false;
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    let out = await geminiCallOne(m, prompt, maxTokens, !geminiNoThinking);
    // thinkingConfig를 거부하는 경우(400) → 옵션 빼고 재시도
    if (!out && /HTTP 400/.test(lastGeminiError) && !geminiNoThinking) {
      geminiNoThinking = true;
      try { localStorage.setItem('woojin-gemini-nothink', '1'); } catch (e) { /* */ }
      out = await geminiCallOne(m, prompt, maxTokens, false);
    }
    if (out) {
      geminiModel = m;
      try { localStorage.setItem('woojin-gemini-model', m); } catch (e) { /* */ } // 다음부터 이 모델만 사용
      return out;
    }
    // 429(호출 한도)는 모델을 바꿔도 소용없고 한도만 더 태움 → 서버가 알려준 시간만큼 기다렸다 1회 재시도
    if (/HTTP 429/.test(lastGeminiError)) {
      const w = parseRetryDelay(lastGeminiError);
      if (w > 0 && w <= 65000) {
        await new Promise(r => setTimeout(r, w + 500));
        const retry = await geminiCallOne(m, prompt, maxTokens, !geminiNoThinking);
        if (retry) { geminiModel = m; return retry; }
      }
      break;
    }
    // 모델명 문제(404)일 때만 다음 모델로. 그 외(키 오류·인자 오류)는 모델을 바꿔도 같으므로 중단
    if (!/HTTP 404/.test(lastGeminiError)) break;
    try { localStorage.removeItem('woojin-gemini-model'); } catch (e) { /* */ }

    // 후보를 다 써도 404면, 이 키가 실제로 쓸 수 있는 모델 목록을 조회해 교체 (1회만)
    if (i === models.length - 1 && !discovered) {
      discovered = true;
      const found = await discoverGeminiModels();
      const fresh = found.filter(n => !models.includes(n));
      if (fresh.length) {
        addTranslateLog({ kind: '모델조회', count: found.length, ok: fresh.length, model: fresh.slice(0, 3).join(','), error: '' });
        models = fresh;
        i = -1; // 새 목록으로 처음부터
      }
    }
  }
  return '';
}

async function geminiCallOne(model, prompt, maxTokens, useThinkingConfig) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxTokens,
            // 2.5 계열은 '생각' 토큰이 출력 한도를 잡아먹어 번역문이 잘림 → 생각 끄기
            // (옵션을 거부하는 모델이면 호출부에서 빼고 재시도)
            ...(useThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      // parts가 여러 개로 쪼개져 올 수 있어 모두 합침
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const out = parts.map(p => p.text || '').join('').trim();
      aiCallCount += 1; // 성공 호출 1회 = 한도 1회 소모
      if (onAiUsage) onAiUsage();
      const finish = data?.candidates?.[0]?.finishReason || '';
      if (!out) { lastGeminiError = `빈 응답 (${finish || '사유 불명'})`; return ''; }
      if (finish === 'MAX_TOKENS') { // 잘린 결과는 쓰지 않고 폴백 (문장이 중간에 끊김)
        lastGeminiError = '출력 잘림(MAX_TOKENS)';
        return '';
      }
      lastGeminiError = '';
      return out;
    }
    // 실패 사유를 남김 (키 오류/모델명/한도 구분)
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || '';
      // 429일 때 어떤 할당량인지(분당/일일/모델별) 함께 표시
      const vi = (err?.error?.details || []).find(d => (d['@type'] || '').includes('QuotaFailure'));
      const v = vi?.violations?.[0];
      if (v) detail += ` | quota=${v.quotaId || v.quotaMetric || '?'} limit=${v.quotaValue ?? '?'}`;
      const ri = (err?.error?.details || []).find(d => (d['@type'] || '').includes('RetryInfo'));
      if (ri?.retryDelay) detail += ` | retry=${ri.retryDelay}`;
    } catch (e2) { /* */ }
    lastGeminiError = `HTTP ${res.status}${res.status === 429 ? ' 한도초과' : ''}${detail ? ' — ' + detail.slice(0, 300) : ''} (model=${model})`;
    console.warn('Gemini 실패:', lastGeminiError);
  } catch (e) {
    lastGeminiError = e && e.name === 'AbortError' ? '시간 초과' : `네트워크 오류 (${e && e.message})`;
    console.warn('Gemini 호출 오류:', lastGeminiError);
  }
  clearTimeout(timer);
  return '';
}

// 문장 전체를 감싼 따옴표만 제거 (대화문 안의 따옴표는 보존)
function unwrapQuotes(s) {
  const t = (s || '').trim();
  if (t.length > 1 && /^["'`]/.test(t) && /["'`]$/.test(t)) {
    const inner = t.slice(1, -1);
    if (!/["'`]/.test(inner)) return inner.trim(); // 안쪽에 따옴표가 없을 때만 = 전체를 감싼 경우
  }
  return t;
}

// 여러 줄 응답에서 한글이 들어간 첫 줄만 추출 (서두·설명 제거)
function pickKoLine(out) {
  const lines = (out || '').split('\n').map(l => l.trim()).filter(Boolean);
  const line = lines.find(l => /[가-힣]/.test(l)) || '';
  return unwrapQuotes(line.replace(/^\d+[.)]\s*/, '')).trim();
}

// ─── 여러 항목을 묶어서 번역 (무료 한도 절약) ───
// 하루 20회 제한이라 한 번에 최대한 많이 묶어 보냄 (출력 한도는 8192로 충분)
const GEMINI_BATCH = 40;
async function geminiTranslateBatch(items, context, kind = 'auto') {
  if (!geminiKey || !items.length) return {};
  const all = {};
  for (let i = 0; i < items.length; i += GEMINI_BATCH) {
    const chunk = items.slice(i, i + GEMINI_BATCH);
    const part = await geminiTranslateChunk(chunk, context, kind);
    Object.assign(all, part);
    if (/429/.test(lastGeminiError)) break;              // 한도 초과면 중단
    if (i + GEMINI_BATCH < items.length) await new Promise(r => setTimeout(r, 13000)); // 분당 5회 → 13초 간격
  }
  return all;
}

async function geminiTranslateChunk(items, context, kind = 'auto') {
  const numbered = items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const isWord = kind === 'word' || (kind === 'auto' && items.every(t => !/\s/.test(t)));

  const rules = isWord
    ? `- 단어장에 쓰는 사전형(기본형)으로 번역하세요
  · 동사는 '~다' 로: dig → 파다 / hop → 깡충 뛰다 / leave → 떠나다
  · 형용사는 '~ㄴ/은' 으로: large → 큰 / safe → 안전한
  · 명사는 그대로: nut → 견과
- 문장으로 만들지 마세요 ("땅을 파요" ✕ → "파다" ○)
- 원문에 없는 목적어나 조사를 덧붙이지 마세요
- 가장 흔한 쉬운 뜻 하나만 (꼭 필요하면 쉼표로 최대 2개)`
    : `- 말투는 '~해요' 로 통일하고, 연결어미(~고, ~며)로 끝내지 말고 완결된 문장으로
- 원문에 대화문(따옴표)이 있으면 번역에도 따옴표를 그대로 살리세요
  예: "It's Fox!" Rabbit says. → "여우야!" 토끼가 말해요.
- '그의', '그녀', '그것' 같은 번역체 대명사는 쓰지 마세요. 등장인물 이름이나 '걔'처럼 아이가 쓰는 말로
  예: He sees his home. → 여우가 자기 집을 봐요.`;

  const prompt = `다음 영어 ${isWord ? '단어' : '문장'}들을 한국 초등학교 1학년이 이해할 수 있는 한국어로 번역해 주세요.
규칙:
${rules}
- 출력 형식: 각 줄에 "번호. 번역" 만. 설명은 붙이지 마세요
- 입력과 같은 개수의 줄을 출력
${context ? `참고 문맥: ${context}` : ''}

${numbered}`;

  const out = await geminiCall(prompt, 8192); // 생각 토큰까지 감안해 넉넉히
  if (!out) {
    addTranslateLog({ kind: 'AI 일괄', count: items.length, ok: 0, model: geminiModel || GEMINI_MODELS[0], error: lastGeminiError });
    return {};
  }
  const map = {};
  out.split('\n').forEach(line => {
    const m = line.trim().match(/^(\d+)[.)]\s*(.+)$/);
    if (!m) return;
    const idx = parseInt(m[1], 10) - 1;
    const val = unwrapQuotes(m[2]); // 대화문 따옴표는 살리고, 전체를 감싼 따옴표만 제거
    if (items[idx] && /[가-힣]/.test(val)) map[items[idx]] = val;
  });
  addTranslateLog({
    kind: 'AI 일괄', count: items.length, ok: Object.keys(map).length,
    model: geminiModel || '?',
    error: Object.keys(map).length < items.length ? `응답 누락 ${items.length - Object.keys(map).length}건` : '',
  });
  return map;
}

// 번역 결과 다듬기 — 문장 끝의 어색한 쉼표/공백 정리
function tidyKo(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*$/, '.')   // "꽃을 따고," → "꽃을 따고."
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

let lastEngine = ''; // 진단용: 마지막 번역에 쓰인 엔진
export function getLastTranslateEngine() { return lastEngine; }

async function translateToKo(word, opts = {}) {
  const w = (word || '').trim();
  if (!w) return '';
  // 문맥이 다르면 캐시를 재사용하지 않음 (같은 단어라도 레슨마다 뜻이 다를 수 있음)
  const ck = opts.context ? `${w}||${opts.context.slice(0, 60)}` : w;
  if (!opts.force && meaningCache.has(ck)) { lastEngine = 'cache'; return meaningCache.get(ck); }
  let txt = '';
  const isPhrase = /\s/.test(w); // 문장·구는 사전 조회 건너뜀

  // 1순위: Gemini (아이 눈높이·말투 통일·문맥 반영)
  // 단, 무료 한도(하루 20회)가 빡빡해 등록 시 단건 번역에는 쓰지 않음 (opts.ai로 명시할 때만)
  if (geminiKey && opts.ai) {
    txt = await geminiTranslate(w, opts.context);
    if (txt) lastEngine = 'gemini';
  }

  if (!txt && azureTranslatorKey) {
    if (!isPhrase) { txt = await azureDictionary(w); if (txt) lastEngine = 'azure-dict'; } // 단어만 사전 조회
    if (!txt) { txt = await azureTranslate(w); if (txt) lastEngine = 'azure'; }
  }
  if (!txt) { txt = await googleTranslate(w); if (txt) lastEngine = 'google'; }
  if (!txt) { txt = await myMemoryTranslate(w); if (txt) lastEngine = 'mymemory(무료)'; } // 마지막 안전망
  if (!txt) { lastEngine = '(실패)'; addTranslateLog({ kind: '단건', count: 1, ok: 0, model: '-', error: `번역 실패: ${w.slice(0, 30)}` }); }
  txt = tidyKo(txt);
  if (txt) meaningCache.set(ck, txt); // 실패는 캐시하지 않음 (한도 초과 시 영구 공백 방지)
  return txt;
}

// ─── 이름 + 조사 ("우진이의" / "태호의") ───
// 한글 마지막 글자에 받침이 있으면 '이의', 없으면 '의'
export function nameWithParticle(name) {
  const n = (name || '').trim();
  if (!n) return '';
  const last = n[n.length - 1];
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${n}의`; // 한글이 아니면 그대로
  const hasBatchim = (code - 0xac00) % 28 !== 0;
  return hasBatchim ? `${n}이의` : `${n}의`;
}

// 빌드 시간 (빌드 시 .env.local에서 고정)
const BUILD_TIME = process.env.REACT_APP_BUILD_TIME || 'dev';

// 날짜 간격 반복: 오늘 기준 ~1일/3일/7일 전 레슨에서 항목을 모음 (pick=항목 추출 함수)
// 간격 반복 목표: 하루 뒤 → 사흘 → 일주일 → 2주 → 한 달
// (14/30일은 단기기억을 장기기억으로 넘기는 구간)
const SPACED_TARGETS = [1, 3, 7, 14, 30];

// 여러 달의 레슨을 하나로 합침 — 월이 바뀌어도 지난달 레슨을 복습할 수 있게
function flattenAllDays(dataObj) {
  const out = [];
  Object.values(dataObj || {}).forEach(arr => {
    (arr || []).forEach(d => { if (d) out.push(d); });
  });
  return out;
}

// "정확히 N일 전"이 아니라 "N일쯤 지난 것 중 가장 가까운 레슨"을 고름
// → 주 3회(월·수·금)처럼 간격이 불규칙해도 항상 후보가 잡힘
function buildSpacedItems(days, pick) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = 86400000;

  // 날짜가 있는 레슨만, 지난 일수 계산 (오늘 것은 복습 대상이 아님)
  const dated = (days || [])
    .map((d, i) => {
      if (!d || !d.date) return null;
      const dt = new Date(d.date + 'T00:00:00');
      if (isNaN(dt)) return null;
      const ago = Math.round((today - dt) / DAY);
      return ago >= 1 ? { d, i, ago } : null;
    })
    .filter(Boolean);

  if (dated.length === 0) {
    return (days || []).flatMap(d => pick(d) || []).filter(Boolean); // 폴백: 전체
  }

  const out = [];
  const used = new Set();
  SPACED_TARGETS.forEach(off => {
    // 아직 안 쓴 레슨 중 목표 간격에 가장 가까운 것 (차이 절반 이내일 때만)
    let best = null;
    dated.forEach(item => {
      if (used.has(item.i)) return;
      const diff = Math.abs(item.ago - off);
      if (diff > Math.max(1.5, off * 0.5)) return; // 너무 동떨어진 레슨은 제외
      if (!best || diff < best.diff) best = { ...item, diff };
    });
    if (best) {
      used.add(best.i);
      (pick(best.d) || []).forEach(x => { if (x) out.push(x); });
    }
  });

  // 하나도 못 찾으면 가장 최근 레슨(오늘 제외)이라도 복습
  if (out.length === 0) {
    const recent = [...dated].sort((a, b) => a.ago - b.ago)[0];
    return (pick(recent.d) || []).filter(Boolean);
  }
  return out;
}
function buildSpacedReviewWords(days) { return buildSpacedItems(days, d => d.words || []); }
function buildSpacedSentences(days) { return buildSpacedItems(days, d => (d.sentences || []).map(s => (typeof s === 'string' ? s : (s && s.text)) || '')); }

// (Azure 사용량은 Firestore 기반 — firebase.js에서 관리)

// localStorage key
const STORAGE_KEY = 'woojin-phonics-data-v2';

// 현재 년/월
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;

// 기본 데이터: { "YYYY-MM": [ {id, name, words} ] }
const toKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

const DEFAULT_DATA = {
  [toKey(CUR_YEAR, CUR_MONTH)]: [
    { id: Date.now(), name: 'Day 1', words: ['apple', 'ant', 'arm'] },
    { id: Date.now() + 1, name: 'Day 2', words: ['bear', 'ball', 'bus'] },
  ]
};

// localStorage 헬퍼
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;  // v2 구조
      }
    }
    // v1 배열 데이터 마이그레이션
    const oldRaw = localStorage.getItem('woojin-phonics-days');
    if (oldRaw) {
      const oldParsed = JSON.parse(oldRaw);
      if (Array.isArray(oldParsed) && oldParsed.length > 0) {
        const key = toKey(CUR_YEAR, CUR_MONTH);
        const migrated = { [key]: oldParsed.map((d, i) => d.id ? d : { ...d, id: Date.now() + i }) };
        return migrated;
      }
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_DATA;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── 문장 데이터 관련 ───
const SENTENCE_STORAGE_KEY = 'woojin-sentence-data';

function loadSentenceData() {
  try {
    const raw = localStorage.getItem(SENTENCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveSentenceData(data) {
  localStorage.setItem(SENTENCE_STORAGE_KEY, JSON.stringify(data));
}

// ─── 암기 데이터 관련 ───
const MEMORIZE_STORAGE_KEY = 'woojin-memorize-data';

function loadMemorizeData() {
  try {
    const raw = localStorage.getItem(MEMORIZE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveMemorizeLocalData(data) {
  localStorage.setItem(MEMORIZE_STORAGE_KEY, JSON.stringify(data));
}

// 메인 App 컴포넌트
// ======================================================
function App() {
  // 화면 전환: 'learning' | 'sentence' | 'admin' | 'find' | 'memorize'
  const [screen, setScreen] = useState('learning');

  // 관리 팝업
  const [showWordAdmin, setShowWordAdmin] = useState(false);
  const [showSentenceAdmin, setShowSentenceAdmin] = useState(false);

  // 문장 데이터
  const [sentenceData, setSentenceData] = useState(() => loadSentenceData());

  // 암기 데이터
  const [memorizeData, setMemorizeData] = useState(() => loadMemorizeData());

  // Azure 사용량 (Firestore 실시간)
  const [usageData, setUsageData] = useState({ speechChars: 0, visionCalls: 0 });
  const [cacheCount, setCacheCount] = useState(0);

  // 계정별 TTS 사용량 (10만자 고정 제한)
  const [userUsage, setUserUsage] = useState({ speechChars: 0 });
  const TTS_LIMIT = 100000;

  // 인증 상태
  const [currentUser, setCurrentUser] = useState(undefined); // undefined=로딩, null=비로그인, {uid, username}=로그인
  const [displayName, setDisplayName] = useState('');

  // 브라우저 탭 제목 = 로그인 이름 기반
  useEffect(() => {
    const nm = displayName || currentUser?.username;
    document.title = nm ? `${nameWithParticle(nm)} 펀펀영어` : '펀펀영어';
  }, [displayName, currentUser]);

  // 앱 공용 설정(Pixabay/Azure 키 등) Firestore에서 로드 → 모든 기기 공통
  useEffect(() => {
    loadAppConfig().then(cfg => {
      if (!cfg) return;
      if (cfg.pixabayKey) { pixabayApiKey = cfg.pixabayKey; setPixabayKeyInput(cfg.pixabayKey); }
      if (cfg.githubToken) { setGithubTokenInput(cfg.githubToken); localStorage.setItem('woojin-github-token', cfg.githubToken); }
      if (cfg.youtubeKey) { setYoutubeKeyInput(cfg.youtubeKey); }
      // 번역: Azure Translator 우선, 없으면 무료 API
      if (cfg.translatorKey) { azureTranslatorKey = cfg.translatorKey; setTranslateKeyInput(cfg.translatorKey); }
      if (cfg.translatorRegion) { azureTranslatorRegion = cfg.translatorRegion; setTranslateRegionInput(cfg.translatorRegion); }
      if (cfg.geminiKey) { geminiKey = cfg.geminiKey; setGeminiKeyInput(cfg.geminiKey); }
      if (cfg.azureKey !== undefined) { setAzureKey(cfg.azureKey || ''); localStorage.setItem('woojin-azure-key', cfg.azureKey || ''); }
      if (cfg.azureRegion) { setAzureRegion(cfg.azureRegion); localStorage.setItem('woojin-azure-region', cfg.azureRegion); }
      if (cfg.azureVoice) { setAzureVoice(cfg.azureVoice); localStorage.setItem('woojin-azure-voice', cfg.azureVoice); }
      if (cfg.azureVisionKey !== undefined) { setAzureVisionKey(cfg.azureVisionKey || ''); localStorage.setItem('woojin-azure-vision-key', cfg.azureVisionKey || ''); }
      if (cfg.azureVisionEndpoint !== undefined) { setAzureVisionEndpoint(cfg.azureVisionEndpoint || ''); localStorage.setItem('woojin-azure-vision-endpoint', cfg.azureVisionEndpoint || ''); }
      if (cfg.azureVerified !== undefined) { setAzureVerified(!!cfg.azureVerified); localStorage.setItem('woojin-azure-verified', cfg.azureVerified ? 'true' : 'false'); }
    });
  }, [currentUser]);

  // 전체 데이터 — localStorage 먼저, Firestore 비동기 로드
  const [data, setData] = useState(() => loadData());

  // Firestore 로딩 상태
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false); // 서버 연결 실패 → 저장 안 됨 안내
  const [voiceError, setVoiceError] = useState('');      // 공용 안내 배너 (음성 실패 등)
  useEffect(() => subscribeNotice(setVoiceError), []);   // 모든 화면에서 온 안내를 받아 표시
  const savingRef = useRef(false); // 자체 저장 중인지 (리스너에서 무시용)

  // 년/월 선택
  const [selectedYear, setSelectedYear] = useState(CUR_YEAR);
  const [selectedMonth, setSelectedMonth] = useState(CUR_MONTH);

  // 학습 상태
  const [selectedDayIndex, setSelectedDayIndex] = useState(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [displayWord, setDisplayWord] = useState('');
  const [learnMode, setLearnMode] = useState('phonics'); // 'phonics'=파닉스 발음부터, 'word'=단어만 읽기
  const [learnView, setLearnView] = useState('home'); // 'home' | 'course'(세트) | 'list'(단어 학습)
  const [showFindWord, setShowFindWord] = useState(false); // 단어 찾기 팝업
  const [previewOpen, setPreviewOpen] = useState(false); // 단어 미리보기 접기/펼치기 (기본 접힘)
  const [chipSpeaking, setChipSpeaking] = useState(''); // 미리보기 칩 재생 중인 단어 (연타 방지)
  const chipBusyRef = useRef(false);
  const [showWordShoot, setShowWordShoot] = useState(false); // 단어 게임 (단어학습 하단, 새총/베기 랜덤)
  const [wordGameType, setWordGameType] = useState('shoot'); // 'shoot' | 'slice' — 열 때 랜덤 결정
  const wordGameFromCourseRef = useRef(false); // 게임이 세트학습에서 열렸는가 (메달은 이 경우에만)
  const [fixWords, setFixWords] = useState([]); // ⚠️ 어려워한 단어만 다시 학습할 목록
  const [pixabayKeyInput, setPixabayKeyInput] = useState(''); // Pixabay 키 입력(설정)
  const [githubTokenInput, setGithubTokenInput] = useState(localStorage.getItem('woojin-github-token') || ''); // GitHub 토큰(설정)
  const [pixabayStatus, setPixabayStatus] = useState('idle'); // idle|checking|ok|fail|empty
  const [githubStatus, setGithubStatus] = useState('idle');
  const [youtubeKeyInput, setYoutubeKeyInput] = useState(''); // YouTube Data API 키(설정)
  const [youtubeStatus, setYoutubeStatus] = useState('idle');
  const [translateKeyInput, setTranslateKeyInput] = useState(''); // Azure Translator 키(설정)
  const [translateRegionInput, setTranslateRegionInput] = useState('koreacentral');
  const [translateStatus, setTranslateStatus] = useState('idle');
  const [translateInfo, setTranslateInfo] = useState(''); // 마지막 테스트 결과(엔진 포함)
  const [geminiKeyInput, setGeminiKeyInput] = useState(''); // Gemini API 키 (AI 번역)
  const [logsText, setLogsText] = useState(''); // 진단 로그 표시
  const [transLogText, setTransLogText] = useState(''); // 번역 로그 표시 (개발자용)
  const [phonicsCount, setPhonicsCount] = useState(0);        // 등록된 파닉스 음원 수
  const [phonicsUploading, setPhonicsUploading] = useState(false);
  const [phonicsProgress, setPhonicsProgress] = useState('');
  const [patchNote, setPatchNote] = useState(null); // 첫 화면 패치 노트
  const [aiUsed, setAiUsed] = useState(0); // 오늘 사용한 AI 번역 횟수 (기기 공용)

  // 설정 관련 상태 (Azure Key & Region)
  const [showSettings, setShowSettings] = useState(false);
  const [azureKey, setAzureKey] = useState(() => localStorage.getItem('woojin-azure-key') || '');
  const [azureRegion, setAzureRegion] = useState(() => localStorage.getItem('woojin-azure-region') || 'koreacentral');
  const [azureVerified, setAzureVerified] = useState(() => localStorage.getItem('woojin-azure-verified') === 'true');
  const [azureVerifying, setAzureVerifying] = useState(false);
  const [azureVoice, setAzureVoice] = useState(() => localStorage.getItem('woojin-azure-voice') || 'en-US-JennyNeural');
  const [azureVisionKey, setAzureVisionKey] = useState(() => localStorage.getItem('woojin-azure-vision-key') || '');
  const [azureVisionEndpoint, setAzureVisionEndpoint] = useState(() => localStorage.getItem('woojin-azure-vision-endpoint') || '');

  // PWA 설치 프롬프트
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // 계정 삭제 관련 상태
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // 음성 인식 관련 상태
  const [isWaitingForSpeech, setIsWaitingForSpeech] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [recordReady, setRecordReady] = useState(false); // 마이크 녹음 준비 완료 여부
  const [speechFeedback, setSpeechFeedback] = useState('');
  const [passThreshold, setPassThreshold] = useState(() => parseInt(localStorage.getItem('woojin-pass-threshold')) || 60); // 발음 합격 점수(난이도)
  const [judgeMode, setJudgeMode] = useState(() => localStorage.getItem('woojin-judge-mode') || 'word'); // 'word'(단어 판정) | 'pron'(발음 판정)
  const [lessonSortKey, setLessonSortKey] = useState(() => localStorage.getItem('woojin-lesson-sort-key') || 'name'); // 'name' | 'date'
  const [lessonSortOrder, setLessonSortOrder] = useState(() => localStorage.getItem('woojin-lesson-sort-order') || 'asc'); // 'asc' | 'desc'

  // 발음 평가 관련 상태 (단어학습)
  const [wordAssessResult, setWordAssessResult] = useState(null);
  const [wordRecordedAudioUrl, setWordRecordedAudioUrl] = useState(null);
  const [isPlayingWordRecording, setIsPlayingWordRecording] = useState(false);
  const wordMediaRecorderRef = useRef(null);
  const wordRecordedChunksRef = useRef([]);
  const wordRecordedAudioRef = useRef(null);
  const wordRecognizerRef = useRef(null);
  const wordStreamRef = useRef(null);      // 마이크 스트림 (해제 보장)
  const wordHeardRef = useRef('');         // 연속 인식으로 모은 텍스트
  const wordScoresRef = useRef([]);        // 발음 점수 (pron 모드)
  const wordFinishRef = useRef(null);      // [다 말했어요] → 종료+채점 함수
  const wordSafetyTimerRef = useRef(null); // 2분 방치 안전장치
  const wordAssessActiveRef = useRef(false); // 평가 진행 중 여부 (권한 대기 중 취소 감지)

  const audioRef = useRef(new Audio());
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const resumeResolveRef = useRef(null);

  // 현재 선택된 년/월의 키와 Day 목록
  const currentKey = toKey(selectedYear, selectedMonth);
  const days = data[currentKey] || [];

  // ─── Firebase Auth 리스너 ───
  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setCurrentUser(user); // null or {uid, username}
    });
    return unsub;
  }, []);

  // ─── PWA 설치 프롬프트 리스너 ───
  useEffect(() => {
    // 이미 설치된 경우 감지 (standalone 모드)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsAppInstalled(true);
    }
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // ─── Firestore 초기 로드 + 실시간 동기화 ───
  useEffect(() => {
    // 로그아웃 또는 계정 전환 시 상태 초기화
    setDisplayName('');
    setFirebaseReady(false);
    setShowSettings(false);
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError('');
    if (!currentUser) return; // 로그인 전에는 Firestore 접근하지 않음
    const uid = currentUser.uid;

    // 초기 Firestore 로드 (첫 로그인 시 기존 데이터 마이그레이션)
    (async () => {
      console.log('[앱] 🔑 현재 유저 UID:', uid, '| username:', currentUser.username);
      // 콘솔에서 병합 실행 가능하도록 전역 등록
      window.__mergeUserData = mergeUserData;
      window.__currentUid = uid;
      console.log('[앱] 💡 병합하려면 콘솔에서: window.__mergeUserData("보낼UID", "받을UID")');

      const migrated = await migrateOldDataToUser(uid);
      console.log('[앱] 마이그레이션 결과:', migrated);
      // 프로필에서 이름 로드 + users/{uid} 문서 항상 생성
      try {
        const { loadUserProfile, ensureUserDoc } = await import('./firebase');
        const profile = await loadUserProfile(uid);
        if (profile && profile.name) setDisplayName(profile.name);
        console.log('[앱] 프로필:', profile);
        // Console에서 보이도록 users/{uid} 상위 문서 항상 생성
        await ensureUserDoc(uid, currentUser.username, profile?.name || '');
      } catch(e) { console.warn('[앱] 프로필 로드 실패:', e); }
      // ⚠️ 로드 실패(undefined)면 로컬 캐시를 절대 지우지 않음 — 오프라인에서 데이터 소실 방지
      let offline = false;

      const fbData = await loadDataFromFirestore(uid);
      console.log('[앱] Firestore words:', fbData ? '있음' : (fbData === undefined ? '로드 실패' : '없음'));
      if (fbData) { setData(fbData); saveData(fbData); }
      else if (fbData === undefined) { offline = true; } // 기존 로컬 데이터 유지
      else { setData({}); saveData({}); }

      const fbSentences = await loadSentenceDataFromFirestore(uid);
      console.log('[앱] Firestore sentences:', fbSentences ? '있음' : (fbSentences === undefined ? '로드 실패' : '없음'));
      if (fbSentences) { setSentenceData(fbSentences); saveSentenceData(fbSentences); }
      else if (fbSentences === undefined) { offline = true; }
      else { setSentenceData({}); saveSentenceData({}); }

      const fbMemorize = await loadMemorizeDataFromFirestore(uid);
      console.log('[앱] Firestore memorize:', fbMemorize ? '있음' : (fbMemorize === undefined ? '로드 실패' : '없음'));
      if (fbMemorize) { setMemorizeData(fbMemorize); saveMemorizeLocalData(fbMemorize); }
      else if (fbMemorize === undefined) { offline = true; }
      else { setMemorizeData({}); saveMemorizeLocalData({}); }

      setOfflineMode(offline); // 화면 상단에 안내 배너
      setFirebaseReady(true);
      console.log('[앱] ✅ Firestore 초기화 완료');
    })();

    // 실시간 리스너
    const unsubData = onDataChange(uid, (newData) => {
      if (!savingRef.current) {
        setData(newData);
        saveData(newData);
      }
    });
    const unsubSentences = onSentenceDataChange(uid, (newData) => {
      if (!savingRef.current) {
        setSentenceData(newData);
        saveSentenceData(newData);
      }
    });
    const unsubMemorize = onMemorizeDataChange(uid, (newData) => {
      if (!savingRef.current) {
        setMemorizeData(newData);
        saveMemorizeLocalData(newData);
      }
    });
    const unsubUsage = onUsageChange((usage) => {
      setUsageData(usage);
    });
    // 계정별 사용량 리스너
    const unsubUserUsage = onUserUsageChange(uid, (usage) => {
      setUserUsage(usage);
    });
    return () => { unsubData(); unsubSentences(); unsubMemorize(); unsubUsage(); unsubUserUsage(); };
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 변경 시 저장 (localStorage + Firestore)
  useEffect(() => {
    saveData(data);
    if (firebaseReady && currentUser) {
      savingRef.current = true;
      console.log('[저장] words → Firestore 저장 시도, uid:', currentUser.uid);
      saveDataToFirestore(currentUser.uid, data)
        .then(() => console.log('[저장] words → Firestore 저장 성공'))
        .catch(e => console.error('[저장] words → Firestore 저장 실패:', e))
        .finally(() => { setTimeout(() => { savingRef.current = false; }, 500); });
    }
  }, [data, firebaseReady]);

  // 문장 데이터 변경 시 저장 (localStorage + Firestore)
  useEffect(() => {
    saveSentenceData(sentenceData);
    if (firebaseReady && currentUser) {
      savingRef.current = true;
      saveSentenceDataToFirestore(currentUser.uid, sentenceData).finally(() => { setTimeout(() => { savingRef.current = false; }, 500); });
    }
  }, [sentenceData, firebaseReady]);

  // 암기 데이터 변경 시 저장 (localStorage + Firestore)
  useEffect(() => {
    saveMemorizeLocalData(memorizeData);
    if (firebaseReady && currentUser) {
      savingRef.current = true;
      saveMemorizeDataToFirestore(currentUser.uid, memorizeData).finally(() => { setTimeout(() => { savingRef.current = false; }, 500); });
    }
  }, [memorizeData, firebaseReady]);

  // 년/월 변경 시 Day 선택 초기화
  const handleYearChange = (y) => { setSelectedYear(y); setSelectedDayIndex(-1); };
  const handleMonthChange = (m) => { setSelectedMonth(m); setSelectedDayIndex(-1); };

  // 데이터에 존재하는 년도 목록 (현재 년도 포함) (사용되지 않음)
  // eslint-disable-next-line no-unused-vars
  const availableYears = [...new Set([
    CUR_YEAR,
    ...Object.keys(data).map(k => parseInt(k.split('-')[0]))
  ])].sort();

  // ─── TTS 관련 ───
  const getFemaleVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    let voice = voices.find(v => v.name === 'Google US English');
    if (!voice) voice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
    if (!voice) voice = voices.find(v => v.name.includes('Zira') || v.name.includes('Samantha'));
    return voice;
  };

  const wakeUpEngine = () => {
    const synth = window.speechSynthesis;
    const ut = new SpeechSynthesisUtterance('');
    synth.speak(ut);
    audioRef.current.play().catch(() => { });
  };

  const speakAndWait = (text, rate = 0.7) => {
    return new Promise((resolve) => {
      if (abortRef.current) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = rate;
      const voice = getFemaleVoice();
      if (voice) utterance.voice = voice;
      const forceNext = setTimeout(resolve, 3000);
      utterance.onend = () => { clearTimeout(forceNext); resolve(); };
      utterance.onerror = () => { clearTimeout(forceNext); resolve(); };
      synth.speak(utterance);
    });
  };

  // ─── 오디오 재생 ───
  const playAudio = useCallback((letter) => new Promise((res) => {
    if (abortRef.current) { res(); return; }
    const fileName = `${letter.toLowerCase()}_phonics.mp3`;
    const audioPath = process.env.PUBLIC_URL + `/audio/${fileName}`;
    const audio = audioRef.current;
    audio.src = audioPath;
    audio.volume = 1.0;
    audio.load();
    const checkNoiseCut = () => {
      if (audio.duration - audio.currentTime < 0.15) {
        audio.volume = 0;
        audio.removeEventListener('timeupdate', checkNoiseCut);
      }
    };
    audio.addEventListener('timeupdate', checkNoiseCut);
    audio.onended = res;
    audio.onerror = res;
    audio.play().catch(res);
  }), []);

  // ─── 이미지 프리로드 헬퍼 (실제 로드 확인 후 URL 반환) ───
  const preloadImage = useCallback((url, timeoutMs = 6000) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
      img.src = url;
    });
  }, []);

  // ─── 이미지 검색 (Pixabay) ───
  const fetchImage = useCallback(async (word) => {
    const query = (word || '').toLowerCase().trim();
    setImageLoading(true);
    setImageUrl('');
    try {
      let imgUrl = imageUrlCache.has(query) ? imageUrlCache.get(query) : await arasaacSearch(query);
      if (imgUrl) {
        imageUrlCache.set(query, imgUrl);
        await preloadImage(imgUrl);
        setImageUrl(imgUrl);
        setImageLoading(false);
        return;
      }
    } catch { /* 실패 */ }
    setImageUrl('');
    setImageLoading(false);
  }, [preloadImage]);

  // ─── 이미지 URL만 반환 (세트 코스/개별 도구용, 상태 변경 없음) ───
  const getImageUrl = useCallback(async (word) => {
    const query = (word || '').toLowerCase().trim();
    if (!query) return '';
    // 직접 지정한 그림이 있으면 최우선
    const ov = (days[selectedDayIndex]?.images || {})[query];
    if (ov) return ov;
    if (imageUrlCache.has(query)) return imageUrlCache.get(query); // 세션 캐시 → 즉시 (없음도 캐시)
    try {
      const url = await arasaacSearch(query);
      imageUrlCache.set(query, url || ''); // 결과 없음도 기록 → 재조회 방지
      return url || '';
    } catch { /* ignore */ }
    return '';
  }, [days, selectedDayIndex]);

  // ─── 레슨 이미지 미리 받아두기 (학습 진입 시 백그라운드) ───
  const prefetchLessonImages = useCallback(async (words) => {
    const list = [...new Set((words || []).map(w => (w || '').toLowerCase().trim()).filter(Boolean))]
      .filter(w => !imageUrlCache.has(w));
    if (!list.length) return;
    const CONC = 4; // 동시 4개씩 (API 부담 최소화)
    for (let i = 0; i < list.length; i += CONC) {
      await Promise.all(list.slice(i, i + CONC).map(async (w) => {
        try {
          const url = await arasaacSearch(w);
          imageUrlCache.set(w, url || '');
          if (url) { const im = new Image(); im.src = url; } // 브라우저 캐시에 그림까지 적재
        } catch { imageUrlCache.set(w, ''); }
      }));
    }
  }, []);

  // ─── Azure 단어 발음 (캐시 지원) ───
  const speakWordAzure = useCallback((text, rate = 0.7) => {
    return new Promise((resolve) => {
      const pct = Math.round((rate - 1) * 100);
      const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
      const cacheKey = makeCacheKey(text, azureVoice, rateStr);
      getCachedAudio(cacheKey).then(cached => {
        if (cached) { playCachedAudio(cached).then(resolve); return; }
        if (userUsage.speechChars >= TTS_LIMIT) { showNotice(VOICE_MSG.limit); resolve(); return; }
        addSpeechUsageFirestore(text.length, currentUser?.uid);
        const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
        const synth = new speechsdk.SpeechSynthesizer(sc, null);
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${azureVoice}"><prosody rate="${rateStr}" pitch="+0%">${text}</prosody></voice></speak>`;
        synth.speakSsmlAsync(ssml, (result) => {
          synth.close();
          if (result.audioData && result.audioData.byteLength > 0) {
            const arr = new Uint8Array(result.audioData);
            setCachedAudio(cacheKey, arr);
            playCachedAudio(arr).then(resolve);
          } else { showNotice(VOICE_MSG.fail); resolve(); }
        }, (err) => {
          console.error('Azure TTS 에러:', err); synth.close();
          showNotice(VOICE_MSG.network);
          resolve();
        });
      }).catch(() => resolve());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureVoice, azureKey, azureRegion, currentUser, userUsage]);

  // ─── 오디오 미리 합성 + 메모리 로드 — 칭찬 등 즉시 재생용 (Azure는 캐시 없을 때 1회만) ───
  const praiseMemRef = useRef({}); // cacheKey → 오디오 바이트 (메모리, 즉시 재생)
  const prewarmAudio = useCallback((text, rate = 1.15) => {
    try {
      if (!(azureVerified && azureKey && azureRegion)) return;
      const pct = Math.round((rate - 1) * 100);
      const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
      const cacheKey = makeCacheKey(text, azureVoice, rateStr);
      if (praiseMemRef.current[cacheKey]) return; // 이미 메모리에 있음
      getCachedAudio(cacheKey).then(cached => {
        if (cached) { praiseMemRef.current[cacheKey] = cached; return; } // 캐시 → 메모리 로드
        if (userUsage.speechChars >= TTS_LIMIT) return;
        addSpeechUsageFirestore(text.length, currentUser?.uid);
        const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
        const synth = new speechsdk.SpeechSynthesizer(sc, null);
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${azureVoice}"><prosody rate="${rateStr}" pitch="+0%">${text}</prosody></voice></speak>`;
        synth.speakSsmlAsync(ssml, (result) => {
          synth.close();
          if (result.audioData && result.audioData.byteLength > 0) {
            const arr = new Uint8Array(result.audioData);
            setCachedAudio(cacheKey, arr);
            praiseMemRef.current[cacheKey] = arr;
          }
        }, () => synth.close());
      }).catch(() => {});
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureVoice, azureKey, azureRegion, azureVerified, currentUser, userUsage]);

  // ─── 단어 발음: Azure 우선, 미설정 시 브라우저 TTS 폴백 ───
  const speakWord = useCallback((text, rate = 0.7) => {
    if (azureVerified && azureKey && azureRegion) return speakWordAzure(text, rate);
    return speakAndWait(text, rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureVerified, azureKey, azureRegion, speakWordAzure]);

  // ─── 세트/단어 학습용 단어 발음 ───
  const speakWordSimple = useCallback((word) => {
    abortRef.current = false;
    return speakWord(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakWord]);

  // ─── 칭찬 즉시 재생: 메모리에 있으면 바로, 없으면 일반 경로 ───
  const speakPraiseFast = useCallback((text) => {
    const cacheKey = makeCacheKey(text, azureVoice, '+15%');
    const mem = praiseMemRef.current[cacheKey];
    if (mem) { playCachedAudio(mem); return Promise.resolve(); }
    return speakWord(text, 1.15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureVoice, speakWord]);

  // ─── 단어 학습 재생 정지 ───
  const stopWordPlay = useCallback(() => {
    abortRef.current = true;
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { audioRef.current.pause(); } catch (e) { /* */ }
  }, []);

  // ─── 단어 재생 (그냥 듣기 / 파닉스) — 반복·간격 지정 가능 ───
  const playWordSequence = useCallback(async (word, mode, repeat = 3, gapMs = 700, rate = 0.7) => {
    abortRef.current = false;
    unlockAudio();      // 오디오 언락 (사용자 제스처 내에서 호출됨)
    wakeUpEngine();     // 브라우저 TTS + 오디오 엘리먼트 깨우기
    const w = (word || '').toLowerCase().trim();
    if (!w) return;
    const rep = Math.max(1, repeat || 1);
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    if (mode === 'phonics') {
      const letters = w.split('').filter(c => /[a-z]/.test(c)); // 글자별 파닉스 소리(mp3)
      if (letters.length) {
        for (let r = 0; r < rep; r++) {
          for (const c of letters) { if (abortRef.current) return; await playAudio(c); await delay(Math.round(gapMs / 2)); } // 글자 소리 하나씩
          if (abortRef.current) return;
          await delay(gapMs);
          await speakWord(w, rate); // 합쳐서 단어
          await delay(gapMs);
        }
        return;
      }
    }
    for (let i = 0; i < rep; i++) { if (abortRef.current) return; await speakWord(w, rate); await delay(gapMs); } // 단어
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakWord, playAudio]);

  // ─── 일시정지 대기 헬퍼 ───
  const waitForResume = () => {
    if (!pauseRef.current) return Promise.resolve();
    return new Promise(resolve => { resumeResolveRef.current = resolve; });
  };

  // ─── 단일 단어 학습 사이클 ───
  const learnOneWord = async (word) => {
    const cleanWord = word.toLowerCase().trim();
    const firstLetter = cleanWord[0];

    setDisplayWord(cleanWord);
    fetchImage(cleanWord);

    // 파닉스 모드: 알파벳 이름 → 파닉스 음가 (첫 글자가 알파벳일 때만)
    if (learnMode === 'phonics' && /[a-z]/.test(firstLetter)) {
      // 알파벳 이름 3회
      setCurrentStep('alphabet');
      for (let i = 0; i < 3; i++) {
        if (abortRef.current) return;
        await waitForResume();
        await speakAndWait(firstLetter);
        await new Promise(r => setTimeout(r, 800));
      }

      // 파닉스 음가 3회
      setCurrentStep('phonics');
      for (let i = 0; i < 3; i++) {
        if (abortRef.current) return;
        await waitForResume();
        await playAudio(firstLetter);
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // 단어 전체 3회 (두 모드 공통)
    setCurrentStep('word');
    for (let i = 0; i < 3; i++) {
      if (abortRef.current) return;
      await waitForResume();
      await speakAndWait(word);
      await new Promise(r => setTimeout(r, 900));
    }
  };

  // ─── 학습 완료 마킹 + 로그 기록 ───
  const markWordLearned = (dayIdx, wordIdx) => {
    const dayData = days[dayIdx];
    const word = dayData?.words[wordIdx];
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) => {
          if (i !== dayIdx) return d;
          const learned = d.learnedWords ? [...d.learnedWords] : [];
          if (!learned.includes(wordIdx)) learned.push(wordIdx);
          return { ...d, learnedWords: learned };
        })
      };
    });
  };

  // 세트학습 전체 완주 기록 (금메달)
  const markSetCleared = (dayIdx) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx
            ? { ...d, setClearedAt: new Date().toISOString(), setClearedCount: (d.setClearedCount || 0) + 1 }
            : d
        )
      };
    });
  };

  // ─── 학습 시작 (선택된 Day의 현재 단어 학습) ───
  const startLearning = async () => {
    unlockAudio();
    if (isPlaying || selectedDayIndex < 0) return;
    const dayData = days[selectedDayIndex];
    if (!dayData || dayData.words.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    setIsWaitingForSpeech(false);
    setIsListening(false);
    setSpeechFeedback('');
    abortRef.current = false;
    pauseRef.current = false;
    wakeUpEngine();

    await learnOneWord(dayData.words[currentWordIndex]);

    if (!abortRef.current) {
      setCurrentStep('');
      setIsWaitingForSpeech(true);
    } else {
      setIsPlaying(false);
    }
  };

  // ─── 다음 단어로 넘어가기 ───
  // 단어 읽기평가 마이크 정리 (어느 경로로 나가든 마이크가 남지 않게)
  const cleanupWordMic = useCallback(() => {
    wordAssessActiveRef.current = false;
    wordFinishRef.current = null;
    if (wordSafetyTimerRef.current) { clearTimeout(wordSafetyTimerRef.current); wordSafetyTimerRef.current = null; }
    if (wordRecognizerRef.current) { try { wordRecognizerRef.current.close(); } catch (e) { /* */ } wordRecognizerRef.current = null; }
    if (wordMediaRecorderRef.current && wordMediaRecorderRef.current.state !== 'inactive') { try { wordMediaRecorderRef.current.stop(); } catch (e) { /* */ } }
    wordMediaRecorderRef.current = null;
    if (wordStreamRef.current) { try { wordStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } wordStreamRef.current = null; }
    setIsListening(false);
    setRecordReady(false);
  }, []);

  // 앱을 벗어날 때 마이크 정리
  useEffect(() => () => cleanupWordMic(), [cleanupWordMic]);
  // 화면이 바뀌면(문장학습·책읽기 등으로 이동) 마이크 정리
  useEffect(() => { if (screen !== 'learning') cleanupWordMic(); }, [screen, cleanupWordMic]);

  const goToNextWord = async () => {
    cleanupWordMic(); // 인식 중이면 중단 (이전 단어 결과가 다음 단어에 적립되지 않게)
    setIsWaitingForSpeech(false);
    setSpeechFeedback('');
    setWordAssessResult(null);
    stopWordRecording();
    if (wordRecordedAudioUrl) { URL.revokeObjectURL(wordRecordedAudioUrl); }
    setWordRecordedAudioUrl(null);
    const dayData = days[selectedDayIndex];

    if (currentWordIndex + 1 < dayData.words.length) {
      const nextIndex = currentWordIndex + 1;
      setCurrentWordIndex(nextIndex);
      abortRef.current = false;
      await learnOneWord(dayData.words[nextIndex]);
      if (!abortRef.current) {
        setCurrentStep('');
        setIsWaitingForSpeech(true);
      } else {
        setIsPlaying(false);
      }
    } else {
      setIsPlaying(false);
      setCurrentWordIndex(0);
    }
  };

  // ─── 음성 인식 + 발음 평가 (Azure Pronunciation Assessment) ───
  const startSpeechRecognition = async () => {
    wordAssessActiveRef.current = true;
    if (!azureKey || !azureRegion) {
      wordAssessActiveRef.current = false;
      alert("Azure 음성 서비스 Key와 Region을 먼저 설정해주세요. (상단 ⚙️ 설정 버튼)");
      setShowSettings(true);
      return;
    }

    unlockAudio();
    setIsListening(true);
    setRecordReady(false);
    setSpeechFeedback('');
    setWordAssessResult(null);
    setWordRecordedAudioUrl(null);

    // MediaRecorder로 녹음 시작 (권한 대기를 기다린 뒤 진행 — 늦게 켜져 마이크가 남는 문제 방지)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
      wordStreamRef.current = stream;
      // 기다리는 사이 사용자가 중단했으면 바로 해제
      if (!wordAssessActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        wordStreamRef.current = null;
        return;
      }
      wordRecordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) wordRecordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(wordRecordedChunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        setWordRecordedAudioUrl(url);
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* */ }
        if (wordStreamRef.current === stream) wordStreamRef.current = null;
      };
      recorder.start();
      wordMediaRecorderRef.current = recorder;
    } catch (e) {
      console.warn('MediaRecorder 시작 실패:', e);
      if (wordStreamRef.current) { try { wordStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e2) { /* */ } wordStreamRef.current = null; }
    }
    // 권한 대기 중에 사용자가 중지했으면 여기서 종료 (마이크만 켜지는 것 방지)
    if (!wordAssessActiveRef.current) { setIsListening(false); setRecordReady(false); return; }

    // Azure Pronunciation Assessment 설정
    const speechConfig = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    speechConfig.speechRecognitionLanguage = "en-US";
    speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "5000");
    speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "3500");

    const currentWord = displayWord.trim();
    const judgeModeNow = localStorage.getItem('woojin-judge-mode') || 'word';

    const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);
    // 목표 단어를 인식 힌트로 제공 (PhraseList) — 비슷한 발음을 목표 단어로 우선 인식 (okay→OK, says 오인식 개선)
    try { speechsdk.PhraseListGrammar.fromRecognizer(recognizer).addPhrase(currentWord); } catch (e) { /* */ }
    // 발음 판정 모드에서만 발음평가 적용 (단어 판정에 적용하면 result.text가 기준 단어로 강제되는 버그)
    if (judgeModeNow === 'pron') {
      const pronConfig = new speechsdk.PronunciationAssessmentConfig(
        currentWord,
        speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        speechsdk.PronunciationAssessmentGranularity.Phoneme,
        false
      );
      pronConfig.applyTo(recognizer);
    }
    wordRecognizerRef.current = recognizer;

    // 마이크 세션 시작 + 0.6초(초기 잡음 구간) 뒤 "지금 말하세요" 표시
    recognizer.sessionStarted = () => { setTimeout(() => setRecordReady(true), 600); };

    const cleanup = () => {
      setIsListening(false);
      setRecordReady(false);
      try { recognizer.close(); } catch (e) { /* */ }
      wordRecognizerRef.current = null;
      if (wordMediaRecorderRef.current && wordMediaRecorderRef.current.state !== 'inactive') {
        try { wordMediaRecorderRef.current.stop(); } catch (e) { /* */ }
      }
      if (wordSafetyTimerRef.current) { clearTimeout(wordSafetyTimerRef.current); wordSafetyTimerRef.current = null; }
    };

    // ─── 연속 인식: 묵음으로 끊지 않음 — [다 말했어요]를 눌러야 채점 ───
    wordHeardRef.current = '';
    wordScoresRef.current = [];
    wordFinishRef.current = () => { // 버튼에서 호출 (종료 + 채점)
      wordFinishRef.current = null;
      const rec = wordRecognizerRef.current;
      wordRecognizerRef.current = null;

      const evaluate = () => {
        // 같은 말 반복 인식 정리
        const tokens = (wordHeardRef.current || '').trim().split(/\s+/).filter(Boolean);
        const dedupTokens = [];
        for (const t of tokens) {
          const prev = dedupTokens[dedupTokens.length - 1];
          if (!prev || prev.toLowerCase() !== t.toLowerCase()) dedupTokens.push(t);
        }
        const recognizedText = dedupTokens.join(' ');

        if (!recognizedText.trim()) {
          setSpeechFeedback('목소리를 인식하지 못했어요. 다시 시도해보세요.');
          setWordAssessResult(null);
          cleanup();
          return;
        }
        let ok;
        if (judgeModeNow === 'pron') {
          const arr = wordScoresRef.current;
          const score = arr.length ? Math.round(Math.max(...arr)) : 0; // 끊어 말해도 최고점 기준
          const threshold = parseInt(localStorage.getItem('woojin-pass-threshold')) || 60;
          ok = score >= threshold;
          setWordAssessResult({ mode: 'pron', passed: ok, score, recognizedText });
        } else {
          ok = isSpeechMatch(recognizedText, currentWord); // 쪼개진 인식(퍼~스트)도 병합 판정
          setWordAssessResult({ mode: 'word', passed: ok, recognizedText });
        }
        if (ok) {
          setSpeechFeedback('정답!');
          markWordLearned(selectedDayIndex, currentWordIndex);
        } else {
          setSpeechFeedback('다시 도전해보세요!');
        }
        cleanup();
      };

      if (rec) {
        try {
          rec.stopContinuousRecognitionAsync(
            () => { try { rec.close(); } catch (e) { /* */ } evaluate(); },
            () => { try { rec.close(); } catch (e) { /* */ } evaluate(); }
          );
        } catch (e) { try { rec.close(); } catch (e2) { /* */ } evaluate(); }
      } else evaluate();
    };

    recognizer.recognized = (s, e) => {
      if (!e || !e.result || e.result.reason !== speechsdk.ResultReason.RecognizedSpeech) return;
      const t = (e.result.text || '').trim();
      if (t) wordHeardRef.current = (wordHeardRef.current + ' ' + t).trim();
      if (judgeModeNow === 'pron') {
        try {
          const pr = speechsdk.PronunciationAssessmentResult.fromResult(e.result);
          if (pr && typeof pr.accuracyScore === 'number') wordScoresRef.current.push(pr.accuracyScore);
        } catch (e2) { /* */ }
      }
    };

    recognizer.startContinuousRecognitionAsync(
      () => { /* 시작됨 — 종료는 [다 말했어요] 버튼 */ },
      (error) => {
        console.error('음성 인식 에러:', error);
        setSpeechFeedback('마이크 또는 설정 오류가 발생했어요.');
        cleanup();
      }
    );

    // 안전장치: 2분 방치 시 자동 채점·정리
    if (wordSafetyTimerRef.current) clearTimeout(wordSafetyTimerRef.current);
    wordSafetyTimerRef.current = setTimeout(() => { if (wordFinishRef.current) wordFinishRef.current(); }, 120000);
  };

  // ─── 단어학습 녹음 재생 ───
  const playWordRecording = () => {
    if (!wordRecordedAudioUrl) return;
    if (wordRecordedAudioRef.current) { wordRecordedAudioRef.current.pause(); }
    const audio = new Audio(wordRecordedAudioUrl);
    wordRecordedAudioRef.current = audio;
    setIsPlayingWordRecording(true);
    audio.onended = () => setIsPlayingWordRecording(false);
    audio.onerror = () => setIsPlayingWordRecording(false);
    // 녹음 시작부 마이크 잡음(스~/치~) 건너뛰기
    audio.onloadedmetadata = () => {
      try { if (isFinite(audio.duration) && audio.duration > 1.0) audio.currentTime = 0.6; } catch (e) { /* */ }
    };
    audio.play();
  };

  const stopWordRecording = () => {
    if (wordRecordedAudioRef.current) {
      wordRecordedAudioRef.current.pause();
      wordRecordedAudioRef.current.currentTime = 0;
      setIsPlayingWordRecording(false);
    }
  };

  // 발음 점수 이모지/색상 헬퍼
  const getWordScoreEmoji = (score) => {
    if (score >= 90) return '🌟';
    if (score >= 80) return '😊';
    if (score >= 60) return '🙂';
    if (score >= 40) return '😐';
    return '😢';
  };
  const getWordScoreClass = (score) => {
    if (score >= 80) return 'score-good';
    if (score >= 50) return 'score-ok';
    return 'score-bad';
  };

  // ─── 학습 중지 ───
  const stopLearning = () => {
    abortRef.current = true;
    pauseRef.current = false;
    if (resumeResolveRef.current) { resumeResolveRef.current(); resumeResolveRef.current = null; }
    window.speechSynthesis.cancel();
    const audio = audioRef.current;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentStep('');
    setIsWaitingForSpeech(false);
    setIsListening(false);
    setSpeechFeedback('');
    // 발음 평가 관련 cleanup
    wordAssessActiveRef.current = false;
    if (wordRecognizerRef.current) { try { wordRecognizerRef.current.close(); } catch (e) { /* */ } wordRecognizerRef.current = null; }
    if (wordMediaRecorderRef.current && wordMediaRecorderRef.current.state !== 'inactive') { try { wordMediaRecorderRef.current.stop(); } catch (e) { /* */ } }
    wordMediaRecorderRef.current = null;
    if (wordStreamRef.current) { try { wordStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } wordStreamRef.current = null; }
    stopWordRecording();
    if (wordRecordedAudioUrl) { URL.revokeObjectURL(wordRecordedAudioUrl); }
    setWordRecordedAudioUrl(null);
    setWordAssessResult(null);
  };

  // ─── 일시정지 / 재개 ───
  const pauseLearning = () => {
    pauseRef.current = true;
    setIsPaused(true);
    window.speechSynthesis.pause();
    audioRef.current.pause();
  };

  const resumeLearning = () => {
    pauseRef.current = false;
    setIsPaused(false);
    window.speechSynthesis.resume();
    audioRef.current.play().catch(() => { });
    if (resumeResolveRef.current) { resumeResolveRef.current(); resumeResolveRef.current = null; }
  };

  // ─── 목소리 로딩 ───
  useEffect(() => {
    const load = () => window.speechSynthesis.getVoices();
    load();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  // Day 선택 핸들러
  const handleDaySelect = (idx) => {
    if (isPlaying) return;
    setSelectedDayIndex(idx);
    setCurrentWordIndex(0);
    setDisplayWord('');
    setImageUrl('');
    setCurrentStep('');
    setIsWaitingForSpeech(false);
    setIsListening(false);
    setSpeechFeedback('');
  };

  // ─── PWA 앱 설치 ───
  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsAppInstalled(true);
    }
    setDeferredPrompt(null);
  };

  // ─── 설정 관련 함수 ───
  // ─── 계정 삭제 ───
  const handleDeleteAccount = async () => {
    if (!deletePassword || deletePassword.length < 4) {
      setDeleteError('비밀번호를 입력해주세요 (4자 이상)');
      return;
    }
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount(deletePassword);
      // 삭제 성공 → localStorage 정리
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SENTENCE_STORAGE_KEY);
      localStorage.removeItem('woojin-memorize-data');
      // Auth 리스너가 자동으로 로그아웃 상태로 전환
    } catch (err) {
      console.error('계정 삭제 실패:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setDeleteError('비밀번호가 틀려요');
      } else {
        setDeleteError('삭제 실패: ' + err.message);
      }
      setIsDeleting(false);
    }
  };

  // ─── Azure Speech 키 인증 & 저장 (개별 버튼) ───
  const verifyAzure = async () => {
    localStorage.setItem('woojin-azure-key', azureKey);
    localStorage.setItem('woojin-azure-region', azureRegion);
    localStorage.setItem('woojin-azure-voice', azureVoice);
    saveAppConfig({ azureKey, azureRegion, azureVoice }).catch(() => {});
    if (!azureKey || !azureRegion) {
      setAzureVerified(false);
      localStorage.setItem('woojin-azure-verified', 'false');
      saveAppConfig({ azureVerified: false }).catch(() => {});
      alert('Azure Key/Region이 비어 있어요. (브라우저 기본 음성 사용)');
      return;
    }
    setAzureVerifying(true);
    try {
      const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      sc.speechSynthesisVoiceName = azureVoice;
      const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
      await new Promise((resolve, reject) => {
        synthesizer.speakTextAsync('test',
          (result) => { synthesizer.close(); result.reason === speechsdk.ResultReason.SynthesizingAudioCompleted ? resolve() : reject(new Error(result.errorDetails || 'TTS 실패')); },
          (error) => { synthesizer.close(); reject(error); }
        );
      });
      setAzureVerified(true);
      localStorage.setItem('woojin-azure-verified', 'true');
      saveAppConfig({ azureVerified: true }).catch(() => {});
      alert('✅ Azure 키 인증 성공! 고품질 음성이 활성화됩니다.');
    } catch (err) {
      console.error('Azure 키 검증 실패:', err);
      setAzureVerified(false);
      localStorage.setItem('woojin-azure-verified', 'false');
      saveAppConfig({ azureVerified: false }).catch(() => {});
      alert('❌ Azure 키 인증 실패! Key 또는 Region을 다시 확인해주세요.');
    } finally {
      setAzureVerifying(false);
    }
  };

  // ─── OCR(Vision) 저장 (개별 버튼) ───
  const saveVision = () => {
    localStorage.setItem('woojin-azure-vision-key', azureVisionKey);
    localStorage.setItem('woojin-azure-vision-endpoint', azureVisionEndpoint);
    saveAppConfig({ azureVisionKey, azureVisionEndpoint }).catch(() => {});
    alert('OCR(Vision) 설정이 저장되었습니다.');
  };

  // ─── Pixabay 키 저장 + 테스트 검색 (개별 버튼) ───
  const savePixabay = async () => {
    const k = pixabayKeyInput.trim();
    pixabayApiKey = k;
    saveAppConfig({ pixabayKey: k }).catch(() => {});
    if (!k) { setPixabayStatus('empty'); return; }
    setPixabayStatus('checking');
    try {
      const url = await pixabaySearch('apple');
      setPixabayStatus(url ? 'ok' : 'fail');
    } catch { setPixabayStatus('fail'); }
  };

  // ─── Azure Translator 저장 + 테스트 ───
  const saveTranslate = async () => {
    const k = translateKeyInput.trim();
    const r = translateRegionInput.trim() || 'koreacentral';
    const g = geminiKeyInput.trim();
    azureTranslatorKey = k;
    azureTranslatorRegion = r;
    geminiKey = g;
    saveAppConfig({ translatorKey: k, translatorRegion: r, geminiKey: g }).catch(() => {});
    setTranslateStatus('checking');
    meaningCache.clear();
    try {
      // AI 호출은 1회만 (무료 한도: 하루 20회)
      const b = await translateToKo('Rabbit picks flowers.', { ai: true });
      const eng2 = getLastTranslateEngine();
      const a = await translateToKo('pick'); // 단어는 Azure 경로 확인용
      const eng1 = getLastTranslateEngine();
      const ok = !!(a || b);
      setTranslateStatus(ok ? 'ok' : 'fail');
      const gErr = getLastGeminiError();
      setTranslateInfo((ok
        ? `단어: pick → ${a || '(실패)'} [${eng1 || '-'}] / 문장: Rabbit picks flowers. → ${b || '(실패)'} [${eng2 || '-'}]`
        : '번역 실패 — 키와 지역을 확인해 주세요.')
        + (geminiKeyInput.trim() && gErr ? `\n⚠️ Gemini 실패: ${gErr}` : ''));
    } catch { setTranslateStatus('fail'); setTranslateInfo('번역 중 오류가 발생했어요.'); }
  };

  // ─── GitHub 토큰 저장 + 유효성 확인 (개별 버튼) ───
  const saveGithubToken = async () => {
    const t = githubTokenInput.trim();
    localStorage.setItem('woojin-github-token', t);
    saveAppConfig({ githubToken: t }).catch(() => {});
    if (!t) { setGithubStatus('empty'); return; }
    setGithubStatus('checking');
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`, {
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' }
      });
      if (res.ok) {
        const d = await res.json();
        setGithubStatus(d.permissions && d.permissions.push ? 'ok' : 'readonly');
      } else {
        setGithubStatus('fail');
      }
    } catch { setGithubStatus('fail'); }
  };

  // ─── YouTube Data API 키 저장 + 유효성 확인 (개별 버튼) ───
  const saveYoutube = async () => {
    const k = youtubeKeyInput.trim();
    saveAppConfig({ youtubeKey: k }).catch(() => {});
    if (!k) { setYoutubeStatus('empty'); return; }
    setYoutubeStatus('checking');
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=abc&key=${encodeURIComponent(k)}`);
      setYoutubeStatus(res.ok ? 'ok' : 'fail');
    } catch { setYoutubeStatus('fail'); }
  };

  // ─── 맨 아래: 변경사항 전체 저장 후 닫기 (인증은 안 함) ───
  const saveSettings = () => {
    localStorage.setItem('woojin-azure-key', azureKey);
    localStorage.setItem('woojin-azure-region', azureRegion);
    localStorage.setItem('woojin-azure-voice', azureVoice);
    localStorage.setItem('woojin-azure-vision-key', azureVisionKey);
    localStorage.setItem('woojin-azure-vision-endpoint', azureVisionEndpoint);
    localStorage.setItem('woojin-github-token', githubTokenInput.trim());
    pixabayApiKey = pixabayKeyInput.trim();
    saveAppConfig({
      azureKey, azureRegion, azureVoice, azureVisionKey, azureVisionEndpoint,
      githubToken: githubTokenInput.trim(), pixabayKey: pixabayKeyInput.trim(),
      youtubeKey: youtubeKeyInput.trim()
    }).catch(() => {});
    setShowSettings(false);
  };

  // 키 상태 표시
  const keyStatusText = (s) => {
    if (s === 'checking') return <span style={{ color: '#888' }}>확인 중...</span>;
    if (s === 'ok') return <span style={{ color: '#2e9e5b', fontWeight: 700 }}>✅ 정상 작동</span>;
    if (s === 'readonly') return <span style={{ color: '#e67e22', fontWeight: 700 }}>⚠️ 읽기만 가능 (쓰기 권한 필요)</span>;
    if (s === 'fail') return <span style={{ color: '#d14848', fontWeight: 700 }}>❌ 키를 확인해주세요</span>;
    if (s === 'empty') return <span style={{ color: '#888' }}>입력 안 됨</span>;
    return null;
  };

  // ─── 관리자 기능 ───
  const addDay = () => {
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    setData(prev => {
      const arr = prev[currentKey] || [];
      return { ...prev, [currentKey]: [...arr, { id: Date.now(), name: `Lesson ${arr.length + 1}`, date: today, words: [] }] };
    });
  };

  const removeDay = (idx) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      const updated = arr.filter((_, i) => i !== idx);
      return { ...prev, [currentKey]: updated };
    });
    if (selectedDayIndex === idx) {
      setSelectedDayIndex(-1);
    } else if (selectedDayIndex > idx) {
      setSelectedDayIndex(prev => prev - 1);
    }
  };

  const updateDayDate = (dayIdx, dateStr) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, date: dateStr || '' } : d
        )
      };
    });
  };

  const updateDayName = (dayIdx, name) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, name: (name || '').trim() || d.name } : d
        )
      };
    });
  };

  const addWordToDay = (dayIdx, word) => {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, words: [...d.words, w] } : d
        )
      };
    });
  };

  // 단어 뜻 저장/수정 (day.meanings = { word: '뜻' })
  const setWordMeaning = (dayIdx, word, meaning) => {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, meanings: { ...(d.meanings || {}), [w]: meaning } } : d
        )
      };
    });
  };

  // ─── 학습 결과 기록 (day.wordStats = { word: {ok, ng, streak, lastNgAt} }) ───
  // ok=잘한 횟수 / ng=헤맨 횟수 / streak=연속 정답(2회면 약점 졸업)
  // 판정: 첫 시도에 힌트 없이 맞히면 ok, 헤매거나 힌트 쓰거나 넘어가면 ng
  const recordWordResult = useCallback((word, good, reason) => {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    setData(prev => {
      // 모든 달에서 이 단어를 가진 레슨을 찾되, 기록은 한 곳(가장 최근 레슨)에만
      // → 지난달 단어를 복습해도 정상 기록되고, 횟수가 부풀려지지 않음
      let best = null; // { key, idx, date }
      Object.entries(prev || {}).forEach(([key, arr]) => {
        (arr || []).forEach((d, i) => {
          const has = (d.words || []).some(x => (x || '').toLowerCase().trim() === w); // 대소문자 무관
          if (!has) return;
          const date = d.date || '';
          if (!best || date > best.date || (date === best.date && key >= best.key)) best = { key, idx: i, date };
        });
      });
      if (!best) return prev;
      const next = (prev[best.key] || []).map((d, i) => {
        if (i !== best.idx) return d;
        const st = (d.wordStats || {})[w] || { ok: 0, ng: 0, streak: 0, lastNgAt: '', reasons: {} };
        let upd;
        if (good) {
          upd = { ...st, ok: st.ok + 1, streak: st.streak + 1 };
        } else {
          // 어려워한 이유도 함께 누적 (아이콘 눌렀을 때 보여줌)
          const reasons = { ...(st.reasons || {}) };
          if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
          upd = { ...st, ng: st.ng + 1, streak: 0, lastNgAt: new Date().toISOString(), reasons };
        }
        return { ...d, wordStats: { ...(d.wordStats || {}), [w]: upd } };
      });
      return { ...prev, [best.key]: next };
    });
  }, []);

  // 약한 단어인지: 헤맨 적이 있고, 아직 연속 2회 정답으로 졸업하지 못함
  const isWeakWord = useCallback((day, word) => {
    return isWeakStat(((day && day.wordStats) || {})[(word || '').toLowerCase().trim()]);
  }, []);

  // 현재 월 전체에서 약한 단어 모으기 (많이 헤맨 순)
  const collectWeakWords = useCallback(() => {
    const agg = {};
    flattenAllDays(data).forEach(d => { // 지난달 약점도 포함
      const live = new Set((d.words || []).map(x => (x || '').toLowerCase().trim())); // 삭제된 단어 제외
      Object.entries(d.wordStats || {}).forEach(([w, st]) => {
        if (!live.has(w)) return;
        if (!isWeakStat(st)) return;
        const a = agg[w] || { ng: 0, lastNgAt: '' };
        agg[w] = { ng: a.ng + st.ng, lastNgAt: st.lastNgAt > a.lastNgAt ? st.lastNgAt : a.lastNgAt };
      });
    });
    return Object.entries(agg)
      .sort((a, b) => b[1].ng - a[1].ng || (b[1].lastNgAt || '').localeCompare(a[1].lastNgAt || ''))
      .map(([w]) => w);
  }, [data]);

  // 단어 이미지 직접 지정 (day.images = { word: url }) — 자동 선택이 틀렸을 때
  const setWordImage = (dayIdx, word, url) => {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    imageUrlCache.set(w, url || ''); // 세션 캐시도 즉시 갱신
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, images: { ...(d.images || {}), [w]: url } } : d
        )
      };
    });
  };

  // 뜻이 비어 있는 단어들 일괄 채우기 (단어 관리의 "뜻 자동 채우기" 버튼)
  const fillMissingMeanings = async (dayIdx, overwrite = false) => {
    const arr = data[currentKey] || [];
    const d = arr[dayIdx];
    if (!d) return { total: 0, done: 0, byAi: 0, error: "" };
    const cur = d.meanings || {};
    const todo = [...new Set(d.words.map(w => (w || '').toLowerCase().trim()))].filter(w => w && (overwrite || !cur[w]));
    if (!todo.length) return { total: 0, done: 0, byAi: 0, error: "" };
    // 같은 레슨의 다른 단어들을 문맥으로 제공 → nut을 '너트'가 아닌 '견과'로 판단
    const ctx = `같은 단원의 단어들: ${d.words.join(', ')}`;
    let n = 0;
    // Gemini는 한 번에 묶어서 요청 (무료 한도 절약)
    let byAi = 0;
    if (geminiKey) {
      const map = await geminiTranslateBatch(todo, ctx, 'word'); // 단어 = 사전형
      Object.entries(map).forEach(([w, ko]) => { setWordMeaning(dayIdx, w, tidyKo(ko)); n++; byAi++; });
      const rest = todo.filter(w => !map[w]);
      // '전체 다시 번역'인데 AI가 실패했다면, 기존 번역을 일반 번역으로 덮어쓰지 않음 (품질 저하 방지)
      if (overwrite && rest.length) {
        return { total: todo.length, done: n, byAi, error: getLastGeminiError(), skipped: rest.length };
      }
      // 빈 뜻 채우기일 때만 Azure로 보충 (없는 것보다는 나으므로)
      for (const w of rest) {
        const ko = await translateToKo(w, { force: overwrite, context: ctx });
        if (ko) { setWordMeaning(dayIdx, w, ko); n++; }
      }
      return { total: todo.length, done: n, byAi, error: getLastGeminiError() };
    }
    for (const w of todo) {
      const ko = await translateToKo(w, { force: overwrite, context: ctx });
      if (ko) { setWordMeaning(dayIdx, w, ko); n++; }
    }
    return { total: todo.length, done: n, byAi: 0, error: '' };
  };

  const removeWordFromDay = (dayIdx, wordIdx) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) => {
          if (i !== dayIdx) return d;
          const removed = d.words[wordIdx];
          const words = d.words.filter((_, wi) => wi !== wordIdx);
          const meanings = { ...(d.meanings || {}) };
          const wordStats = { ...(d.wordStats || {}) };
          if (removed && !words.includes(removed)) {
            delete meanings[removed];   // 남은 동일 단어 없으면 뜻도 제거
            delete wordStats[removed];  // 학습 기록도 정리 (좀비 약점 방지)
          }
          return { ...d, words, meanings, wordStats };
        })
      };
    });
  };

  // ─── 문장 데이터 관리 함수 ───
  const sentenceCurrentKey = toKey(selectedYear, selectedMonth);
  const sentenceDays = sentenceData[sentenceCurrentKey] || [];

  const addSentenceDay = () => {
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = { ...prev, [sentenceCurrentKey]: [...arr, { id: Date.now(), name: `Lesson ${arr.length + 1}`, date: today, sentences: [] }] };
      saveSentenceData(updated);
      return updated;
    });
  };

  const removeSentenceDay = (idx) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = { ...prev, [sentenceCurrentKey]: arr.filter((_, i) => i !== idx) };
      saveSentenceData(updated);
      return updated;
    });
  };

  const addSongToDay = (dayIdx, song) => {
    if (!song || !song.id) return;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) => {
          if (i !== dayIdx) return d;
          const songs = d.songs || [];
          if (songs.some(s => s.id === song.id)) return d; // 중복 방지
          return { ...d, songs: [...songs, { id: song.id, title: song.title || '' }] };
        })
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const removeSongFromDay = (dayIdx, songId) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, songs: (d.songs || []).filter(s => s.id !== songId) } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  // 문장학습 퀴즈까지 완료 기록 (금메달)
  const markSentenceSetCleared = (dayIdx) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx
            ? { ...d, setClearedAt: new Date().toISOString(), setClearedCount: (d.setClearedCount || 0) + 1 }
            : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  // 단어 수집 게임 클리어 기록
  const markSentenceGameCleared = (dayIdx) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx
            ? { ...d, gameClearedAt: new Date().toISOString(), gameClearedCount: (d.gameClearedCount || 0) + 1 }
            : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const updateSentenceDayName = (dayIdx, name) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, name: (name || '').trim() || d.name } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const addSentenceToDay = (dayIdx, sentence) => {
    const s = (sentence || '').trim();
    if (!s) return;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, sentences: [...(d.sentences || []), s] } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  // ─── 문장 학습 결과 기록 (sentenceDay.sentStats = { 문장: {ok,ng,streak,lastNgAt,reasons} }) ───
  const recordSentenceResult = useCallback((sentence, good, reason) => {
    const t = (sentence || '').trim();
    if (!t) return;
    setSentenceData(prev => {
      // 모든 달에서 이 문장을 가진 레슨을 찾아 가장 최근 것 한 곳에만 기록
      let best = null;
      Object.entries(prev || {}).forEach(([key, arr]) => {
        (arr || []).forEach((d, i) => {
          const has = (d.sentences || []).some(x => ((typeof x === 'string' ? x : (x && x.text)) || '').trim() === t);
          if (!has) return;
          const date = d.date || '';
          if (!best || date > best.date || (date === best.date && key >= best.key)) best = { key, idx: i, date };
        });
      });
      if (!best) return prev;
      const next = (prev[best.key] || []).map((d, i) => {
        if (i !== best.idx) return d;
        const st = (d.sentStats || {})[t] || { ok: 0, ng: 0, streak: 0, lastNgAt: '', reasons: {} };
        let upd;
        if (good) {
          upd = { ...st, ok: st.ok + 1, streak: st.streak + 1 };
        } else {
          const reasons = { ...(st.reasons || {}) };
          if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
          upd = { ...st, ng: st.ng + 1, streak: 0, lastNgAt: new Date().toISOString(), reasons };
        }
        return { ...d, sentStats: { ...(d.sentStats || {}), [t]: upd } };
      });
      const updated = { ...prev, [best.key]: next };
      saveSentenceData(updated);
      return updated;
    });
  }, []);

  // 문장 뜻 저장/수정 (day.meanings = { 문장: '뜻' })
  const setSentenceMeaning = (dayIdx, sentence, meaning) => {
    const s = (sentence || '').trim();
    if (!s) return;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, meanings: { ...(d.meanings || {}), [s]: meaning } } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  // 문장 뜻 일괄 채우기 (overwrite=true면 기존 뜻도 다시 번역)
  const fillMissingSentenceMeanings = async (dayIdx, overwrite = false) => {
    const arr = sentenceData[sentenceCurrentKey] || [];
    const d = arr[dayIdx];
    if (!d) return { total: 0, done: 0, byAi: 0, error: "" };
    const cur = d.meanings || {};
    const todo = [...new Set((d.sentences || []).map(x => (typeof x === 'string' ? x : (x && x.text) || '').trim()))]
      .filter(s => s && (overwrite || !cur[s]));
    if (!todo.length) return { total: 0, done: 0, byAi: 0, error: "" };
    // 같은 레슨의 문장 전체를 이야기 문맥으로 제공
    const ctx = (d.sentences || []).map(x => (typeof x === 'string' ? x : (x && x.text) || '')).join(' ');
    let n = 0;
    // Gemini는 한 번에 묶어서 요청 (11문장이어도 호출 1회)
    let byAi = 0;
    if (geminiKey) {
      const map = await geminiTranslateBatch(todo, ctx, 'sentence');
      Object.entries(map).forEach(([s, ko]) => { setSentenceMeaning(dayIdx, s, tidyKo(ko)); n++; byAi++; });
      const rest = todo.filter(s => !map[s]);
      // '전체 다시 번역'인데 AI가 실패했다면, 기존 번역을 일반 번역으로 덮어쓰지 않음 (품질 저하 방지)
      if (overwrite && rest.length) {
        return { total: todo.length, done: n, byAi, error: getLastGeminiError(), skipped: rest.length };
      }
      // 빈 뜻 채우기일 때만 Azure로 보충 (없는 것보다는 나으므로)
      for (const s of rest) {
        const ko = await translateToKo(s, { force: overwrite, context: ctx });
        if (ko) { setSentenceMeaning(dayIdx, s, ko); n++; }
      }
      return { total: todo.length, done: n, byAi, error: getLastGeminiError() };
    }
    for (const s of todo) {
      const ko = await translateToKo(s, { force: overwrite, context: ctx });
      if (ko) { setSentenceMeaning(dayIdx, s, ko); n++; }
    }
    return { total: todo.length, done: n, byAi: 0, error: '' };
  };

  const removeSentenceFromDay = (dayIdx, sentenceIdx) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, sentences: (d.sentences || []).filter((_, si) => si !== sentenceIdx) } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const editSentenceInDay = (dayIdx, sentenceIdx, newText) => {
    if (!newText.trim()) return;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, sentences: (d.sentences || []).map((s, si) => si === sentenceIdx ? newText.trim() : s) } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const reorderSentenceInDay = (dayIdx, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const day = arr[dayIdx];
      if (!day) return prev;
      const sentences = [...(day.sentences || [])];
      if (fromIdx < 0 || fromIdx >= sentences.length || toIdx < 0 || toIdx >= sentences.length) return prev;
      const [moved] = sentences.splice(fromIdx, 1);
      sentences.splice(toIdx, 0, moved);
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, sentences } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  const updateSentenceDayDate = (dayIdx, dateStr) => {
    setSentenceData(prev => {
      const arr = prev[sentenceCurrentKey] || [];
      const updated = {
        ...prev, [sentenceCurrentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, date: dateStr || '' } : d
        )
      };
      saveSentenceData(updated);
      return updated;
    });
  };

  // ─── 파닉스 음원 업로드 (mp3 여러 개 → base64 → Firestore) ───
  const uploadPhonicsFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPhonicsUploading(true);
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setPhonicsProgress(`${i + 1}/${files.length} — ${f.name}`);
      try {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1]); // data:...;base64,XXX
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        await uploadPhonicsSound(f.name, b64);
        ok++;
      } catch (err) {
        console.warn('음원 업로드 실패:', f.name, err);
        if (fail === 0 && err && err.message) setPhonicsProgress(`실패: ${err.message}`);
        fail++;
      }
    }
    setPhonicsUploading(false);
    setPhonicsProgress('');
    e.target.value = '';
    const list = await listPhonicsSounds();
    setPhonicsCount(list.length);
    alert(`음원 등록 완료\n성공 ${ok}개${fail ? ` / 실패 ${fail}개` : ''}\n전체 등록: ${list.length}개`);
  };

  // 단어 미리보기 칩 재생 — 끝날 때까지 다른 칩도 잠금 (겹침 방지)
  const speakChip = useCallback(async (w) => {
    if (chipBusyRef.current) return;
    chipBusyRef.current = true; setChipSpeaking(w);
    try { await speakWordSimple(w); } catch (e) { /* */ }
    chipBusyRef.current = false; setChipSpeaking('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakWordSimple]);

  // ─── 렌더링 ───
  const selectedDay = selectedDayIndex >= 0 ? days[selectedDayIndex] : null;
  const totalWords = selectedDay ? selectedDay.words.length : 0;

  // 레슨을 고르면 그 레슨 단어 이미지를 백그라운드로 미리 받아둠 (학습 시 즉시 표시)
  const prefetchedKeyRef = useRef('');
  useEffect(() => {
    if (!selectedDay || !selectedDay.words || !selectedDay.words.length) return;
    const key = `${currentKey}-${selectedDayIndex}-${selectedDay.words.length}`;
    if (prefetchedKeyRef.current === key) return; // 같은 레슨 중복 실행 방지
    prefetchedKeyRef.current = key;
    prefetchLessonImages(selectedDay.words);
  }, [selectedDay, selectedDayIndex, currentKey, prefetchLessonImages]);

  // ─── AI 번역 하루 사용량 (기기·계정 공용) ───
  const refreshAiUsed = useCallback(() => {
    loadAiTranslateUsage(ptDayKey()).then(n => setAiUsed(n || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!firebaseReady) return;
    refreshAiUsed();
    // AI 호출이 성공할 때마다 공용 카운터 증가 + 화면 갱신
    setAiUsageHook(() => {
      addAiTranslateUsage(ptDayKey()).then(refreshAiUsed).catch(() => {});
      setAiUsed(n => n + 1); // 즉시 반영 (서버 반영은 뒤따름)
    });
    return () => setAiUsageHook(null);
  }, [firebaseReady, refreshAiUsed]);

  const aiQuotaText = `한도: ${Math.min(aiUsed, AI_DAILY_LIMIT)}/${AI_DAILY_LIMIT} · 다음날 초기화됩니다.`;

  // 로그인 후 첫 화면에서 패치 노트 한 번 표시 (다시 보지 않기 누르면 안 뜸)
  useEffect(() => {
    if (!currentUser || !firebaseReady) return;
    const t = setTimeout(() => setPatchNote(getUnseenNote()), 800); // 로딩 끝난 뒤
    return () => clearTimeout(t);
  }, [currentUser, firebaseReady]);

  // 설정을 열면 파닉스 음원 등록 현황 조회
  useEffect(() => {
    if (!showSettings) return;
    listPhonicsSounds().then(l => setPhonicsCount(l.length)).catch(() => {});
  }, [showSettings]);

  // ─── 뒤로가기: 모달 → 학습 화면 → 홈 순으로 한 단계씩 (홈에서만 앱 종료) ───
  useBackHandler(() => {
    // 1) 열려 있는 팝업부터 닫기
    if (patchNote) { setPatchNote(null); return true; }
    if (showSettings) { setShowSettings(false); return true; }
    if (showWordShoot) { setShowWordShoot(false); return true; }
    if (showFindWord) { setShowFindWord(false); return true; }
    if (showWordAdmin) { setShowWordAdmin(false); return true; }
    if (showSentenceAdmin) { setShowSentenceAdmin(false); return true; }
    // 2) 학습 중이면 레슨 선택(홈)으로
    if (screen === 'learning' && learnView !== 'home') { setLearnView('home'); return true; }
    // 3) 다른 화면이면 학습 화면으로
    if (screen !== 'learning') { setScreen('learning'); return true; }
    return false; // 홈 — 앱 종료 허용
  });

  // 로딩 중 (Auth 상태 확인 중)
  if (currentUser === undefined) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-emoji"><LogoIcon size={80} /></div>
          <p style={{ fontFamily: 'var(--font-kr)', color: '#888' }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  // 로그인 안 됨
  if (!currentUser) {
    return <LoginScreen />;
  }

  return (
    <div className="app-container">
      {/* 서버 연결 실패 안내 — 이때 저장하면 반영되지 않을 수 있음 */}
      {offlineMode && (
        <div className="app-banner warn">
          📡 서버에 연결하지 못했어요. 기기에 저장된 내용으로 보고 있어요 — 새로 등록한 건 저장되지 않을 수 있어요.
          <button className="app-banner-btn" onClick={() => window.location.reload()}>다시 시도</button>
        </div>
      )}
      {/* 음성 재생 실패 안내 */}
      {voiceError && (
        <div className="app-banner err">
          🔇 {voiceError}
          <button className="app-banner-btn" onClick={clearNotice}>닫기</button>
        </div>
      )}

      {/* 패치 노트 — 새 버전에서 한 번만 */}
      {patchNote && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPatchNote(null); }}>
          <div className="patch-modal">
            <div className="patch-head">
              <span className="patch-badge">새로워진 점</span>
              <h2 className="patch-title">{patchNote.title}</h2>
              <div className="patch-ver">{patchNote.version}</div>
            </div>
            <ul className="patch-list">
              {patchNote.items.map((it, i) => (
                <li key={i}><span className="patch-icon">{it.icon}</span><span>{it.text}</span></li>
              ))}
            </ul>
            <div className="patch-actions">
              <button className="patch-btn ghost"
                onClick={() => { markNoteSeen(patchNote.version); setPatchNote(null); }}>
                다시 보지 않기
              </button>
              <button className="patch-btn primary" onClick={() => setPatchNote(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Header ===== */}
      <header className="app-header">
        <div className="app-title">
          <span className="emoji" style={{ display: 'inline-flex', verticalAlign: 'middle' }}><LogoIcon size={32} /></span>
          {(displayName || currentUser?.username) ? `${nameWithParticle(displayName || currentUser.username)} 펀펀영어` : '펀펀영어'}
        </div>
        <div className="header-btns">
          <div className="user-info">
            <span className="user-name">{displayName || currentUser.username}</span>
            <button className="logout-btn" onClick={logoutUser}>로그아웃</button>
          </div>
          {['learning', 'phonics', 'sentence', 'memorize', 'reading', 'shoot'].includes(screen) ? (
            <>
              <button className={`header-btn phonics ${screen === 'phonics' ? 'current' : ''}`} onClick={() => setScreen('phonics')}>
                🔤 파닉스
              </button>
              <button className={`header-btn home ${screen === 'learning' ? 'current' : ''}`} onClick={() => setScreen('learning')}>
                🍎 단어학습
              </button>
              <button className={`header-btn sentence ${screen === 'sentence' ? 'current' : ''}`} onClick={() => setScreen('sentence')}>
                📝 문장 학습
              </button>
              <button className={`header-btn memorize ${screen === 'memorize' ? 'current' : ''}`} onClick={() => setScreen('memorize')}>
                📖 문장 암기
              </button>
              <button className={`header-btn reading ${screen === 'reading' ? 'current' : ''}`} onClick={() => setScreen('reading')}>
                📚 책 읽기
              </button>
            </>
          ) : (
            <button className="header-btn home" onClick={() => setScreen('learning')}>
              🏠 학습으로
            </button>
          )}
          {/* 🥷 단어 베기 헤더 버튼 — 숨김 (게임은 단어학습 하단에서 랜덤 실행)
          <button className="header-btn slice" onClick={() => setScreen('slice')}>
            🥷 단어 베기
          </button> */}
          <button className="header-btn settings" onClick={() => { setShowSettings(true); getCacheStats().then(s => setCacheCount(s.count)); }}>
            ⚙️ 설정
          </button>
        </div>
      </header>

      {/* ===== Learning Screen ===== */}
      {screen === 'learning' && (
        <main className="learning-main">
          {/* Left panel: image + word */}
          <section className={`learning-left ${learnView !== 'home' ? 'learn-scroll' : ''}`}>
            {learnView === 'course' ? (
              <WordSetCourse
                progressId={selectedDay ? `${currentKey}-${selectedDay.id || selectedDayIndex}` : ''}
                words={selectedDay ? selectedDay.words : []}
                azureKey={azureKey}
                azureRegion={azureRegion}
                speak={speakWordSimple}
                playListen={playWordSequence}
                stop={stopWordPlay}
                getImage={getImageUrl}
                onClose={() => setLearnView('home')}
                /* 메달은 게임까지 클리어해야 (게임 모달의 onClear에서 markSetCleared) */
                onWordResult={recordWordResult}
                onStartGame={() => { wordGameFromCourseRef.current = true; setWordGameType(Math.random() < 0.5 ? 'shoot' : 'slice'); setShowWordShoot(true); }} /* 세트학습 마지막 게임 → 메달 대상 */
              />
            ) : learnView === 'list' ? (
              <WordList
                words={selectedDay ? selectedDay.words : []}
                meanings={selectedDay ? (selectedDay.meanings || {}) : {}}
                wordStats={selectedDay ? (selectedDay.wordStats || {}) : {}}
                allWords={flattenAllDays(data).flatMap(d => d.words || [])} /* 같은 소리 친구 찾기 */
                getImage={getImageUrl}
                azureKey={azureKey}
                azureRegion={azureRegion}
                speak={speakWordSimple}
                playListen={playWordSequence}
                stop={stopWordPlay}
                onClose={() => setLearnView('home')}
                onOpenGame={() => { wordGameFromCourseRef.current = false; setWordGameType(Math.random() < 0.5 ? 'shoot' : 'slice'); setShowWordShoot(true); }} /* 재미용 — 메달 없음 */
                onFixWeak={(ws) => { setFixWords(ws); setLearnView('fixweak'); }} /* ⚠️ 단어만 다시 학습 */
              />
            ) : learnView === 'review' ? (
              <WordSetCourse
                progressId={selectedDay ? `${currentKey}-${selectedDay.id || selectedDayIndex}-review` : ''}
                words={selectedDay ? selectedDay.words : []}
                azureKey={azureKey}
                azureRegion={azureRegion}
                speak={speakWordSimple}
                playListen={playWordSequence}
                stop={stopWordPlay}
                getImage={getImageUrl}
                onClose={() => setLearnView('home')}
                onWordResult={recordWordResult}
                stages={['quiz', 'speak']}
                title="🔁 오늘 복습"
                subtitle={`이 레슨 ${selectedDay ? selectedDay.words.length : 0}개 단어를 퀴즈·말하기로 한 번 더!`}
              />
            ) : learnView === 'fixweak' ? (
              /* ⚠️ 어려워한 단어만 모아서 다시 (퀴즈·말하기만, 진도 저장 없음) */
              <WordSetCourse
                words={fixWords}
                azureKey={azureKey}
                azureRegion={azureRegion}
                speak={speakWordSimple}
                playListen={playWordSequence}
                stop={stopWordPlay}
                getImage={getImageUrl}
                onClose={() => setLearnView('list')}
                onWordResult={recordWordResult}
                stages={['quiz', 'speak']}
                title="⚠️ 어려워한 단어 다시!"
                subtitle={`${fixWords.length}개 단어를 퀴즈·말하기로 다시 해요. 잘하면 ⚠️가 사라져요!`}
              />
            ) : learnView === 'reviewquiz' ? (
              <ReviewQuiz
                words={buildSpacedReviewWords(flattenAllDays(data))}
                weakWords={collectWeakWords()} /* 자주 틀린 단어 우선 출제 */
                speak={speakWordSimple}
                getImage={getImageUrl}
                onWordResult={recordWordResult}
                onClose={() => setLearnView('home')}
              />
            ) : (
            <>
            <div className="image-area">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={displayWord}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    setImageUrl('');
                  }}
                />
              ) : (
                <div className="image-placeholder">
                  {imageLoading ? (
                    <>
                      <span className="placeholder-emoji loading-spin">🔍</span>
                      이미지를 찾고 있어요...
                    </>
                  ) : (
                    <>
                      <span className="placeholder-emoji">📖</span>
                      {displayWord ? '이미지를 찾지 못했어요 😢' : '단어를 선택하고 학습을 시작해봐!'}
                    </>
                  )}
                </div>
              )}
            </div>

            {displayWord && (
              <div className="word-display">
                <span className="first-letter wiggle">{displayWord[0]}</span>
                <span className="rest-letters">{displayWord.substring(1)}</span>
              </div>
            )}

            {/* 발음 평가 UI - 단어 바로 아래에 표시 */}
            {isWaitingForSpeech && (
              <div className="wl-speech-panel">
                {/* 말하기 / 듣고 있어요 버튼 */}
                <div className="wl-btn-row">
                  {isListening ? (
                    <button className={`mic-btn ${recordReady ? 'listening ready' : 'preparing'}`} disabled={!recordReady} onClick={() => {
                      // 묵음으로 끊기지 않음 — 다 말하고 눌러야 채점
                      if (wordFinishRef.current) wordFinishRef.current();
                    }}>
                      <span className="btn-emoji">{recordReady ? '✅' : '⏳'}</span>
                      {recordReady ? '다 말했어요' : '준비 중...'}
                    </button>
                  ) : (
                    <button className="mic-btn" onClick={startSpeechRecognition}>
                      <span className="btn-emoji">🎤</span>
                      말하기
                    </button>
                  )}

                  {/* 녹음 재생 버튼 - 말하기 버튼 옆에 */}
                  {wordRecordedAudioUrl && !isListening && (
                    isPlayingWordRecording ? (
                      <button className="wl-playback-btn playing" onClick={stopWordRecording}>
                        ⏹️ 중지
                      </button>
                    ) : (
                      <button className="wl-playback-btn" onClick={playWordRecording}>
                        🔊 내 발음
                      </button>
                    )
                  )}

                  <button className="next-word-btn" onClick={goToNextWord}>
                    다음 <span className="btn-emoji">⏭️</span>
                  </button>
                </div>

                {/* 피드백 (맞는 단어를 말했는지) */}
                {speechFeedback && (
                  <div className={`speech-feedback ${speechFeedback === '정답!' ? 'correct' : 'incorrect'}`}>
                    {speechFeedback === '정답!' ? '🌟 정답!' : speechFeedback}
                  </div>
                )}

                {wordAssessResult && (
                  <div className="wl-assess-result">
                    {wordAssessResult.mode === 'pron' && (
                      <div className="wl-assess-score-row">
                        <span className={`wl-assess-total ${getWordScoreClass(wordAssessResult.score)}`}>{wordAssessResult.score}점</span>
                      </div>
                    )}
                    {wordAssessResult.recognizedText && (
                      <div className="wl-assess-recognized">
                        인식된 단어: <strong>{wordAssessResult.recognizedText}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            </>
            )}
          </section>

          {/* Right panel: controls */}
          <aside className="learning-right">
            {/* Year / Month / Day Selector */}
            <div className="day-selector">
              <div className="section-title">📅 년/월 선택</div>
              {/* Year selector */}
              <div className="ym-row">
                <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)} disabled={isPlaying}>◀</button>
                <span className="ym-label">{selectedYear}년</span>
                <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)} disabled={isPlaying}>▶</button>
              </div>
              {/* Month selector */}
              <div className="month-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                  <button
                    key={m}
                    className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
                    onClick={() => handleMonthChange(m)}
                    disabled={isPlaying}
                  >
                    {m}월
                  </button>
                ))}
              </div>
              {/* Day buttons */}
              <div className="section-title" style={{ marginTop: 8 }}>📚 Lesson 선택</div>
              <div className="day-buttons">
                {sortLessons(days, lessonSortKey, lessonSortOrder).map(({ d: day, i }) => (
                  <button
                    key={day.id || i}
                    className={`day-btn ${selectedDayIndex === i ? 'active' : ''}`}
                    onClick={() => handleDaySelect(i)}
                    disabled={isPlaying}
                  >
                    {day.setClearedAt && <span className="day-medal" title="세트학습 완주!">🏅</span>}
                    {day.name}{day.date ? ` (${day.date})` : ''}
                    {day.words.length > 0 && <span className="day-progress">{day.words.length}단어</span>}
                  </button>
                ))}
              </div>
              {days.length === 0 && (
                <div style={{ color: 'var(--color-text-light)', marginTop: 8, fontFamily: 'var(--font-kr)', fontSize: '0.9rem' }}>
                  이 달에는 아직 Lesson이 없어요!
                </div>
              )}
            </div>

            {selectedDay ? (
              <>
                {/* Word Info — 단어 미리보기 (칩) */}
                <div className="word-info-card">
                  {/* 기본은 접힌 상태 — 제목을 누르면 펼침 */}
                  <button className="word-preview-toggle" onClick={() => setPreviewOpen(v => !v)}>
                    <span className="current-word-label">📝 단어 미리보기 ({selectedDay.words.length}개)</span>
                    <span className={`word-preview-caret ${previewOpen ? 'open' : ''}`}>▾</span>
                  </button>
                  {previewOpen && (
                    selectedDay.words.length === 0 ? (
                      <div className="word-preview-empty">등록된 단어가 없어요</div>
                    ) : (
                      <div className="word-preview-chips">
                        {selectedDay.words.map((w, i) => (
                          <button
                            key={i}
                            className={`word-preview-chip ${chipSpeaking === w ? 'speaking' : ''}`}
                            onClick={() => speakChip(w)}
                            disabled={!!chipSpeaking} /* 재생이 끝날 때까지 연타 무시 */
                            title="눌러서 들어보기"
                          >
                            {w}{isWeakWord(selectedDay, w) ? ' ⚠️' : ''}
                          </button>
                        ))}
                      </div>
                    )
                  )}
                </div>

                {/* Step Indicator */}
                {isPlaying && (
                  <div className="step-indicator">
                    <div className="step-label">🔊 학습 단계</div>
                    <div className="steps">
                      <div className={`step ${currentStep === 'alphabet' ? 'active' : currentStep === 'phonics' || currentStep === 'word' ? 'done' : ''}`}>
                        알파벳
                      </div>
                      <div className={`step ${currentStep === 'phonics' ? 'active' : currentStep === 'word' ? 'done' : ''}`}>
                        파닉스
                      </div>
                      <div className={`step ${currentStep === 'word' ? 'active' : ''}`}>
                        단어
                      </div>
                    </div>
                  </div>
                )}

                {/* 학습 진입 버튼 */}
                <div className="start-btn-container">
                  <div className="learn-entry-btns grid2">
                    <button
                      className="start-btn ready"
                      style={{ background: '#27ae60', boxShadow: '0 3px 0 #1e8c4d' }}
                      onClick={() => setLearnView('list')}
                      disabled={selectedDay.words.length === 0}
                    >
                      <span className="btn-emoji">📖</span>
                      단어 학습
                    </button>
                    <button
                      className="start-btn ready"
                      style={{ background: '#5b8def', boxShadow: '0 3px 0 #3f6fd0' }}
                      onClick={() => setLearnView('course')}
                      disabled={selectedDay.words.length === 0}
                    >
                      <span className="btn-emoji">🎒</span>
                      세트 학습
                    </button>
                    <button
                      className="start-btn ready"
                      style={{ background: '#e67e22', boxShadow: '0 3px 0 #b5621a' }}
                      onClick={() => setLearnView('review')}
                      disabled={selectedDay.words.length === 0}
                    >
                      <span className="btn-emoji">🔁</span>
                      오늘 복습
                    </button>
                    <button
                      className="start-btn ready"
                      style={{ background: '#9b59b6', boxShadow: '0 3px 0 #7d3f97' }}
                      onClick={() => setLearnView('reviewquiz')}
                      disabled={days.flatMap(d => d.words || []).length === 0}
                    >
                      <span className="btn-emoji">📝</span>
                      복습 퀴즈
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="no-day-message">
                <span className="msg-emoji">👆</span>
                <span className="msg-text">위에서 Lesson을 선택해 주세요!</span>
              </div>
            )}
            <button className="sl-admin-btn find-word-btn" onClick={() => setShowFindWord(true)}>
              🔍 단어 찾기
            </button>
            <button className="sl-admin-btn" onClick={() => setShowWordAdmin(true)}>
              📋 단어 관리
            </button>
          </aside>
        </main>
      )
      }

      {/* ===== 단어 게임 (단어학습 하단 — 새총/베기 랜덤, 선택된 Lesson 단어) ===== */}
      {showWordShoot && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowWordShoot(false); }}>
          <div className="srg-modal">
            {wordGameType === 'shoot' ? (
              <SlingshotGame
                sentences={selectedDay ? selectedDay.words : []}
                speak={speakWordSimple}
                onClear={() => { if (wordGameFromCourseRef.current) markSetCleared(selectedDayIndex); }} /* 메달은 세트학습 경유만 */
                onClose={() => setShowWordShoot(false)}
              />
            ) : (
              <SliceGame
                words={selectedDay ? selectedDay.words : []}
                allWords={days.flatMap(d => d.words || [])}
                speak={speakWordSimple}
                onClear={() => { if (wordGameFromCourseRef.current) markSetCleared(selectedDayIndex); }} /* 메달은 세트학습 경유만 */
                onClose={() => setShowWordShoot(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* ===== Word Admin Popup ===== */}
      {showWordAdmin && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowWordAdmin(false); }}>
          <div className="sentence-admin-popup">
            <div className="sentence-admin-popup-header">
              <h2 className="modal-title">📋 단어 관리</h2>
              <button className="sentence-admin-close" onClick={() => setShowWordAdmin(false)}>✕</button>
            </div>
            <div className="sentence-admin-popup-body">
              <AdminPage
                days={days}
                addDay={addDay}
                removeDay={removeDay}
                addWordToDay={addWordToDay}
                removeWordFromDay={removeWordFromDay}
                setWordMeaning={setWordMeaning}
                setWordImage={setWordImage}
                fillMissingMeanings={fillMissingMeanings}
                aiQuotaText={aiQuotaText}
                lessonSortKey={lessonSortKey}
                lessonSortOrder={lessonSortOrder}
                updateDayDate={updateDayDate}
                updateDayName={updateDayName}
                selectedYear={selectedYear}
                selectedMonth={selectedMonth}
                handleYearChange={handleYearChange}
                handleMonthChange={handleMonthChange}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>
      )}

      {/* ===== Sentence Learning Screen ===== */}
      {screen === 'sentence' && (
        <SentenceLearning
          sentenceData={sentenceData}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          handleYearChange={handleYearChange}
          handleMonthChange={handleMonthChange}
          azureKey={azureKey}
          azureRegion={azureRegion}
          azureVerified={azureVerified}
          azureVoice={azureVoice}
          onGoAdmin={() => setShowSentenceAdmin(true)}
          ttsLimitReached={userUsage.speechChars >= TTS_LIMIT}
          youtubeKey={youtubeKeyInput}
          addSongToDay={addSongToDay}
          removeSongFromDay={removeSongFromDay}
          onQuizCleared={markSentenceSetCleared}
          onSentenceResult={recordSentenceResult}
          onGameCleared={markSentenceGameCleared}
          lessonSortKey={lessonSortKey}
          lessonSortOrder={lessonSortOrder}
        />
      )}

      {/* ===== Sentence Memorize Screen ===== */}
      {screen === 'memorize' && (
        <SentenceMemorize
          memorizeData={memorizeData}
          setMemorizeData={setMemorizeData}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          handleYearChange={handleYearChange}
          handleMonthChange={handleMonthChange}
          azureKey={azureKey}
          azureRegion={azureRegion}
          azureVerified={azureVerified}
          azureVoice={azureVoice}
          ttsLimitReached={userUsage.speechChars >= TTS_LIMIT}
          lessonSortKey={lessonSortKey}
          lessonSortOrder={lessonSortOrder}
        />
      )}

      {/* ===== Book Reading Screen ===== */}
      {screen === 'reading' && (
        <BookReading
          azureKey={azureKey}
          azureRegion={azureRegion}
          azureVerified={azureVerified}
          azureVoice={azureVoice}
          currentUser={currentUser}
          ttsLimitReached={userUsage.speechChars >= TTS_LIMIT}
        />
      )}

      {/* ===== 파닉스 학습 화면 ===== */}
      {screen === 'phonics' && (
        <main className="learning-main" style={{ display: 'block' }}>
          <PhonicsCourse
            allWords={flattenAllDays(data).flatMap(d => d.words || [])}
            speak={speakWordSimple}
            stop={stopWordPlay}
            onClose={() => setScreen('learning')}
          />
        </main>
      )}

      {/* ===== Slice Word Game Screen (단어 베기) ===== */}
      {screen === 'slice' && (
        <main className="learning-main" style={{ display: 'block' }}>
          <SliceGame
            words={selectedDay && selectedDay.words.length ? selectedDay.words : buildSpacedReviewWords(flattenAllDays(data))}
            allWords={days.flatMap(d => d.words || [])}
            speak={speakWordSimple}
            onClose={() => setScreen('learning')}
          />
        </main>
      )}

      {/* ===== Slingshot Word Game Screen ===== */}
      {screen === 'shoot' && (
        <main className="learning-main" style={{ display: 'block' }}>
          <SlingshotGame
            sentences={buildSpacedSentences(flattenAllDays(sentenceData))}
            recentWords={buildSpacedReviewWords(flattenAllDays(data))}
            speak={speakWordSimple}
            onClose={() => setScreen('sentence')}
          />
        </main>
      )}

      {/* ===== Sentence Admin Popup ===== */}
      {showSentenceAdmin && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowSentenceAdmin(false); }}>
          <div className="sentence-admin-popup">
            <div className="sentence-admin-popup-header">
              <h2 className="modal-title">📋 문장 관리</h2>
              <button className="sentence-admin-close" onClick={() => setShowSentenceAdmin(false)}>✕</button>
            </div>
            <div className="sentence-admin-popup-body">
              <SentenceAdminPage
                days={sentenceDays}
                addDay={addSentenceDay}
                removeDay={removeSentenceDay}
                addSentenceToDay={addSentenceToDay}
                removeSentenceFromDay={removeSentenceFromDay}
                editSentenceInDay={editSentenceInDay}
                reorderSentenceInDay={reorderSentenceInDay}
                setSentenceMeaning={setSentenceMeaning}
                fillMissingSentenceMeanings={fillMissingSentenceMeanings}
                aiQuotaText={aiQuotaText}
                lessonSortKey={lessonSortKey}
                lessonSortOrder={lessonSortOrder}
                updateDayDate={updateSentenceDayDate}
                updateDayName={updateSentenceDayName}
                selectedYear={selectedYear}
                selectedMonth={selectedMonth}
                handleYearChange={handleYearChange}
                handleMonthChange={handleMonthChange}
              />
            </div>
          </div>
        </div>
      )}

      {/* ===== Find Screen ===== */}
      {showFindWord && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowFindWord(false); }}>
          <div className="find-modal">
            <button className="sentence-admin-close find-modal-close" onClick={() => setShowFindWord(false)}>✕</button>
            <FindWordPage
              data={data}
              azureKey={azureKey}
              azureRegion={azureRegion}
              azureVerified={azureVerified}
              azureVoice={azureVoice}
              ttsLimitReached={userUsage.speechChars >= TTS_LIMIT}
              currentUser={currentUser}
            />
          </div>
        </div>
      )}

      {/* ===== Settings Modal ===== */}
      {showSettings && (
        /* 배경 클릭으로도 닫히게 (다른 모달과 동일) */
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div className="settings-modal">
            <h2 className="modal-title">⚙️ 설정</h2>

            <div className="settings-group">
              <button className="settings-btn save" style={{ width: '100%', background: '#5b8def' }} onClick={forceUpdate}>
                🔄 최신 버전으로 업데이트
              </button>
              <div className="usage-note" style={{ marginTop: 4 }}>
                현재 버전: {BUILD_TIME} · 배포 후 앱에 반영이 안 되면 눌러주세요.
              </div>
            </div>
            <div className="settings-divider"></div>

            <div className="settings-group">
              <label>🎤 읽기(말하기) 판정 방식</label>
              <div className="score-mode-row">
                <button
                  className={`score-mode-btn ${judgeMode === 'word' ? 'active' : ''}`}
                  onClick={() => { setJudgeMode('word'); localStorage.setItem('woojin-judge-mode', 'word'); }}
                >
                  단어 판정
                  <span className="score-mode-desc">맞는 단어를 말하면 통과 (아이 추천)</span>
                </button>
                <button
                  className={`score-mode-btn ${judgeMode === 'pron' ? 'active' : ''}`}
                  onClick={() => { setJudgeMode('pron'); localStorage.setItem('woojin-judge-mode', 'pron'); }}
                >
                  발음 판정
                  <span className="score-mode-desc">발음 점수로 통과 (난이도 선택)</span>
                </button>
              </div>
              {judgeMode === 'pron' && (
                <div className="wl-difficulty-row" style={{ marginTop: 10, justifyContent: 'center' }}>
                  <span className="wl-diff-label">🎯 난이도</span>
                  {[{ l: '쉬움', v: 40 }, { l: '보통', v: 60 }, { l: '어려움', v: 75 }].map(d => (
                    <button
                      key={d.v}
                      className={`wl-diff-btn ${passThreshold === d.v ? 'active' : ''}`}
                      onClick={() => { setPassThreshold(d.v); localStorage.setItem('woojin-pass-threshold', String(d.v)); }}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-divider"></div>

            <div className="settings-group">
              <label>📚 Lesson 정렬 (단어·문장 학습)</label>
              <div className="score-mode-row">
                <button
                  className={`score-mode-btn ${lessonSortKey === 'name' ? 'active' : ''}`}
                  onClick={() => { setLessonSortKey('name'); localStorage.setItem('woojin-lesson-sort-key', 'name'); }}
                >
                  이름순
                  <span className="score-mode-desc">Lesson 번호 기준</span>
                </button>
                <button
                  className={`score-mode-btn ${lessonSortKey === 'date' ? 'active' : ''}`}
                  onClick={() => { setLessonSortKey('date'); localStorage.setItem('woojin-lesson-sort-key', 'date'); }}
                >
                  날짜순
                  <span className="score-mode-desc">Lesson 날짜 기준</span>
                </button>
              </div>
              <div className="wl-difficulty-row" style={{ marginTop: 10, justifyContent: 'center' }}>
                <span className="wl-diff-label">순서</span>
                {[{ l: '오름차순 ↑', v: 'asc' }, { l: '내림차순 ↓', v: 'desc' }].map(o => (
                  <button
                    key={o.v}
                    className={`wl-diff-btn ${lessonSortOrder === o.v ? 'active' : ''}`}
                    onClick={() => { setLessonSortOrder(o.v); localStorage.setItem('woojin-lesson-sort-order', o.v); }}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-divider"></div>

            <div className="settings-group">
              <label>Azure Speech Service Key</label>
              <input
                type="password"
                value={azureKey}
                onChange={(e) => setAzureKey(e.target.value)}
                placeholder="Azure API Key 입력..."
                className="settings-input"
              />
            </div>

            <div className="settings-group">
              <label>Azure Region</label>
              <input
                type="text"
                value={azureRegion}
                onChange={(e) => setAzureRegion(e.target.value)}
                placeholder="예: koreacentral"
                className="settings-input"
              />
            </div>

            <div className="settings-group">
              <label>TTS 음성 선택</label>
              <select
                value={azureVoice}
                onChange={(e) => setAzureVoice(e.target.value)}
                className="settings-input"
              >
                <option value="en-US-JennyNeural">Jenny - 성인 여성 (자연스러운)</option>
                <option value="en-US-AriaNeural">Aria - 성인 여성 (따뜻한)</option>
                <option value="en-US-SaraNeural">Sara - 성인 여성 (밝은)</option>
                <option value="en-US-AnaNeural">Ana - 어린이 여성</option>
                <option value="en-US-GuyNeural">Guy - 성인 남성 (차분한)</option>
                <option value="en-US-DavisNeural">Davis - 성인 남성 (친근한)</option>
              </select>
            </div>

            <button className="settings-btn save" style={{ width: '100%' }} onClick={verifyAzure} disabled={azureVerifying}>
              {azureVerifying ? '인증 중...' : '🔑 Azure 음성 인증 & 저장'}
            </button>

            <div className="settings-divider"></div>

            <div className="settings-group">
              <label>📷 OCR - Computer Vision Key</label>
              <input
                type="password"
                value={azureVisionKey}
                onChange={(e) => setAzureVisionKey(e.target.value)}
                placeholder="Computer Vision API Key 입력..."
                className="settings-input"
              />
            </div>

            <div className="settings-group">
              <label>📷 OCR - Endpoint</label>
              <input
                type="text"
                value={azureVisionEndpoint}
                onChange={(e) => setAzureVisionEndpoint(e.target.value)}
                placeholder="예: https://koreacentral.api.cognitive.microsoft.com"
                className="settings-input"
              />
            </div>

            <button className="settings-btn save" style={{ width: '100%' }} onClick={saveVision}>📷 OCR(Vision) 저장</button>

            <div className="settings-group">
              <label>🖼️ Pixabay 이미지 API Key</label>
              <input
                type="password"
                value={pixabayKeyInput}
                onChange={(e) => setPixabayKeyInput(e.target.value)}
                placeholder="Pixabay API Key 입력..."
                className="settings-input"
              />
              <button className="settings-btn save" style={{ marginTop: 8 }} onClick={savePixabay}>Pixabay 키 저장 & 확인</button>
              <div className="usage-note" style={{ marginTop: 4 }}>
                상태: {keyStatusText(pixabayStatus) || (pixabayKeyInput ? '저장됨 (확인 전)' : '입력 안 됨')}
              </div>
              <div className="usage-note" style={{ marginTop: 2 }}>Firestore에 저장돼 모든 기기 공통 사용 (소스/Git에 노출 안 됨).</div>
            </div>

            <div className="settings-group">
              <label>🐙 GitHub 토큰 (책 등록용)</label>
              <input
                type="password"
                value={githubTokenInput}
                onChange={(e) => setGithubTokenInput(e.target.value)}
                placeholder="ghp_... (repo 쓰기 권한 PAT)"
                className="settings-input"
              />
              <button className="settings-btn save" style={{ marginTop: 8 }} onClick={saveGithubToken}>GitHub 토큰 저장 & 확인</button>
              <div className="usage-note" style={{ marginTop: 4 }}>
                상태: {keyStatusText(githubStatus) || (githubTokenInput ? '저장됨 (확인 전)' : '입력 안 됨')}
              </div>
              <div className="usage-note" style={{ marginTop: 2 }}>책 등록 시 이미지 업로드에 사용. Firestore 공용 저장.</div>
            </div>

            <div className="settings-group">
              <label>🎵 YouTube Data API Key (노래 검색용)</label>
              <input
                type="password"
                value={youtubeKeyInput}
                onChange={(e) => setYoutubeKeyInput(e.target.value)}
                placeholder="YouTube Data API v3 Key 입력..."
                className="settings-input"
              />
              <button className="settings-btn save" style={{ marginTop: 8 }} onClick={saveYoutube}>YouTube 키 저장 & 확인</button>
              <div className="usage-note" style={{ marginTop: 4 }}>
                상태: {keyStatusText(youtubeStatus) || (youtubeKeyInput ? '저장됨 (확인 전)' : '입력 안 됨')}
              </div>
              <div className="usage-note" style={{ marginTop: 2 }}>레슨 노래 검색에 사용. Google Cloud Console에서 발급. Firestore 공용 저장.</div>
            </div>

            <div className="settings-group">
              <label>🤖 Gemini API Key (AI 번역 — 권장)</label>
              <input
                type="password"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder="aistudio.google.com/apikey 에서 발급 (무료)"
                className="settings-input"
              />
              <div className="usage-note" style={{ marginTop: 2, marginBottom: 4 }}>
                아이 눈높이로 말투를 통일해 번역해요. 비우면 아래 Azure 번역을 사용합니다.
              </div>
              <div className="usage-note" style={{ marginBottom: 12, fontWeight: 700, color: aiUsed >= AI_DAILY_LIMIT ? '#b93b3b' : '#2b6a45' }}>
                {aiQuotaText}
              </div>

              <label>🇰🇷 Azure Translator Key (보조)</label>
              <input
                type="password"
                value={translateKeyInput}
                onChange={(e) => setTranslateKeyInput(e.target.value)}
                placeholder="Azure Translator 키 (비우면 무료 번역 사용)"
                className="settings-input"
              />
              <input
                type="text"
                value={translateRegionInput}
                onChange={(e) => setTranslateRegionInput(e.target.value)}
                placeholder="지역 (예: koreacentral)"
                className="settings-input"
                style={{ marginTop: 6 }}
              />
              <button className="settings-btn save" style={{ marginTop: 8 }} onClick={saveTranslate}>번역 저장 & 테스트</button>
              <div className="usage-note" style={{ marginTop: 4 }}>
                상태: {keyStatusText(translateStatus) || (translateKeyInput ? '저장됨 (확인 전)' : '무료 번역 사용 중')}
              </div>
              {translateInfo && (
                <div className="usage-note" style={{ marginTop: 4, color: '#2b6a45', fontWeight: 700, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                  {translateInfo}
                </div>
              )}
              <div className="usage-note" style={{ marginTop: 2 }}>Azure Portal → Translator 리소스(F0 무료) 생성 후 키/지역 입력. 사전 조회로 여러 뜻을 함께 가져옵니다.</div>
            </div>

            {/* 서비스 상태 + 사용량 */}
            <div className="settings-divider"></div>
            <div className="settings-group">
              <label>서비스 상태</label>
              <div className="usage-status-grid">
                <div className={`usage-card ${azureVerified ? 'active' : 'inactive'}`}>
                  <div className="usage-card-header">
                    <span className="usage-card-title">Speech (TTS)</span>
                    <span className={`usage-badge ${azureVerified ? 'on' : 'off'}`}>{azureVerified ? '활성' : '미연결'}</span>
                  </div>
                  <div className="usage-card-body">
                    <div className="usage-bar-wrap">
                      <div className="usage-bar-bg">
                        <div className="usage-bar-fill" style={{
                          width: `${Math.min(100, (userUsage.speechChars / 100000) * 100)}%`,
                          background: userUsage.speechChars >= 100000 ? '#e74c3c' : undefined
                        }}></div>
                      </div>
                      <span className="usage-text">{userUsage.speechChars.toLocaleString()} / 100,000자</span>
                    </div>
                  </div>
                </div>
                <div className={`usage-card ${azureVisionKey ? 'active' : 'inactive'}`}>
                  <div className="usage-card-header">
                    <span className="usage-card-title">Vision (OCR)</span>
                    <span className={`usage-badge ${azureVisionKey ? 'on' : 'off'}`}>{azureVisionKey ? '활성' : '미연결'}</span>
                  </div>
                  <div className="usage-card-body">
                    <div className="usage-bar-wrap">
                      <div className="usage-bar-bg">
                        <div className="usage-bar-fill vision" style={{ width: `${Math.min(100, (usageData.visionCalls / 5000) * 100)}%` }}></div>
                      </div>
                      <span className="usage-text">{usageData.visionCalls.toLocaleString()} / 5,000건</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="usage-note">매월 1일 자동 초기화 (Firestore 기반 — 계정별 10만자 제한)</div>
              <div className="usage-note" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span>TTS 캐시: {cacheCount}개 저장됨 (캐시 히트 시 Azure 호출 없음)</span>
                {cacheCount > 0 && (
                  <button style={{ fontSize: '0.75rem', padding: '2px 8px', cursor: 'pointer' }} onClick={() => { clearCache().then(() => setCacheCount(0)); }}>
                    캐시 초기화
                  </button>
                )}
              </div>
              <div className="usage-note" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <button style={{ fontSize: '0.8rem', padding: '4px 12px', cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: '#f8f8f8' }}
                  onClick={() => { resetAudioModule().then(() => alert('음원 모듈이 초기화되었습니다.')); }}>
                  음원 모듈 초기화
                </button>
                <span style={{ fontSize: '0.75rem', color: '#999' }}>음성이 재생되지 않을 때 클릭하세요</span>
              </div>
            </div>

            {/* 진단 로그 (앱 종료 원인 확인용) */}
            <div className="settings-divider"></div>
            <div className="settings-group">
              <label>🐞 진단 로그 (앱이 꺼질 때 원인 확인)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <button className="settings-btn save" onClick={() => setLogsText(getLogsText() || '(로그 없음)')}>로그 보기</button>
                <button className="settings-btn save" style={{ background: '#5b8def' }}
                  onClick={() => { const t = getLogsText(); if (t) { navigator.clipboard?.writeText(t).then(() => alert('로그를 복사했어요.')).catch(() => {}); } }}>
                  복사
                </button>
                <button className="settings-btn cancel" onClick={() => { clearLogs(); setLogsText(''); }}>지우기</button>
              </div>
              {logsText && (
                <textarea readOnly value={logsText} className="settings-input"
                  style={{ height: 160, fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre', overflow: 'auto' }} />
              )}
              <div className="usage-note" style={{ marginTop: 2 }}>error/reject는 오류, mem은 메모리 사용량이에요. 꺼진 직후 열어서 복사해 보내주시면 원인 파악에 도움돼요.</div>
            </div>

            {/* 파닉스 음원 등록 (한 번만 하면 됨) */}
            <div className="settings-divider"></div>
            <div className="settings-group">
              <label>🔤 파닉스 음원 등록</label>
              <div className="usage-note" style={{ marginBottom: 8 }}>
                <b>phonics-cut</b> 폴더의 mp3를 모두 선택해 올려 주세요. 한 번만 하면 됩니다.
                {phonicsCount > 0 && <> · 현재 <b>{phonicsCount}개</b> 등록됨</>}
              </div>
              <input
                type="file" accept="audio/mpeg,.mp3" multiple
                onChange={uploadPhonicsFiles}
                disabled={phonicsUploading}
                className="settings-input"
                style={{ padding: 8 }}
              />
              {phonicsUploading && (
                <div className="usage-note" style={{ marginTop: 6, fontWeight: 700, color: '#1f5fd6' }}>
                  올리는 중... {phonicsProgress}
                </div>
              )}
              <button className="settings-btn save" style={{ marginTop: 8 }}
                onClick={async () => { const n = await listPhonicsSounds(); setPhonicsCount(n.length); alert(`등록된 음원: ${n.length}개`); }}>
                등록 현황 확인
              </button>
            </div>

            {/* 패치 노트 다시 보기 */}
            <div className="settings-group">
              <label>📢 새로워진 점</label>
              <button className="settings-btn save"
                onClick={() => { resetNotesSeen(); setShowSettings(false); setPatchNote(getUnseenNote()); }}>
                패치 노트 다시 보기
              </button>
            </div>

            {/* 번역 진단 로그 (개발자용) */}
            <div className="settings-group">
              <label>🔤 번역 로그 (개발자용)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <button className="settings-btn save" onClick={() => {
                  const rows = getTranslateLog();
                  setTransLogText(rows.length
                    ? rows.map(r => `[${r.at}] ${r.kind} ${r.ok}/${r.count} model=${r.model || '-'}${r.error ? ' ERR=' + r.error : ''}`).join('\n')
                    : '(번역 로그 없음)');
                }}>로그 보기</button>
                <button className="settings-btn save" style={{ background: '#5b8def' }}
                  onClick={() => { if (transLogText) navigator.clipboard?.writeText(transLogText).then(() => alert('번역 로그를 복사했어요.')).catch(() => {}); }}>
                  복사
                </button>
                <button className="settings-btn save" style={{ background: '#8b6fdb' }}
                  onClick={async () => {
                    setTransLogText('사용 가능한 모델을 조회하는 중...');
                    const list = await discoverGeminiModels();
                    setTransLogText(list.length
                      ? `이 키로 사용 가능한 모델 (우선순위 순):\n` + list.map((m, i) => `${i + 1}. ${m}`).join('\n')
                      : '모델 목록을 가져오지 못했어요. 키를 확인해 주세요.');
                  }}>
                  사용 가능 모델 확인
                </button>
              </div>
              {transLogText && (
                <textarea readOnly value={transLogText} className="settings-input"
                  style={{ height: 140, fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre', overflow: 'auto' }} />
              )}
              <div className="usage-note" style={{ marginTop: 2 }}>AI 번역 호출 결과와 실패 사유(429=한도 등)가 최근 30건까지 남아요.</div>
            </div>

            <div className="modal-actions">
              <button className="settings-btn cancel" onClick={() => setShowSettings(false)}>취소</button>
              <button className="settings-btn save" onClick={saveSettings} disabled={azureVerifying}>
                변경사항 저장
              </button>
            </div>

            {/* 계정 삭제 */}
            <div className="settings-divider"></div>
            <div className="settings-group delete-account-section">
              {!showDeleteConfirm ? (
                <button className="delete-account-toggle" onClick={() => { setShowDeleteConfirm(true); setDeletePassword(''); setDeleteError(''); }}>
                  계정 삭제하기
                </button>
              ) : (
                <div className="delete-account-box">
                  <p className="delete-warning">계정과 모든 학습 데이터가 영구 삭제됩니다. 이 작업은 되돌릴 수 없어요.</p>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    className="settings-input delete-input"
                  />
                  {deleteError && <div className="delete-error">{deleteError}</div>}
                  <div className="delete-actions">
                    <button className="settings-btn cancel" onClick={() => setShowDeleteConfirm(false)}>취소</button>
                    <button className="settings-btn delete" onClick={handleDeleteAccount} disabled={isDeleting}>
                      {isDeleting ? '삭제 중...' : '계정 삭제'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 홈 화면에 추가 (PWA 설치) */}
            <div className="settings-divider"></div>
            <div className="settings-group install-app-section">
              {isAppInstalled ? (
                <div className="install-app-done">
                  <span className="install-app-icon">✅</span>
                  <span>이미 설치되었습니다</span>
                </div>
              ) : deferredPrompt ? (
                <button className="install-app-btn" onClick={handleInstallApp}>
                  <span className="install-app-icon">📲</span>
                  홈 화면에 추가하기
                </button>
              ) : (
                <div className="install-app-guide">
                  <span className="install-app-icon">📲</span>
                  <div>
                    <div className="install-app-label">홈 화면에 추가하기</div>
                    <div className="install-app-desc">
                      크롬 메뉴(⋮) → "홈 화면에 추가" 또는<br/>주소창 오른쪽 설치 아이콘(⊕)을 눌러주세요
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Footer - Build Info ===== */}
      <div className="build-footer">
        {BUILD_TIME}
      </div>
    </div >
  );
}

// ======================================================
// 관리자 페이지 컴포넌트
// ======================================================
function AdminPage({ days, addDay, removeDay, addWordToDay, removeWordFromDay, setWordMeaning, setWordImage, fillMissingMeanings, aiQuotaText, updateDayDate, updateDayName, selectedYear, selectedMonth, handleYearChange, handleMonthChange, lessonSortKey = 'name', lessonSortOrder = 'asc' }) {
  return (
    <div className="admin-container">
      {/* Year / Month selector */}
      <div className="day-selector" style={{ marginBottom: 8 }}>
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
              {m}월
            </button>
          ))}
        </div>
      </div>

      <div className="admin-top-bar">
        <button className="add-day-btn" onClick={addDay}>
          ➕ Lesson 추가 ({selectedYear}년 {selectedMonth}월)
        </button>
      </div>

      {days.length === 0 && (
        <div className="no-day-message">
          <span className="msg-emoji">📝</span>
          <span className="msg-text">{selectedYear}년 {selectedMonth}월에 Lesson이 없어요. 위 버튼으로 추가해 주세요!</span>
        </div>
      )}

      {/* 설정의 정렬 기준을 그대로 사용 (학습 화면과 동일한 순서) */}
      {sortLessons(days, lessonSortKey, lessonSortOrder).map(({ d: day, i: dayIdx }) => {
        return (
          <DayCard
            key={day.id || dayIdx}
            day={day}
            dayIdx={dayIdx}
            removeDay={removeDay}
            addWordToDay={addWordToDay}
            removeWordFromDay={removeWordFromDay}
            setWordMeaning={setWordMeaning}
            setWordImage={setWordImage}
            fillMissingMeanings={fillMissingMeanings}
            aiQuotaText={aiQuotaText}
            updateDayDate={updateDayDate}
            updateDayName={updateDayName}
          />
        );
      })}
    </div>
  );
}

// ======================================================
// Day 카드 컴포넌트
// ======================================================
function DayCard({ day, dayIdx, removeDay, addWordToDay, removeWordFromDay, setWordMeaning, setWordImage, fillMissingMeanings, aiQuotaText, updateDayDate, updateDayName }) {
  const [newWord, setNewWord] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [deleteWordConfirm, setDeleteWordConfirm] = useState(-1);
  const [deleteLessonConfirm, setDeleteLessonConfirm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(day.name);
  const [fillingKo, setFillingKo] = useState(false); // 뜻 자동 채우기 진행 중
  const [koPicker, setKoPicker] = useState(null);    // { word, draft, candidates, loading }
  const [imgPicker, setImgPicker] = useState(null);  // { word, sel, candidates, loading }
  const inputRef = useRef(null);
  const dateRef = useRef(null);

  const saveName = () => { if (updateDayName) updateDayName(dayIdx, nameDraft); setEditingName(false); };

  // 뜻 고르기 팝업 열기 (사전 후보를 비동기로 채움)
  const openMeaningPicker = (word, current) => {
    setKoPicker({ word, draft: current || '', candidates: [], loading: true });
    azureDictionaryCandidates(word)
      .then(list => setKoPicker(p => (p && p.word === word ? { ...p, candidates: list, loading: false } : p)))
      .catch(() => setKoPicker(p => (p && p.word === word ? { ...p, loading: false } : p)));
  };

  // 이미지 고르기 팝업 열기 (자동 선택이 틀렸을 때 직접 고름)
  const openImagePicker = (word, current) => {
    setImgPicker({ word, sel: current || '', candidates: [], loading: true });
    arasaacCandidates(word)
      .then(list => setImgPicker(p => (p && p.word === word ? { ...p, candidates: list, loading: false } : p)))
      .catch(() => setImgPicker(p => (p && p.word === word ? { ...p, loading: false } : p)));
  };

  // ─── OCR 관련 ───
  const fileInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const ocrMenuRef = useRef(null);
  const [showOcrMenu, setShowOcrMenu] = useState(false);
  const [ocr, setOcr] = useState({ loading: false, results: null, previewUrls: [], engine: '', multiProgress: null });

  // OCR 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!showOcrMenu) return;
    const handleOutside = (e) => {
      if (ocrMenuRef.current && !ocrMenuRef.current.contains(e.target)) setShowOcrMenu(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showOcrMenu]);

  const handleAdd = () => {
    if (newWord.trim()) {
      addWordToDay(dayIdx, newWord);
      setNewWord('');
      setCollapsed(false);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  const openDatePicker = (e) => {
    e.stopPropagation();
    dateRef.current?.showPicker?.();
    dateRef.current?.focus();
  };

  // ─── OCR: 사진에서 단어 추출 ───
  const handleCameraClick = () => setShowOcrMenu(prev => !prev);
  const handleCameraSelect = () => { setShowOcrMenu(false); fileInputRef.current?.click(); };
  const handleAlbumSelect = () => { setShowOcrMenu(false); albumInputRef.current?.click(); };

  // 이미지 리사이즈 + 압축 (Azure 업로드용)
  const compressImageForUpload = (file) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 1600;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  });

  // Azure Computer Vision OCR (REST)
  const ocrWithAzureVision = async (file) => {
    const key = localStorage.getItem('woojin-azure-vision-key');
    const endpoint = localStorage.getItem('woojin-azure-vision-endpoint');
    if (!key || !endpoint) return null;
    addVisionUsageFirestore();
    const compressed = await compressImageForUpload(file);
    const arrayBuffer = await compressed.arrayBuffer();
    const baseUrl = endpoint.replace(/\/+$/, '');
    const analyzeRes = await fetch(`${baseUrl}/vision/v3.2/read/analyze?language=en`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/octet-stream' },
      body: arrayBuffer,
    });
    if (!analyzeRes.ok) {
      const errText = await analyzeRes.text().catch(() => '');
      throw new Error(`Azure Vision ${analyzeRes.status}: ${errText.slice(0, 100)}`);
    }
    const operationUrl = analyzeRes.headers.get('Operation-Location');
    if (!operationUrl) throw new Error('Operation-Location 헤더 없음');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(operationUrl, { headers: { 'Ocp-Apim-Subscription-Key': key } });
      const pollData = await pollRes.json();
      if (pollData.status === 'succeeded') {
        const lines = [];
        for (const page of (pollData.analyzeResult?.readResults || []))
          for (const line of (page.lines || [])) lines.push(line.text);
        return lines;
      }
      if (pollData.status === 'failed') throw new Error('Azure Vision 분석 실패');
    }
    throw new Error('Azure Vision 타임아웃');
  };

  // Tesseract 폴백용 전처리
  const preprocessImage = (file) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const MAX_W = 2000;
      let w = img.width, h = img.height;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
      if (w < 600) { h *= 2; w *= 2; }
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        const bw = gray < 140 ? 0 : 255;
        d[i] = d[i+1] = d[i+2] = bw;
      }
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.src = URL.createObjectURL(file);
  });

  // 인식 텍스트 → 단어/구 목록 (중복 제거)
  // 한 줄에 1~3단어면 한 항목으로 유지 (try on, look forward to 같은 구동사/숙어 보존)
  const cleanOcrWords = (lines, seen) => {
    const out = [];
    lines.forEach(l => {
      const cleaned = (l || '').replace(/^\d+[.)]\s*/, '');
      const tokens = (cleaned.match(/[a-zA-Z][a-zA-Z'-]*/g) || [])
        .map(t => t.toLowerCase().replace(/^[-']+|[-']+$/g, ''))
        .filter(Boolean);
      if (tokens.length === 0) return;
      if (tokens.length <= 3) {
        const phrase = tokens.join(' ');
        if (phrase.length >= 2 && !seen.has(phrase)) { seen.add(phrase); out.push(phrase); }
      } else {
        // 4단어 이상 긴 줄은 문장으로 보고 단어별 분리
        tokens.forEach(w => {
          if (w.length >= 2 && !seen.has(w)) { seen.add(w); out.push(w); }
        });
      }
    });
    return out;
  };

  // 단일 파일 OCR
  const ocrSingleFile = async (file, seen) => {
    let words = [];
    let usedEngine = '';
    try {
      try {
        const azureLines = await ocrWithAzureVision(file);
        if (azureLines && azureLines.length > 0) {
          words = cleanOcrWords(azureLines, seen);
          if (words.length > 0) usedEngine = 'azure';
        }
      } catch (visionErr) {
        console.warn('Azure Vision 에러:', visionErr.message);
      }
      if (words.length === 0) {
        usedEngine = 'tesseract';
        const processedBlob = await preprocessImage(file);
        const worker = await createWorker('eng', 1, {});
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        const { data } = await worker.recognize(processedBlob);
        await worker.terminate();
        words = cleanOcrWords(data.text.split('\n'), seen);
      }
    } catch (err) {
      console.error('OCR 실패:', err);
    }
    return { words, usedEngine };
  };

  const handleFileChange = async (e) => {
    let files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';
    if (files.length > 5) { alert('최대 5장까지 선택할 수 있어요.'); files = files.slice(0, 5); }

    const previewUrls = files.map(f => URL.createObjectURL(f));
    setOcr({ loading: true, results: null, previewUrls, engine: '', multiProgress: files.length > 1 ? { current: 0, total: files.length } : null });

    const seen = new Set();
    let allWords = [];
    let lastEngine = '';
    for (let i = 0; i < files.length; i++) {
      if (files.length > 1) setOcr(prev => ({ ...prev, multiProgress: { current: i + 1, total: files.length } }));
      const { words, usedEngine } = await ocrSingleFile(files[i], seen);
      allWords = allWords.concat(words);
      if (usedEngine) lastEngine = usedEngine;
    }

    setOcr({
      loading: false,
      results: allWords.map(text => ({ text, checked: true })),
      previewUrls,
      engine: lastEngine,
      multiProgress: files.length > 1 ? { current: files.length, total: files.length } : null,
    });
  };

  const handleOcrAddAll = () => {
    if (!ocr.results) return;
    ocr.results.filter(r => r.checked && r.text.trim()).forEach(r => addWordToDay(dayIdx, r.text.trim()));
    (ocr.previewUrls || []).forEach(u => URL.revokeObjectURL(u));
    setOcr({ loading: false, results: null, previewUrls: [], engine: '', multiProgress: null });
    setCollapsed(false);
  };

  const handleOcrCancel = () => {
    (ocr.previewUrls || []).forEach(u => URL.revokeObjectURL(u));
    setOcr({ loading: false, results: null, previewUrls: [], engine: '', multiProgress: null });
  };

  const toggleOcrItem = (idx) => setOcr(prev => ({ ...prev, results: prev.results.map((r, i) => i === idx ? { ...r, checked: !r.checked } : r) }));
  const updateOcrText = (idx, text) => setOcr(prev => ({ ...prev, results: prev.results.map((r, i) => i === idx ? { ...r, text } : r) }));

  return (
    <div className="day-card">
      <div className="day-card-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
        <div className="day-card-title">
          <span className="day-card-toggle">{collapsed ? '▶' : '▼'}</span>
          {editingName ? (
            <input
              className="day-name-input"
              value={nameDraft}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveName(); else if (e.key === 'Escape') { setNameDraft(day.name); setEditingName(false); } }}
              onBlur={saveName}
            />
          ) : (
            <>
              <span className="day-name-plain">📅 {day.name}</span>
              <button className="day-name-edit-btn" onClick={(e) => { e.stopPropagation(); setNameDraft(day.name); setEditingName(true); }} title="이름 수정">✏️</button>
            </>
          )}
          {day.date ? (
            <span className="day-card-date" onClick={openDatePicker} title="클릭하여 날짜 수정">
              ({day.date}) <span className="day-date-edit-icon">✏️</span>
            </span>
          ) : (
            <span className="day-card-date day-card-date-empty" onClick={openDatePicker} title="날짜 추가">
              <span className="day-date-edit-icon">📅+</span>
            </span>
          )}
          {day.words.length > 0 && (
            <span className="day-card-progress">
              {(day.learnedWords || []).length}/{day.words.length}
              {(day.learnedWords || []).length >= day.words.length ? ' ✅' : ''}
            </span>
          )}
        </div>
        <input
          ref={dateRef}
          type="date"
          className="day-date-input-hidden"
          value={day.date || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); updateDayDate(dayIdx, e.target.value); }}
        />
        <button className="delete-day-btn" onClick={(e) => { e.stopPropagation(); setDeleteLessonConfirm(true); }}>
          🗑️ 삭제
        </button>
      </div>

      {!collapsed && <>
      <div className="word-tags">
        {day.words.length === 0 && (
          <div className="empty-words">아직 단어가 없어요. 아래에서 추가해 주세요!</div>
        )}
        {day.words.map((word, wordIdx) => {
          const isLearned = (day.learnedWords || []).includes(wordIdx);
          const ko = (day.meanings || {})[word] || '';
          return (
            <div className={`word-tag ${isLearned ? 'learned' : ''}`} key={wordIdx}>
              {isLearned && '✅ '}{word}
              {/* 한글 뜻 — 클릭하면 후보 중에서 고르거나 직접 입력 */}
              <button
                className={`word-meaning ${ko ? '' : 'empty'}`}
                title="뜻 고르기 / 수정"
                onClick={() => openMeaningPicker(word, ko)}
              >
                {ko || '뜻 입력'}
              </button>
              {/* 그림 고르기 (자동 선택이 틀렸을 때) */}
              <button
                className="word-image-btn"
                title="그림 고르기"
                onClick={() => openImagePicker(word, (day.images || {})[word] || '')}
              >
                🖼️
              </button>
              <button
                className="remove-word"
                onClick={() => setDeleteWordConfirm(wordIdx)}
                title="삭제"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {day.words.length > 0 && fillMissingMeanings && (
        <div className="fill-meaning-row">
          <button className="fill-meaning-btn" disabled={fillingKo}
            onClick={async () => {
              setFillingKo(true);
              try { alert(translateResultMsg(await fillMissingMeanings(dayIdx, false), '단어')); }
              finally { setFillingKo(false); }
            }}>
            {fillingKo ? '🇰🇷 뜻 채우는 중...' : '🇰🇷 빈 뜻 자동 채우기'}
          </button>
          <button className="fill-meaning-btn redo" disabled={fillingKo}
            onClick={async () => {
              if (!window.confirm('이 레슨의 모든 단어 뜻을 다시 번역할까요?\n직접 고친 내용도 덮어써집니다.')) return;
              setFillingKo(true);
              try { alert(translateResultMsg(await fillMissingMeanings(dayIdx, true), '단어')); }
              finally { setFillingKo(false); }
            }}>
            ♻️ 전체 다시 번역
          </button>
          <span className="ai-quota-note">뜻은 등록 후 여기서 한 번에 채워요 · {aiQuotaText}</span>
        </div>
      )}

      <div className="add-word-row">
        <input
          ref={inputRef}
          className="add-word-input"
          type="text"
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="단어 입력..."
        />
        <button className="add-word-btn" onClick={handleAdd}>
          추가
        </button>
        <div className="ocr-menu-wrapper" ref={ocrMenuRef}>
          <button
            className="add-word-btn ocr-camera-btn"
            onClick={handleCameraClick}
            disabled={ocr.loading}
            title="사진으로 단어 추가"
          >
            📷
          </button>
          {showOcrMenu && (
            <div className="ocr-menu-popup">
              <button className="ocr-menu-item" onClick={handleCameraSelect}>
                <span className="ocr-menu-icon">📸</span>
                <span>카메라 촬영</span>
              </button>
              <button className="ocr-menu-item" onClick={handleAlbumSelect}>
                <span className="ocr-menu-icon">🖼️</span>
                <span>사진첩에서 선택</span>
              </button>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />
        <input ref={albumInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} style={{ display: 'none' }} />
      </div>

      {/* OCR 로딩 표시 */}
      {ocr.loading && (
        <div className="ocr-loading">
          <span className="ocr-loading-spinner"></span>
          <span className="ocr-loading-text">
            {ocr.multiProgress ? `사진 인식 중... (${ocr.multiProgress.current}/${ocr.multiProgress.total}장)` : '사진 인식 중...'}
          </span>
        </div>
      )}

      {/* OCR 결과 미리보기 */}
      {ocr.results && (
        <div className="ocr-results">
          <div className="ocr-results-header">
            <span className="ocr-results-title">
              📷 인식된 단어 ({ocr.results.filter(r => r.checked).length}개 선택){ocr.multiProgress ? ` — ${ocr.multiProgress.total}장 처리` : ''}
              <span className={`ocr-engine-badge ${ocr.engine}`}>
                {ocr.engine === 'azure' ? '☁️ Azure Vision' : '💻 로컬 OCR'}
              </span>
            </span>
            <div className="ocr-results-actions">
              <button className="ocr-add-btn" onClick={handleOcrAddAll} disabled={ocr.results.filter(r => r.checked).length === 0}>
                선택 단어 추가
              </button>
              <button className="ocr-cancel-btn" onClick={handleOcrCancel}>취소</button>
            </div>
          </div>
          {ocr.previewUrls && ocr.previewUrls.length > 0 && (
            <div className="ocr-preview-images">
              {ocr.previewUrls.map((u, i) => (
                <div className="ocr-preview-thumb" key={i}>
                  <img src={u} alt={`OCR 원본 ${i + 1}`} />
                  {ocr.previewUrls.length > 1 && <span className="ocr-preview-num">{i + 1}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="ocr-results-list">
            {ocr.results.map((item, idx) => (
              <div className={`ocr-result-item ${item.checked ? 'checked' : ''}`} key={idx}>
                <input type="checkbox" checked={item.checked} onChange={() => toggleOcrItem(idx)} />
                <input type="text" className="ocr-result-text" value={item.text} onChange={(e) => updateOcrText(idx, e.target.value)} />
              </div>
            ))}
          </div>
          {ocr.results.length === 0 && (
            <div className="ocr-no-results">영문 단어를 찾지 못했어요. 다른 사진을 시도해 주세요.</div>
          )}
        </div>
      )}
      </>}

      {/* 뜻 고르기 팝업 */}
      {koPicker && (
        <div className="sentence-delete-overlay" onClick={() => setKoPicker(null)}>
          <div className="ko-picker" onClick={(e) => e.stopPropagation()}>
            <div className="ko-picker-title">🇰🇷 <b>{koPicker.word}</b> 의 뜻</div>

            <input
              className="ko-picker-input"
              value={koPicker.draft}
              onChange={(e) => setKoPicker(p => ({ ...p, draft: e.target.value }))}
              placeholder="직접 입력하거나 아래에서 고르세요"
              autoFocus
            />

            <div className="ko-picker-list">
              {koPicker.loading ? (
                <div className="ko-picker-note">후보를 찾는 중...</div>
              ) : koPicker.candidates.length === 0 ? (
                <div className="ko-picker-note">사전 후보가 없어요. 직접 입력해 주세요.</div>
              ) : (
                koPicker.candidates.map((c, i) => (
                  <button key={i}
                    className={`ko-picker-chip ${koPicker.draft === c ? 'sel' : ''}`}
                    onClick={() => setKoPicker(p => ({ ...p, draft: c }))}>
                    {c}
                  </button>
                ))
              )}
            </div>

            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setKoPicker(null)}>취소</button>
              <button className="ko-picker-save" onClick={() => {
                if (setWordMeaning) setWordMeaning(dayIdx, koPicker.word, (koPicker.draft || '').trim());
                setKoPicker(null);
              }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 그림 고르기 팝업 */}
      {imgPicker && (
        <div className="sentence-delete-overlay" onClick={() => setImgPicker(null)}>
          <div className="ko-picker" onClick={(e) => e.stopPropagation()}>
            <div className="ko-picker-title">🖼️ <b>{imgPicker.word}</b> 의 그림 고르기</div>

            {imgPicker.loading ? (
              <div className="ko-picker-note">그림을 찾는 중...</div>
            ) : imgPicker.candidates.length === 0 ? (
              <div className="ko-picker-note">이 단어의 그림이 없어요.</div>
            ) : (
              <div className="img-picker-grid">
                {imgPicker.candidates.map((url, i) => (
                  <button key={i}
                    className={`img-picker-item ${imgPicker.sel === url ? 'sel' : ''}`}
                    onClick={() => setImgPicker(p => ({ ...p, sel: url }))}>
                    <img src={url} alt={`${imgPicker.word} ${i + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => { if (setWordImage) setWordImage(dayIdx, imgPicker.word, ''); setImgPicker(null); }}>지정 해제</button>
              <button className="ko-picker-save" disabled={!imgPicker.sel} onClick={() => {
                if (setWordImage) setWordImage(dayIdx, imgPicker.word, imgPicker.sel);
                setImgPicker(null);
              }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 단어 삭제 확인 팝업 */}
      {deleteWordConfirm >= 0 && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteWordConfirm(-1)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 단어를 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">"{day.words[deleteWordConfirm]}"</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteWordConfirm(-1)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeWordFromDay(dayIdx, deleteWordConfirm); setDeleteWordConfirm(-1); }}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Lesson 삭제 확인 팝업 */}
      {deleteLessonConfirm && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteLessonConfirm(false)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 Lesson을 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">📅 {day.name} ({day.words.length}단어)</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteLessonConfirm(false)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeDay(dayIdx); setDeleteLessonConfirm(false); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======================================================
// 로그 페이지 컴포넌트
// ======================================================
// ======================================================
// 문장 관리 페이지 컴포넌트
// ======================================================
function SentenceAdminPage({ days, addDay, removeDay, addSentenceToDay, removeSentenceFromDay, editSentenceInDay, reorderSentenceInDay, setSentenceMeaning, fillMissingSentenceMeanings, aiQuotaText, updateDayDate, updateDayName, selectedYear, selectedMonth, handleYearChange, handleMonthChange, lessonSortKey = 'name', lessonSortOrder = 'asc' }) {
  return (
    <div className="admin-container">
      {/* Year / Month selector */}
      <div className="day-selector" style={{ marginBottom: 8 }}>
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
              {m}월
            </button>
          ))}
        </div>
      </div>

      <div className="admin-top-bar">
        <button className="add-day-btn" onClick={addDay}>
          ➕ Lesson 추가 ({selectedYear}년 {selectedMonth}월)
        </button>
      </div>

      {days.length === 0 && (
        <div className="no-day-message">
          <span className="msg-emoji">📝</span>
          <span className="msg-text">{selectedYear}년 {selectedMonth}월에 Lesson이 없어요. 위 버튼으로 추가해 주세요!</span>
        </div>
      )}

      {/* 설정의 정렬 기준을 그대로 사용 (학습 화면과 동일한 순서) */}
      {sortLessons(days, lessonSortKey, lessonSortOrder).map(({ d: day, i: dayIdx }) => {
        return (
          <SentenceDayCard
            key={day.id || dayIdx}
            day={day}
            dayIdx={dayIdx}
            removeDay={removeDay}
            addSentenceToDay={addSentenceToDay}
            removeSentenceFromDay={removeSentenceFromDay}
            editSentenceInDay={editSentenceInDay}
            reorderSentenceInDay={reorderSentenceInDay}
            setSentenceMeaning={setSentenceMeaning}
            fillMissingSentenceMeanings={fillMissingSentenceMeanings}
            aiQuotaText={aiQuotaText}
            updateDayDate={updateDayDate}
            updateDayName={updateDayName}
          />
        );
      })}
    </div>
  );
}

// ======================================================
// 문장 Lesson 카드 컴포넌트
// ======================================================
function SentenceDayCard({ day, dayIdx, removeDay, addSentenceToDay, removeSentenceFromDay, editSentenceInDay, reorderSentenceInDay, setSentenceMeaning, fillMissingSentenceMeanings, aiQuotaText, updateDayDate, updateDayName }) {
  const [fillingKo, setFillingKo] = useState(false); // 뜻 자동 채우기 진행 중
  const [newSentence, setNewSentence] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editText, setEditText] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(day.name);
  const saveName = () => { if (updateDayName) updateDayName(dayIdx, nameDraft); setEditingName(false); };
  const [dragState, setDragState] = useState({ from: -1, over: -1 });
  const [deleteConfirm, setDeleteConfirm] = useState(-1);
  const [deleteLessonConfirm, setDeleteLessonConfirm] = useState(false);
  const editInputRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const ocrMenuRef = useRef(null);
  const dateRef = useRef(null);
  const [showOcrMenu, setShowOcrMenu] = useState(false);
  const dragRef = useRef({ active: false, fromIdx: -1, startY: 0, clone: null, container: null });

  // ─── OCR 메뉴 외부 클릭 시 닫기 ───
  useEffect(() => {
    if (!showOcrMenu) return;
    const handleOutside = (e) => {
      if (ocrMenuRef.current && !ocrMenuRef.current.contains(e.target)) {
        setShowOcrMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showOcrMenu]);

  const openDatePicker = (e) => {
    e.stopPropagation();
    dateRef.current?.showPicker?.();
    dateRef.current?.focus();
  };

  // ─── 드래그 순서변경 (마우스+터치 직접 구현) ───
  const handleDragStart = (e, idx) => {
    const isTouch = e.type === 'touchstart';
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const row = e.target.closest('.sentence-tag');
    const container = row.parentElement;
    const rect = row.getBoundingClientRect();

    // 클론 생성 (드래그 중 따라다니는 요소)
    const clone = row.cloneNode(true);
    clone.className = 'sentence-tag drag-clone';
    clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;z-index:9999;opacity:0.85;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:none;`;
    document.body.appendChild(clone);

    dragRef.current = { active: true, fromIdx: idx, startY: clientY, offsetY: clientY - rect.top, clone, container };
    setDragState({ from: idx, over: idx });

    if (isTouch) e.preventDefault();

    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const cy = ev.type === 'touchmove' ? ev.touches[0].clientY : ev.clientY;
      // 클론 위치 업데이트
      dragRef.current.clone.style.top = (cy - dragRef.current.offsetY) + 'px';
      // 어떤 아이템 위에 있는지 계산
      const items = dragRef.current.container.querySelectorAll('.sentence-tag');
      let overIdx = dragRef.current.fromIdx;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (cy >= r.top && cy <= r.bottom) { overIdx = i; break; }
      }
      setDragState(prev => prev.over !== overIdx ? { ...prev, over: overIdx } : prev);
      if (ev.type === 'touchmove') ev.preventDefault();
    };

    const onEnd = () => {
      if (!dragRef.current.active) return;
      const { fromIdx, clone: cl } = dragRef.current;
      if (cl && cl.parentElement) cl.parentElement.removeChild(cl);
      dragRef.current = { active: false, fromIdx: -1, startY: 0, clone: null, container: null };
      setDragState(prev => {
        if (prev.from >= 0 && prev.over >= 0 && prev.from !== prev.over) {
          reorderSentenceInDay(dayIdx, prev.from, prev.over);
        }
        return { from: -1, over: -1 };
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  // OCR 상태 (하나의 객체로 관리 → 리렌더 1회)
  const [ocr, setOcr] = useState({ loading: false, results: null, previewUrls: [], engine: '' });

  const handleAdd = () => {
    if (newSentence.trim()) {
      addSentenceToDay(dayIdx, newSentence);
      setNewSentence('');
      setCollapsed(false);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  // ─── OCR: 사진에서 문장 추출 ───
  const handleCameraClick = () => {
    setShowOcrMenu(prev => !prev);
  };
  const handleCameraSelect = () => {
    setShowOcrMenu(false);
    fileInputRef.current?.click();
  };
  const handleAlbumSelect = () => {
    setShowOcrMenu(false);
    albumInputRef.current?.click();
  };

  // ─── 이미지 리사이즈 + 압축 (Azure 업로드용, 4MB 이하로) ───
  const compressImageForUpload = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1600; // 최대 1600px
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  // ─── Azure Computer Vision OCR (REST API) ───
  const ocrWithAzureVision = async (file) => {
    const key = localStorage.getItem('woojin-azure-vision-key');
    const endpoint = localStorage.getItem('woojin-azure-vision-endpoint');
    if (!key || !endpoint) return null;
    addVisionUsageFirestore();

    // 이미지 압축 (카메라 사진은 보통 5~10MB → 1MB 이하로)
    const compressed = await compressImageForUpload(file);
    const arrayBuffer = await compressed.arrayBuffer();

    // endpoint에서 trailing slash 제거
    const baseUrl = endpoint.replace(/\/+$/, '');

    // Read API 호출
    const analyzeRes = await fetch(
      `${baseUrl}/vision/v3.2/read/analyze?language=en`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/octet-stream',
        },
        body: arrayBuffer,
      }
    );

    if (!analyzeRes.ok) {
      const errText = await analyzeRes.text().catch(() => '');
      console.warn('Azure Vision 실패:', analyzeRes.status, errText);
      throw new Error(`Azure Vision ${analyzeRes.status}: ${errText.slice(0, 100)}`);
    }

    const operationUrl = analyzeRes.headers.get('Operation-Location');
    if (!operationUrl) throw new Error('Operation-Location 헤더 없음');

    // 결과 폴링 (최대 15초)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(operationUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      const pollData = await pollRes.json();

      if (pollData.status === 'succeeded') {
        const lines = [];
        for (const page of (pollData.analyzeResult?.readResults || [])) {
          for (const line of (page.lines || [])) {
            lines.push(line.text);
          }
        }
        return lines;
      }
      if (pollData.status === 'failed') throw new Error('Azure Vision 분석 실패');
    }
    throw new Error('Azure Vision 타임아웃');
  };

  // ─── Tesseract.js 폴백용 이미지 전처리 ───
  const preprocessImage = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_W = 2000;
        let w = img.width, h = img.height;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
        if (w < 600) { h *= 2; w *= 2; }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          const bw = gray < 140 ? 0 : 255;
          d[i] = d[i+1] = d[i+2] = bw;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      };
      img.src = URL.createObjectURL(file);
    });
  };

  // ─── 인식된 텍스트를 문장 단위로 정리 ───
  const cleanOcrLines = (lines) => {
    return lines
      .map(l => l.trim())
      .map(l => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter(l => {
        const englishWords = l.match(/[a-zA-Z]{2,}/g);
        return englishWords && englishWords.length >= 2;
      })
      .map(l => l.replace(/[|=~><{}\[\]]/g, '').replace(/\s{2,}/g, ' ').trim())
      .filter(l => l.length >= 5);
  };

  // 단일 파일 OCR 처리 (내부 유틸)
  const ocrSingleFile = async (file) => {
    let lines = [];
    let usedEngine = '';
    try {
      try {
        const azureLines = await ocrWithAzureVision(file);
        if (azureLines && azureLines.length > 0) {
          lines = cleanOcrLines(azureLines);
          if (lines.length > 0) usedEngine = 'azure';
        }
      } catch (visionErr) {
        console.warn('Azure Vision 에러:', visionErr.message);
      }
      if (lines.length === 0) {
        usedEngine = 'tesseract';
        const processedBlob = await preprocessImage(file);
        const worker = await createWorker('eng', 1, {});
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        const { data } = await worker.recognize(processedBlob);
        await worker.terminate();
        lines = cleanOcrLines(data.text.split('\n'));
      }
    } catch (err) {
      console.error('OCR 실패:', err);
    }
    return { lines, usedEngine };
  };

  const handleFileChange = async (e) => {
    let files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';
    if (files.length > 5) {
      alert('최대 5장까지 선택할 수 있어요.');
      files = files.slice(0, 5);
    }

    const previewUrls = files.map(f => URL.createObjectURL(f));
    setOcr({ loading: true, results: null, previewUrls, engine: '', multiProgress: files.length > 1 ? { current: 0, total: files.length } : null });

    let allLines = [];
    let lastEngine = '';

    for (let i = 0; i < files.length; i++) {
      if (files.length > 1) {
        setOcr(prev => ({ ...prev, multiProgress: { current: i + 1, total: files.length } }));
      }
      const { lines, usedEngine } = await ocrSingleFile(files[i]);
      allLines = allLines.concat(lines);
      if (usedEngine) lastEngine = usedEngine;
    }

    setOcr({
      loading: false,
      results: allLines.map(text => ({ text, checked: true })),
      previewUrls,
      engine: lastEngine,
      multiProgress: files.length > 1 ? { current: files.length, total: files.length } : null,
    });
  };

  // OCR 결과에서 선택된 문장 일괄 추가
  const handleOcrAddAll = () => {
    if (!ocr.results) return;
    const toAdd = ocr.results.filter(r => r.checked);
    toAdd.forEach(r => addSentenceToDay(dayIdx, r.text));
    (ocr.previewUrls || []).forEach(u => URL.revokeObjectURL(u));
    setOcr({ loading: false, results: null, previewUrls: [], engine: '', multiProgress: null });
    setCollapsed(false);
  };

  const handleOcrCancel = () => {
    (ocr.previewUrls || []).forEach(u => URL.revokeObjectURL(u));
    setOcr({ loading: false, results: null, previewUrls: [], engine: '', multiProgress: null });
  };

  const toggleOcrItem = (idx) => {
    setOcr(prev => ({ ...prev, results: prev.results.map((r, i) => i === idx ? { ...r, checked: !r.checked } : r) }));
  };

  const updateOcrText = (idx, text) => {
    setOcr(prev => ({ ...prev, results: prev.results.map((r, i) => i === idx ? { ...r, text } : r) }));
  };

  const sentences = day.sentences || [];

  return (
    <div className="day-card">
      <div className="day-card-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
        <div className="day-card-title">
          <span className="day-card-toggle">{collapsed ? '▶' : '▼'}</span>
          {editingName ? (
            <input
              className="day-name-input"
              value={nameDraft}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveName(); else if (e.key === 'Escape') { setNameDraft(day.name); setEditingName(false); } }}
              onBlur={saveName}
            />
          ) : (
            <>
              <span className="day-name-plain">📅 {day.name}</span>
              <button className="day-name-edit-btn" onClick={(e) => { e.stopPropagation(); setNameDraft(day.name); setEditingName(true); }} title="이름 수정">✏️</button>
            </>
          )}
          {day.date ? (
            <span className="day-card-date" onClick={openDatePicker} title="클릭하여 날짜 수정">
              ({day.date}) <span className="day-date-edit-icon">✏️</span>
            </span>
          ) : (
            <span className="day-card-date day-card-date-empty" onClick={openDatePicker} title="날짜 추가">
              <span className="day-date-edit-icon">📅+</span>
            </span>
          )}
          {sentences.length > 0 && (
            <span className="day-card-progress">
              {sentences.length}문장
            </span>
          )}
        </div>
        <input
          ref={dateRef}
          type="date"
          className="day-date-input-hidden"
          value={day.date || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); updateDayDate(dayIdx, e.target.value); }}
        />
        <button className="delete-day-btn" onClick={(e) => { e.stopPropagation(); setDeleteLessonConfirm(true); }}>
          🗑️ 삭제
        </button>
      </div>

      {!collapsed && <><div className="sentence-tags">
        {sentences.length === 0 && (
          <div className="empty-words">아직 문장이 없어요. 아래에서 추가해 주세요!</div>
        )}
        {sentences.map((sentence, sIdx) => (
          <div
            className={`sentence-tag${dragState.from === sIdx ? ' dragging' : ''}${dragState.over === sIdx && dragState.from !== sIdx ? ' drag-over' : ''}`}
            key={sIdx}
          >
            <span
              className="sentence-drag-handle"
              onMouseDown={(e) => handleDragStart(e, sIdx)}
              onTouchStart={(e) => handleDragStart(e, sIdx)}
            >☰</span>
            <span className="sentence-number">{sIdx + 1}.</span>
            {editingIdx === sIdx ? (
              <div className="sentence-edit-row">
                <input
                  ref={editInputRef}
                  className="sentence-edit-input"
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editText.trim()) { editSentenceInDay(dayIdx, sIdx, editText); }
                      setEditingIdx(-1);
                    } else if (e.key === 'Escape') { setEditingIdx(-1); }
                  }}
                />
                <button className="sentence-edit-save" onClick={() => { if (editText.trim()) { editSentenceInDay(dayIdx, sIdx, editText); } setEditingIdx(-1); }} title="저장">✓</button>
                <button className="sentence-edit-cancel" onClick={() => setEditingIdx(-1)} title="취소">✕</button>
              </div>
            ) : (
              <>
                <div className="sentence-text-col">
                  <span className="sentence-text-admin">{sentence}</span>
                  {/* 한글 뜻 — 클릭하면 수정 */}
                  <button
                    className={`sentence-meaning ${(day.meanings || {})[sentence] ? '' : 'empty'}`}
                    title="뜻 수정"
                    onClick={() => {
                      const cur = (day.meanings || {})[sentence] || '';
                      const v = window.prompt(`"${sentence}"의 한글 뜻`, cur);
                      if (v !== null && setSentenceMeaning) setSentenceMeaning(dayIdx, sentence, v.trim());
                    }}
                  >
                    {(day.meanings || {})[sentence] || '뜻 입력'}
                  </button>
                </div>
                <div className="sentence-action-btns">
                  <button className="sentence-edit-btn" onClick={() => { setEditingIdx(sIdx); setEditText(sentence); setTimeout(() => editInputRef.current?.focus(), 50); }} title="수정">✏️</button>
                  <button className="remove-word" onClick={() => setDeleteConfirm(sIdx)} title="삭제">✕</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {sentences.length > 0 && fillMissingSentenceMeanings && (
        <div className="fill-meaning-row">
          <button className="fill-meaning-btn" disabled={fillingKo}
            onClick={async () => {
              setFillingKo(true);
              try { alert(translateResultMsg(await fillMissingSentenceMeanings(dayIdx, false), '문장')); }
              finally { setFillingKo(false); }
            }}>
            {fillingKo ? '🇰🇷 뜻 채우는 중...' : '🇰🇷 빈 뜻 자동 채우기'}
          </button>
          <button className="fill-meaning-btn redo" disabled={fillingKo}
            onClick={async () => {
              if (!window.confirm('이 레슨의 모든 문장 뜻을 다시 번역할까요?\n직접 고친 내용도 덮어써집니다.')) return;
              setFillingKo(true);
              try { alert(translateResultMsg(await fillMissingSentenceMeanings(dayIdx, true), '문장')); }
              finally { setFillingKo(false); }
            }}>
            ♻️ 전체 다시 번역
          </button>
          <span className="ai-quota-note">뜻은 등록 후 여기서 한 번에 채워요 · {aiQuotaText}</span>
        </div>
      )}

      <div className="add-word-row">
        <input
          ref={inputRef}
          className="add-word-input"
          type="text"
          value={newSentence}
          onChange={(e) => setNewSentence(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="영어 문장 입력..."
        />
        <button className="add-word-btn sentence-add-btn" onClick={handleAdd}>
          추가
        </button>
        <div className="ocr-menu-wrapper" ref={ocrMenuRef}>
          <button
            className="add-word-btn ocr-camera-btn"
            onClick={handleCameraClick}
            disabled={ocr.loading}
            title="사진으로 문장 추가"
          >
            📷
          </button>
          {showOcrMenu && (
            <div className="ocr-menu-popup">
              <button className="ocr-menu-item" onClick={handleCameraSelect}>
                <span className="ocr-menu-icon">📸</span>
                <span>카메라 촬영</span>
              </button>
              <button className="ocr-menu-item" onClick={handleAlbumSelect}>
                <span className="ocr-menu-icon">🖼️</span>
                <span>사진첩에서 선택</span>
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <input
          ref={albumInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* OCR 로딩 표시 */}
      {ocr.loading && (
        <div className="ocr-loading">
          <span className="ocr-loading-spinner"></span>
          <span className="ocr-loading-text">
            {ocr.multiProgress
              ? `사진 인식 중... (${ocr.multiProgress.current}/${ocr.multiProgress.total}장)`
              : '사진 인식 중...'}
          </span>
        </div>
      )}

      {/* OCR 결과 미리보기 */}
      {ocr.results && (
        <div className="ocr-results">
          <div className="ocr-results-header">
            <span className="ocr-results-title">
              📷 인식 결과 ({ocr.results.filter(r => r.checked).length}개 선택){ocr.multiProgress ? ` — ${ocr.multiProgress.total}장 처리` : ''}
              <span className={`ocr-engine-badge ${ocr.engine}`}>
                {ocr.engine === 'azure' ? '☁️ Azure Vision' : '💻 로컬 OCR'}
              </span>
            </span>
            <div className="ocr-results-actions">
              <button className="ocr-add-btn" onClick={handleOcrAddAll} disabled={ocr.results.filter(r => r.checked).length === 0}>
                선택 항목 추가
              </button>
              <button className="ocr-cancel-btn" onClick={handleOcrCancel}>취소</button>
            </div>
          </div>
          {ocr.previewUrls && ocr.previewUrls.length > 0 && (
            <div className="ocr-preview-images">
              {ocr.previewUrls.map((u, i) => (
                <div className="ocr-preview-thumb" key={i}>
                  <img src={u} alt={`OCR 원본 ${i + 1}`} />
                  {ocr.previewUrls.length > 1 && <span className="ocr-preview-num">{i + 1}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="ocr-results-list">
            {ocr.results.map((item, idx) => (
              <div className={`ocr-result-item ${item.checked ? 'checked' : ''}`} key={idx}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => toggleOcrItem(idx)}
                />
                <input
                  type="text"
                  className="ocr-result-text"
                  value={item.text}
                  onChange={(e) => updateOcrText(idx, e.target.value)}
                />
              </div>
            ))}
          </div>
          {ocr.results.length === 0 && (
            <div className="ocr-no-results">영문 텍스트를 찾지 못했어요. 다른 사진을 시도해 주세요.</div>
          )}
        </div>
      )}
      </>}

      {/* 문장 삭제 확인 팝업 */}
      {deleteConfirm >= 0 && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteConfirm(-1)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 문장을 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">"{sentences[deleteConfirm]}"</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteConfirm(-1)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeSentenceFromDay(dayIdx, deleteConfirm); setDeleteConfirm(-1); }}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Lesson 삭제 확인 팝업 */}
      {deleteLessonConfirm && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteLessonConfirm(false)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 Lesson을 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">📅 {day.name} ({sentences.length}문장)</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteLessonConfirm(false)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeDay(dayIdx); setDeleteLessonConfirm(false); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======================================================
// 단어 찾기 페이지 컴포넌트
// ======================================================
function FindWordPage({ data, azureKey, azureRegion, azureVerified, azureVoice, ttsLimitReached, currentUser }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedWord, setSelectedWord] = useState('');
  const [isWordFound, setIsWordFound] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);

  // 🔍 검색 범위 모드: 'registered' = 등록된 단어만 / 'all' = 모든 단어
  const [searchMode, setSearchMode] = useState('all');

  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imgList, setImgList] = useState([]);   // 그림 후보들
  const [imgIdx, setImgIdx] = useState(0);      // 현재 보고 있는 후보
  const [koMeaning, setKoMeaning] = useState(''); // 한글 뜻 (실시간 조회)

  const [repeatCount, setRepeatCount] = useState(3);
  const [repeatGap, setRepeatGap] = useState(2);

  const [fwActivity, setFwActivity] = useState(null); // 'trace' | 'pronounce' | null (개별 도구)
  const [isPlaying, setIsPlaying] = useState(false);
  const abortRef = useRef(false);

  // 모든 학습 단어 취합 (중복 제거)
  const allWords = useMemo(() => {
    const words = [];
    Object.values(data).forEach(month => {
      month.forEach(day => {
        if (day.words) words.push(...day.words);
      });
    });
    return [...new Set(words)].filter(Boolean).sort();
  }, [data]);

  // 검색어 입력 시 자동완성 필터링
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSuggestions([]);
      return;
    }
    const filtered = allWords.filter(w => w.toLowerCase().includes(term));
    setSuggestions(filtered.slice(0, 10)); // 최대 10개
  }, [searchTerm, allWords]);

  // 이미지 프리로드 헬퍼
  const preloadImage = useCallback((url, timeoutMs = 6000) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
      img.src = url;
    });
  }, []);

  // 이미지 검색 — 후보를 모두 받아서 넘겨볼 수 있게 (nut처럼 뜻이 갈리는 단어 대응)
  const fetchImage = async (word) => {
    const query = (word || '').toLowerCase().trim();
    setImageLoading(true);
    setImageUrl(''); setImgList([]); setImgIdx(0); setKoMeaning('');
    // 한글 뜻도 같이 조회 (실시간)
    translateToKo(query).then(t => setKoMeaning(t || '')).catch(() => {});
    try {
      const list = await arasaacCandidates(query);
      if (list.length) {
        setImgList(list);
        await preloadImage(list[0]);
        setImageUrl(list[0]);
      }
    } catch { /* 실패 처리 생략 */ }
    setImageLoading(false);
  };

  const handleSelectWord = (word) => {
    setSearchTerm(word);
    setSuggestions([]);

    // 중단 후 초기화
    abortRef.current = true;
    window.speechSynthesis.cancel();
    setIsPlaying(false);

    // 'all' 모드: 등록 여부와 상관없이 모든 단어를 검색 가능
    // 'registered' 모드: 등록된 단어만 검색 가능
    if (searchMode === 'all' || allWords.includes(word)) {
      setSelectedWord(word);
      setIsWordFound(true);
      fetchImage(word);
    } else {
      setSelectedWord('');
      setIsWordFound(false);
      setImageUrl('');
    }
    setHasSearched(true);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const term = searchTerm.trim().toLowerCase();
      if (term) {
        handleSelectWord(term);
      }
    }
  };

  // Azure TTS로 단어 발음 재생 (캐시 지원)
  const playWordAzure = async (word) => {
    if (abortRef.current) return;

    const cacheKey = makeCacheKey(word, azureVoice, '-10%');

    // 캐시 확인
    const cached = await getCachedAudio(cacheKey);
    if (cached) {
      await playCachedAudio(cached);
      return;
    }

    // 캐시 미스 — TTS 제한 체크
    if (ttsLimitReached) {
      console.warn('TTS 제한 초과');
      return;
    }
    // Azure 호출 (null = 직접 재생 안 함, AudioContext로 재생)
    addSpeechUsageFirestore(word.length, currentUser?.uid);
    return new Promise((resolve) => {
      const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);

      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${azureVoice}">
          <prosody rate="-10%" pitch="+0%">${word}</prosody>
        </voice>
      </speak>`;

      synthesizer.speakSsmlAsync(
        ssml,
        (result) => {
          synthesizer.close();
          if (result.audioData && result.audioData.byteLength > 0) {
            const audioArr = new Uint8Array(result.audioData);
            setCachedAudio(cacheKey, audioArr);
            playCachedAudio(audioArr).then(resolve);
          } else {
            resolve();
          }
        },
        (error) => {
          console.error('Azure TTS 에러:', error);
          synthesizer.close();
          resolve();
        }
      );
    });
  };

  // Web Speech API 폴백 (Azure Key 미설정 시)
  const getFemaleVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    let voice = voices.find(v => v.name === 'Google US English');
    if (!voice) voice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
    if (!voice) voice = voices.find(v => v.name.includes('Zira') || v.name.includes('Samantha'));
    return voice;
  };

  const playWordFallback = (word) => {
    return new Promise((resolve) => {
      if (abortRef.current) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      const voice = getFemaleVoice();
      if (voice) utterance.voice = voice;
      const forceNext = setTimeout(resolve, 3000);
      utterance.onend = () => { clearTimeout(forceNext); resolve(); };
      utterance.onerror = () => { clearTimeout(forceNext); resolve(); };
      synth.speak(utterance);
    });
  };

  // 인증된 Azure Key가 있을 때만 Azure TTS 사용
  const playWord = (word) => {
    if (azureVerified && azureKey && azureRegion) {
      return playWordAzure(word);
    }
    return playWordFallback(word);
  };

  const handleListen = async () => {
    if (!selectedWord || isPlaying) return;
    setIsPlaying(true);
    abortRef.current = false;

    for (let i = 0; i < repeatCount; i++) {
      if (abortRef.current) break;
      await playWord(selectedWord);
      if (i < repeatCount - 1) {
        await new Promise(r => setTimeout(r, repeatGap * 1000));
      }
    }
    setIsPlaying(false);
  };

  const handleStop = () => {
    abortRef.current = true;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  return (
    <div className="find-container">
      <div className="find-search-section">
        <div className="section-title">🔍 단어 검색</div>

        {/* 검색 범위 선택 */}
        <div className="search-mode-toggle">
          <span className="search-mode-label">검색 범위:</span>
          <button
            className={`search-mode-btn ${searchMode === 'registered' ? 'active' : ''}`}
            onClick={() => {
              setSearchMode('registered');
              // 모드 변경 시 결과 초기화 (기존 선택 단어는 유지)
              if (selectedWord && !allWords.includes(selectedWord)) {
                setIsWordFound(false);
                setSelectedWord('');
                setImageUrl('');
              }
            }}
          >
            📚 등록된 단어만
          </button>
          <button
            className={`search-mode-btn ${searchMode === 'all' ? 'active' : ''}`}
            onClick={() => {
              setSearchMode('all');
              // '모든 단어' 모드로 바꾸면 '찾지못함' 플래그 해제
              if (!isWordFound && searchTerm.trim()) {
                setIsWordFound(true);
              }
            }}
          >
            🌐 모든 단어
          </button>
        </div>

        <div className="search-input-wrapper">
          <input
            type="text"
            className="find-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchMode === 'all' ? '원하는 영어 단어를 입력하세요...' : '등록된 단어를 입력하세요...'}
          />
          {suggestions.length > 0 && (
            <ul className="suggestions-list">
              {suggestions.map(word => (
                <li key={word} onClick={() => handleSelectWord(word)}>
                  {word}
                </li>
              ))}
            </ul>
          )}
          <button className="find-search-btn" onClick={() => handleSelectWord(searchTerm.trim().toLowerCase())} disabled={!searchTerm.trim()}>
            검색
          </button>
        </div>
      </div>

      <div className="find-result-section">
        <div className="find-image-area">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={selectedWord}
              onError={(e) => {
                e.target.style.display = 'none';
                setImageUrl('');
              }}
              className="find-image"
            />
          ) : (
            <div className="find-image-placeholder">
              {imageLoading ? (
                <>
                  <span className="placeholder-emoji loading-spin">🔍</span>
                  이미지를 찾고 있어요...
                </>
              ) : (
                <>
                  <span className="placeholder-emoji">📖</span>
                  {selectedWord ? '이미지를 찾지 못했어요 😢' : (hasSearched && !isWordFound ? '등록되지 않은 단어입니다.' : '위에서 단어를 검색하세요!')}
                </>
              )}
            </div>
          )}
        </div>

        {/* 그림 후보 넘기기 — 뜻이 갈리는 단어(nut 등)를 바로 바꿔 볼 수 있게 */}
        {imgList.length > 1 && (
          <div className="find-img-switch">
            <span className="find-img-switch-label">다른 그림 {imgIdx + 1}/{imgList.length}</span>
            <div className="find-img-thumbs">
              {imgList.map((u, i) => (
                <button key={i}
                  className={`find-img-thumb ${i === imgIdx ? 'sel' : ''}`}
                  onClick={() => { setImgIdx(i); setImageUrl(u); }}>
                  <img src={u} alt={`${selectedWord} ${i + 1}`} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 한글 뜻 (실시간 조회) */}
        {selectedWord && koMeaning && (
          <div className="find-ko-meaning">🇰🇷 {koMeaning}</div>
        )}

        <div className="find-controls">
          <div className="find-word-display">
            {hasSearched && !isWordFound ? (
              <span className="rest-letters" style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>단어를 찾지못했습니다.</span>
            ) : (
              <>
                <span className="first-letter wiggle">{selectedWord ? selectedWord[0] : '?'}</span>
                <span className="rest-letters">{selectedWord ? selectedWord.substring(1) : ''}</span>
              </>
            )}
          </div>

          <div className="sm-settings-bar wlist-settings-bar">
            <div className="sm-setting-group">
              <span className="sm-setting-label">반복:</span>
              {[1, 2, 3, 4, 5].map(num => (
                <label key={num} className="sm-radio">
                  <input type="radio" name="findRepeat" checked={repeatCount === num} onChange={() => setRepeatCount(num)} disabled={isPlaying} />
                  <span className="sm-radio-text">{num}번</span>
                </label>
              ))}
            </div>
            <div className="sm-setting-group">
              <span className="sm-setting-label">간격:</span>
              {[1, 2, 3, 5].map(sec => (
                <label key={sec} className="sm-radio">
                  <input type="radio" name="findGap" checked={repeatGap === sec} onChange={() => setRepeatGap(sec)} disabled={isPlaying} />
                  <span className="sm-radio-text">{sec}초</span>
                </label>
              ))}
            </div>
          </div>

          <div className="start-btn-container" style={{ marginTop: '20px' }}>
            {isPlaying ? (
              <button className="start-btn stop" onClick={handleStop}>
                <span className="btn-emoji">⏹️</span>
                멈추기
              </button>
            ) : (
              <button className="start-btn ready" onClick={handleListen} disabled={!selectedWord}>
                <span className="btn-emoji">🔊</span>
                듣기
              </button>
            )}
          </div>

          {selectedWord && isWordFound && !isPlaying && (
            <div className="fw-activity-btns">
              <button className="fw-activity-btn" onClick={() => setFwActivity('trace')}>✏️ 따라쓰기</button>
              {azureVerified && azureKey && (
                <button className="fw-activity-btn" onClick={() => setFwActivity('pronounce')}>🎤 발음 평가</button>
              )}
            </div>
          )}

          {fwActivity && (
            <div className="wsc-overlay" onClick={(e) => { if (e.target === e.currentTarget) setFwActivity(null); }}>
              <div className="wsc-modal">
                <button className="wsc-close" onClick={() => setFwActivity(null)}>✕</button>
                {fwActivity === 'trace' && <TraceWord word={selectedWord} speak={playWord} />}
                {fwActivity === 'pronounce' && (
                  <PronunceCheck word={selectedWord} azureKey={azureKey} azureRegion={azureRegion} speak={playWord} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
     </div>
  );
}

export default App;
