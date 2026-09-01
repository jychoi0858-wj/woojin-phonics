import React, { useState, useRef, useEffect, useCallback } from 'react';
import FireworksCelebration from './FireworksCelebration';
import { stopCachedAudio } from './ttsCache';
import './SlingshotGame.css';

// 새총 단어 슈팅 (좌→우) — 8세용
// 왼쪽 새총에서 공을 당겨 쏘아, 오른쪽 보기 단어 과녁 중 "정답 단어"를 맞추기
// props: sentences[](문장 문자열), speak(text), onClose()
const SKIP = new Set(['a', 'i', 'an', 'the', 'is', 'am', 'to', 'of', 'it', 'in', 'on', 'no', 'so', 'at', 'or', 'do', 'be', 'my', 'me', 'he', 'we', 'up', 'if', 'as']);
const FALLBACK = ['dog', 'cat', 'sun', 'run', 'big', 'red', 'box', 'cup', 'hat', 'fun', 'car', 'bus'];
const GRAV = 0.42;
const POWER = 0.26;      // 당긴 거리 → 초기 속도
const MAX_PULL = 180;
const HIT_PAD = 20;      // 8세용 히트박스 여유
const BALL = 48;

const clean = (w) => (w || '').replace(/[^a-zA-Z']/g, '').toLowerCase();
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

// ─── 효과음 (Web Audio) ───
let _sgCtx = null;
function sgCtx() {
  if (!_sgCtx) _sgCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); // 저지연
  if (_sgCtx.state === 'suspended') _sgCtx.resume();
  return _sgCtx;
}

// 오디오 엔진 상시 가동 (무음 루프) — 첫 소리 지연 제거
let _sgKaOn = false;
function sgKeepAwake() {
  if (_sgKaOn) return;
  try {
    const c = sgCtx();
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(c.destination);
    src.start();
    _sgKaOn = true;
  } catch (e) { /* */ }
}

// 디코딩 버퍼 앞 무음 제거 (mp3 패딩 제거 → 즉시 발음)
function sgTrimLead(b) {
  try {
    const c = sgCtx();
    const d = b.getChannelData(0);
    let i = 0; const th = 0.03; // 어택을 더 공격적으로 트림 → 즉각적인 타격감
    while (i < d.length && Math.abs(d[i]) < th) i++;
    if (i < c.sampleRate * 0.003 || i >= d.length) return b;
    const nb = c.createBuffer(b.numberOfChannels, b.length - i, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) nb.getChannelData(ch).set(b.getChannelData(ch).subarray(i));
    return nb;
  } catch (e) { return b; }
}
function sgTone(freq, dur, type = 'sine', vol = 0.25, delayMs = 0) {
  try {
    const ctx = sgCtx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t = ctx.currentTime + delayMs / 1000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}
function sfxMiss() { sgTone(190, 0.2, 'square', 0.18); sgTone(150, 0.28, 'square', 0.14, 130); }

// ─── 녹음 효과음: public/sounds/ (leather=당김, stone-fly=발사 비행) ───
const SG_SAMPLES = {};
function sgLoadSample(name) {
  try {
    fetch((process.env.PUBLIC_URL || '') + '/sounds/' + name + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => { if (ab) sgCtx().decodeAudioData(ab).then(b => { SG_SAMPLES[name] = sgTrimLead(b); }).catch(() => {}); })
      .catch(() => {});
  } catch (e) { /* */ }
}
function sgPlayOnce(name, vol = 0.9) {
  const b = SG_SAMPLES[name]; if (!b) return;
  try {
    const c = sgCtx();
    const src = c.createBufferSource(); src.buffer = b;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(c.destination);
    src.start();
  } catch (e) { /* */ }
}
let _stretchSrc = null;
function sgStopStretch() { if (_stretchSrc) { try { _stretchSrc.stop(); } catch (e) { /* */ } _stretchSrc = null; } }
function sgPlayStretch() {
  const b = SG_SAMPLES.leather; if (!b) return;
  try {
    sgStopStretch();
    const c = sgCtx();
    const src = c.createBufferSource(); src.buffer = b;
    const g = c.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(c.destination);
    src.onended = () => { if (_stretchSrc === src) _stretchSrc = null; };
    src.start();
    _stretchSrc = src;
  } catch (e) { /* */ }
}
function sfxHit() { sgTone(660, 0.12, 'sine', 0.28); sgTone(880, 0.12, 'sine', 0.28, 90); sgTone(1175, 0.2, 'sine', 0.3, 180); }
function sfxChirp() { sgTone(1500, 0.07, 'square', 0.14); sgTone(1900, 0.06, 'square', 0.11, 70); sgTone(1200, 0.09, 'square', 0.1, 140); }

// 배경 새 생성 (높이·속도·크기 랜덤)
const makeBird = () => ({
  id: 'bird' + Math.random().toString(36).slice(2, 8),
  emoji: Math.random() < 0.5 ? '🐦' : '🕊️',
  top: (5 + Math.random() * 80).toFixed(1) + '%', // 위아래 전체 고르게
  dur: 20 + Math.random() * 18,
  delay: -Math.random() * 20,
  size: (1.2 + Math.random() * 0.7).toFixed(2) + 'rem',
  falling: false,
});

const ROUNDS = 5; // 한 판에 문장 5개

function buildRounds(sentences) {
  const list = (sentences || []).map(s => (typeof s === 'string' ? s : s?.text) || '').filter(Boolean);
  const withBlank = list.filter(s => s.split(/\s+/).some(w => { const c = clean(w); return c.length >= 2 && !SKIP.has(c); }));
  const pickFrom = withBlank.length ? withBlank : list;
  const picked = shuffle([...new Set(pickFrom)]).slice(0, Math.min(ROUNDS, pickFrom.length));
  const poolSet = new Set();
  list.forEach(s => s.split(/\s+/).forEach(w => { const c = clean(w); if (c.length >= 2 && !SKIP.has(c)) poolSet.add(c); }));
  const pool = [...poolSet];
  return picked.map(sentence => {
    const wordArr = sentence.split(/\s+/).filter(Boolean);
    let blanks = [];
    const seen = new Set();
    wordArr.forEach((w, i) => {
      const c = clean(w);
      if (c.length >= 2 && !SKIP.has(c) && !seen.has(c)) { seen.add(c); blanks.push(i); } // 같은 단어 중복 빈칸 방지
    });
    if (blanks.length === 0 && wordArr.length) blanks = [0];
    // 힌트(보여주는 단어)가 정답(빈칸)보다 많도록 빈칸 수 제한
    const maxBlanks = Math.max(1, Math.min(3, Math.floor((wordArr.length - 1) / 2)));
    blanks = shuffle(blanks).slice(0, maxBlanks).sort((a, b) => a - b);
    return { sentence, wordArr, blanks, pool };
  });
}

export default function SlingshotGame({ sentences = [], recentWords = [], speak, onClose, onClear }) {
  const [rounds, setRounds] = useState(() => buildRounds(sentences));
  const [roundIdx, setRoundIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [curBlank, setCurBlank] = useState(0);
  const [choices, setChoices] = useState([]);   // 오른쪽 보기 [{id,text,correct,x,y,w,h}]
  const [status, setStatus] = useState('ready'); // ready | clear
  const [wrongId, setWrongId] = useState(null);
  const [correctId, setCorrectId] = useState(null); // 정답 맞춘 과녁 (초록 이펙트)
  const [flyWord, setFlyWord] = useState(null);     // 과녁→문장 빈칸으로 날아가는 단어
  const [stones, setStones] = useState(0);          // 남은 돌 (빈칸 수 + 1)
  const [idleNudge, setIdleNudge] = useState(false); // 한동안 터치 없음 → 돌 흔들기 유도
  const [birds, setBirds] = useState(() => [makeBird(), makeBird(), makeBird(), makeBird(), makeBird(), makeBird()]); // 배경 새 6마리 (맞으면 낙하)
  const birdsRef = useRef([]);
  birdsRef.current = birds;
  const birdEls = useRef({});
  const hitBirdsRef = useRef(new Set()); // 한 발에 같은 새 중복 피격 방지
  const [needRefill, setNeedRefill] = useState(false); // 돌 소진 → 듣고 충전 패널
  const [refillBusy, setRefillBusy] = useState(0);   // 충전 듣기 중 (목표 횟수)
  const [refillProg, setRefillProg] = useState(0);
  const stonesRef = useRef(0);
  stonesRef.current = stones;
  const statusRef = useRef('ready');
  statusRef.current = status;
  const needRefillRef = useRef(false);
  needRefillRef.current = needRefill;
  const lastActionRef = useRef(0); // 마지막 조작 시각 (유도 효과 타이머)

  const round = rounds[roundIdx] || { sentence: '', wordArr: [], blanks: [], pool: [] };
  const { wordArr, blanks, pool } = round;

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ballRef = useRef(null);
  const anchorRef = useRef({ x: 80, y: 250 });   // 새총 위치
  const aimRef = useRef(null);   // { bx, by }  (현재 공 위치)
  const flyRef = useRef(null);   // { x, y, vx, vy }
  const rafRef = useRef(null);
  const bandRafRef = useRef(null);   // 끈 복귀 애니메이션
  const transitRef = useRef(false);  // 정답 연출 중 (조준 잠금)
  const targetBlankRef = useRef(null); // 현재 빈칸 span (날아갈 목적지 측정용)
  const curBlankRef = useRef(0);
  curBlankRef.current = curBlank;

  const correctFor = (bi) => clean(wordArr[blanks[bi]]);

  // 오른쪽 보기 단어 배치 (문장당 한 세트: 모든 빈칸 정답 + 오답) — 세로 컬럼
  const makeChoices = useCallback((r) => {
    const c = containerRef.current;
    const W = c ? c.clientWidth : 700;
    const H = c ? c.clientHeight : 460;
    const answers = (r.blanks || []).map(i => clean(r.wordArr[i]));
    const answerSet = new Set(answers);
    // 오답 풀 = 최근 학습 단어 + 레슨 문장 단어
    const combined = [...new Set([...(recentWords || []).map(clean), ...(r.pool || [])])]
      .filter(p => p && p.length >= 2 && !SKIP.has(p) && !answerSet.has(p));
    const total = Math.min(6, answers.length + 3); // 정답들 + 오답 3개 (최대 6)
    const distractors = shuffle(combined).slice(0, total - answers.length);
    while (answers.length + distractors.length < total) {
      const f = FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
      if (!answerSet.has(f) && !distractors.includes(f)) distractors.push(f);
    }
    const items = shuffle([...answers, ...distractors]);
    // 화면 크기에 맞춰 과녁 크기·간격 자동 조절 (폰~패드 호환, 겹침 방지)
    const narrow = W < 560;
    const cw = narrow ? 92 : 130;
    let ch = narrow ? 42 : 52;
    const margin = narrow ? 10 : 24;
    const x = W - cw - margin;
    const top = H * 0.16, bottom = H * 0.94;
    const avail = bottom - top;
    // 세로 공간이 부족하면 과녁 높이를 줄여서라도 겹치지 않게
    const maxCh = Math.floor((avail - (items.length - 1) * 8) / items.length);
    ch = Math.max(32, Math.min(ch, maxCh));
    const step = items.length > 1 ? (avail - ch) / (items.length - 1) : 0;
    return items.map((text, idx) => ({
      id: 'c' + idx + '_' + Math.random().toString(36).slice(2, 7),
      text,
      x: Math.round(x), y: Math.round(top + step * idx), w: cw, h: ch,
    }));
  }, [recentWords]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAnchor = () => {
    const c = containerRef.current; if (!c) return;
    // 화면 폭에 비례 (폰~패드 호환): 22%, 최소 90px ~ 최대 260px
    const x = Math.round(Math.min(Math.max(90, c.clientWidth * 0.22), 260));
    anchorRef.current = { x, y: Math.round(c.clientHeight * 0.52) };
  };

  const clearCanvas = () => { const cv = canvasRef.current; if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); };

  // 새총 몸통 그리기 (Y자) — 갈래 끝 좌표와 끈이 정확히 정렬됨
  const drawSlingshotBody = (ctx) => {
    const a = anchorRef.current;
    const baseY = a.y + 74;        // 손잡이 아래
    const forkY = a.y - 26;        // 갈래 끝 높이
    const fL = a.x - 26, fR = a.x + 26;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a4a1e';
    ctx.lineWidth = 14;
    // 손잡이
    ctx.beginPath(); ctx.moveTo(a.x, baseY); ctx.lineTo(a.x, a.y + 18); ctx.stroke();
    // 갈래 2개
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 18); ctx.lineTo(fL, forkY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 18); ctx.lineTo(fR, forkY); ctx.stroke();
    return { fL, fR, forkY };
  };

  // 두 갈래 고무줄(입체감): 왼/오 갈래 끝에서 돌(bx,by)까지
  const drawBands = (bx, by) => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const { fL, fR, forkY } = drawSlingshotBody(ctx);
    ctx.lineCap = 'round';
    // 뒤쪽 끈 (어둡게)
    ctx.strokeStyle = '#6b4420'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fR, forkY); ctx.lineTo(bx, by); ctx.stroke();
    // 앞쪽 끈 (밝게)
    ctx.strokeStyle = '#b07a3c'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fL, forkY); ctx.lineTo(bx, by); ctx.stroke();
  };
  // 대기 상태: 공이 새총에 얹혀있는 느슨한 두 줄
  const drawRest = () => {
    if (!startedRef.current) { clearCanvas(); return; } // ref 사용(오래된 클로저 방지)
    const a = anchorRef.current;
    drawBands(a.x, a.y);
  };

  const resetBall = () => {
    const el = ballRef.current; if (el) el.style.transform = 'translate3d(0,0,0)';
    aimRef.current = null; flyRef.current = null;
    if (!bandRafRef.current) drawRest(); // 끈 복귀 중이면 애니메이션이 캔버스 담당
  };

  // 끈 복귀 애니메이션: 놓은 지점 → 새총으로 감쇠 진동하며 서서히 복귀
  const animateBandBack = (fromX, fromY) => {
    const a = anchorRef.current;
    const start = performance.now();
    const dur = 350;
    if (bandRafRef.current) cancelAnimationFrame(bandRafRef.current);
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const k = Math.exp(-5 * t) * Math.cos(12 * t); // 튕기는 느낌
      drawBands(a.x + (fromX - a.x) * k, a.y + (fromY - a.y) * k);
      if (t < 1) bandRafRef.current = requestAnimationFrame(step);
      else { bandRafRef.current = null; drawRest(); }
    };
    bandRafRef.current = requestAnimationFrame(step);
  };
  const endRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  const startedRef = useRef(false);
  const startTimeRef = useRef(0);
  const introRef = useRef(false); // 문장 들려주는 동안 새총 잠금
  const clearedRef = useRef(false); // 클리어 기록 1회 보장

  // 문장 시작: 한 번 들려준 뒤 컨트롤 허용
  const playIntro = async (r) => {
    if (closedRef.current) return;
    introRef.current = true;
    try { if (speak && r && r.sentence) await speak(r.sentence); } catch (e) { /* */ }
    introRef.current = false;
    lastActionRef.current = performance.now(); // 인트로 끝 → 유도 타이머 시작
  };

  // 한동안 터치가 없으면 돌 흔들기 + 터치 유도 효과
  useEffect(() => {
    const iv = setInterval(() => {
      const ok = startedRef.current && statusRef.current === 'ready'
        && !flyRef.current && !aimRef.current && !transitRef.current && !introRef.current
        && !needRefillRef.current && stonesRef.current > 0
        && performance.now() - lastActionRef.current > 5000;
      setIdleNudge(prev => (prev === ok ? prev : ok));
    }, 600);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = () => {
    setAnchor();
    sgKeepAwake(); // 시작 제스처로 오디오 상시 가동
    startedRef.current = true;
    clearedRef.current = false;
    closedRef.current = false;
    startTimeRef.current = performance.now();
    setStarted(true); setRoundIdx(0); setCurBlank(0); setStatus('ready'); setChoices(makeChoices(rounds[0]));
    setStones((rounds[0]?.blanks?.length || 1) + 1); setNeedRefill(false);
    playIntro(rounds[0]);
  };
  const newRound = () => { startedRef.current = false; setRounds(buildRounds(sentences)); setRoundIdx(0); setStarted(false); setCurBlank(0); setStatus('ready'); setChoices([]); };

  // 재생 중인 모든 음성 정지
  const closedRef = useRef(false); // 닫힘 후 예약된 재생(인트로/충전듣기/완성읽기) 차단
  const stopAllAudio = () => {
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
  };

  // 나가기: 음성 정지 후 종료
  const handleClose = () => {
    closedRef.current = true;
    endRaf();
    if (bandRafRef.current) cancelAnimationFrame(bandRafRef.current);
    stopAllAudio();
    if (onClose) onClose();
  };

  useEffect(() => { sgLoadSample('leather'); sgLoadSample('stone-fly'); }, []); // 효과음 미리 로드

  useEffect(() => () => {
    closedRef.current = true;
    endRaf();
    if (bandRafRef.current) cancelAnimationFrame(bandRafRef.current);
    sgStopStretch();
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
  }, []);
  useEffect(() => {
    const cv = canvasRef.current, c = containerRef.current;
    if (cv && c) {
      // 고해상도(레티나) 대응 — 새총·끈이 선명하게
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(c.clientWidth * dpr);
      cv.height = Math.round(c.clientHeight * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (started) { setAnchor(); drawRest(); }
  }, [started, choices]); // eslint-disable-line react-hooks/exhaustive-deps

  const rel = (e) => { const r = containerRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onDown = (e) => {
    if (!startedRef.current || status !== 'ready' || flyRef.current || transitRef.current) return; // 시작 전/연출 중엔 무시
    if (introRef.current) return; // 문장 들려주는 중엔 잠금
    if (stonesRef.current <= 0 || needRefill || refillBusy) return; // 돌 없으면 발사 불가
    if (bandRafRef.current) { cancelAnimationFrame(bandRafRef.current); bandRafRef.current = null; } // 끈 복귀 중이면 중단
    if (performance.now() - startTimeRef.current < 350) return;              // 시작 직후 잔여 터치 무시
    const p = rel(e);
    const a = anchorRef.current;
    // 새총 근처(왼쪽)에서만 조준 시작
    if (p.x > (containerRef.current.clientWidth * 0.6)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastActionRef.current = performance.now();
    setIdleNudge(false);
    sgKeepAwake(); // 오디오 상시 가동
    aimRef.current = { bx: a.x, by: a.y };
    sgPlayStretch(); // 새총 당기는 소리 (가죽)
    onMove(e);
  };

  const drawAim = () => {
    const a = anchorRef.current; const b = aimRef.current; const cv = canvasRef.current; if (!b || !cv) return;
    drawBands(b.bx, b.by); // 두 갈래 끈 (clear 포함)
    const ctx = cv.getContext('2d');
    // 예상 궤적
    let vx = (a.x - b.bx) * POWER, vy = (a.y - b.by) * POWER;
    let x = b.bx, y = b.by;
    ctx.fillStyle = 'rgba(90,110,150,0.6)';
    for (let i = 0; i < 30; i++) {
      x += vx; y += vy; vy += GRAV;
      if (i % 2 === 0) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
      if (x > cv.width + 40 || y > cv.height + 40) break;
    }
  };

  const onMove = (e) => {
    const b = aimRef.current; if (!b) return;
    const a = anchorRef.current;
    const p = rel(e);
    let dx = p.x - a.x, dy = p.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) { dx = dx / d * MAX_PULL; dy = dy / d * MAX_PULL; }
    b.bx = a.x + dx; b.by = a.y + dy;
    const el = ballRef.current;
    if (el) el.style.transform = `translate3d(${b.bx - a.x}px, ${b.by - a.y}px, 0)`;
    drawAim();
  };

  const measureChoices = () => {
    const c = containerRef.current; if (!c) return [];
    const cr = c.getBoundingClientRect();
    return choices.map(ch => {
      const el = choiceEls.current[ch.id];
      if (!el) return ch;
      const r = el.getBoundingClientRect();
      return { ...ch, x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    });
  };
  const choiceEls = useRef({});

  const flyLoop = () => {
    const f = flyRef.current; const c = containerRef.current; if (!f || !c) return;
    const W = c.clientWidth, H = c.clientHeight;
    const a = anchorRef.current;
    f.x += f.vx; f.y += f.vy; f.vy += GRAV;
    f.maxD = Math.max(f.maxD || 0, Math.hypot(f.x - a.x, f.y - a.y)); // 최대 비행 거리 (근접 낙하 판정용)
    const el = ballRef.current;
    if (el) el.style.transform = `translate3d(${f.x - a.x}px, ${f.y - a.y}px, 0)`;

    // 배경 새 피격 (재미 요소 — 돌은 계속 날아감)
    const crB = c.getBoundingClientRect();
    for (const b of birdsRef.current) {
      if (b.falling || hitBirdsRef.current.has(b.id)) continue;
      const bel = birdEls.current[b.id]; if (!bel) continue;
      const r = bel.getBoundingClientRect();
      const bx = r.left - crB.left, by = r.top - crB.top;
      if (f.x > bx - 10 && f.x < bx + r.width + 10 && f.y > by - 10 && f.y < by + r.height + 10) {
        hitBirdsRef.current.add(b.id);
        sfxChirp();
        setBirds(prev => prev.map(pb => pb.id === b.id ? { ...pb, falling: true, x: bx, y: by } : pb));
        setTimeout(() => { setBirds(prev => prev.map(pb => pb.id === b.id ? makeBird() : pb)); }, 2600); // 잠시 후 새 리스폰
      }
    }

    for (const t of f.targets) {
      if (f.x >= t.x - HIT_PAD && f.x <= t.x + t.w + HIT_PAD && f.y >= t.y - HIT_PAD && f.y <= t.y + t.h + HIT_PAD) {
        flyRef.current = null; endRaf(); resetBall();
        const isCorrect = clean(t.text) === correctFor(curBlankRef.current);
        if (isCorrect) {
          // 초록 이펙트 + 단어가 문장 빈칸으로 날아가는 연출
          transitRef.current = true;
          sfxHit(); // 정답 차임 (즉시 재생)
          setCorrectId(t.id);
          const c2 = containerRef.current;
          const blankEl = targetBlankRef.current;
          if (c2 && blankEl) {
            const cr = c2.getBoundingClientRect();
            const br = blankEl.getBoundingClientRect();
            setFlyWord({
              id: Date.now(), text: t.text,
              from: { x: t.x + t.w / 2, y: t.y + t.h / 2 },
              to: { x: br.left - cr.left + br.width / 2, y: br.top - cr.top + br.height / 2 },
            });
          }
          setTimeout(async () => {
            if (closedRef.current) return; // 닫혔으면 후속 재생/진행 중단
            setCorrectId(null); setFlyWord(null);
            setChoices(prev => prev.filter(c3 => c3.id !== t.id)); // 맞춘 단어 과녁 제거 (나머지는 유지)
            const next = curBlankRef.current + 1;
            if (next >= blanks.length) {
              // 이 문장 완성: 빈칸 채운 모습 + 남은 단어 유지한 채 → 문장 전체 읽기 → 1초 쉬고 다음 문장
              setCurBlank(next);
              if (speak) { try { await speak(round.sentence); } catch (e) { /* */ } }
              await new Promise(r => setTimeout(r, 1000));
              if (closedRef.current) return;
              transitRef.current = false;
              const nr = roundIdx + 1;
              if (nr >= rounds.length) {
                setStatus('clear'); setChoices([]);
                if (!clearedRef.current) { clearedRef.current = true; if (onClear) onClear(); } // 전체 클리어 기록 (1회)
              }
              else {
                setRoundIdx(nr); setCurBlank(0); setChoices(makeChoices(rounds[nr])); // 다음 문장: 전부 새로
                setStones((rounds[nr].blanks.length || 1) + 1); setNeedRefill(false); // 돌 충전
                playIntro(rounds[nr]); // 새 문장 한 번 들려준 뒤 컨트롤 허용
              }
            } else {
              transitRef.current = false;
              if (speak) { try { speak(correctFor(curBlankRef.current)); } catch (e) { /* */ } }
              setCurBlank(next); // 남은 과녁 그대로, 다음 빈칸으로
              if (stonesRef.current <= 0) setNeedRefill(true); // 돌 없이 남은 빈칸 → 충전 필요
            }
          }, 800);
        } else {
          sfxMiss(); // 오답 버저
          setWrongId(t.id);
          // 남은 빈칸의 정답이 아닌 순수 오답이면 과녁에서 영구 제거 (다시 안 생김)
          const remainingAnswers = blanks.slice(curBlankRef.current).map(i => clean(wordArr[i]));
          const pureWrong = !remainingAnswers.includes(clean(t.text));
          setTimeout(() => {
            setWrongId(null);
            if (pureWrong) setChoices(prev => prev.filter(c3 => c3.id !== t.id));
          }, 500);
          if (stonesRef.current <= 0) setNeedRefill(true); // 돌 소진
        }
        return;
      }
    }
    if (f.x > W + 80 || f.y > H + 80 || f.x < -120) {
      const weak = (f.maxD || 0) < 190; // 새총 바로 근처에 떨어진 실수 발사만 (반경 축소)
      flyRef.current = null; endRaf(); resetBall();
      if (weak) setStones(s => s + 1); // 돌 반환
      else if (stonesRef.current <= 0) setNeedRefill(true); // 빗나가고 돌 소진
      return;
    }
    rafRef.current = requestAnimationFrame(flyLoop);
  };

  const onUp = () => {
    sgStopStretch(); // 놓는 순간 당김 소리 정지
    const b = aimRef.current; const a = anchorRef.current;
    aimRef.current = null;
    lastActionRef.current = performance.now();
    if (!b) return;
    animateBandBack(b.bx, b.by); // 새총·끈은 유지한 채 서서히 복귀
    if (Math.hypot(a.x - b.bx, a.y - b.by) < 14) { resetBall(); return; } // 살짝만 당기면 취소
    if (a.x - b.bx <= 0) { resetBall(); return; } // 왼쪽으로 발사(오른쪽으로 당김) → 무효, 돌 소모 없음
    sgPlayOnce('stone-fly'); // 돌 날아가는 소리
    setStones(s => Math.max(0, s - 1)); // 발사 = 돌 1개 소모 (새총 근처에 떨어지면 반환)
    hitBirdsRef.current.clear();
    flyRef.current = { x: b.bx, y: b.by, vx: (a.x - b.bx) * POWER, vy: (a.y - b.by) * POWER, targets: measureChoices() };
    endRaf();
    rafRef.current = requestAnimationFrame(flyLoop);
  };

  // 돌 충전: 문장을 N번 듣고 돌 받기
  const earnStones = async (times, grant) => {
    if (refillBusy) return;
    setRefillBusy(times); setRefillProg(0);
    const refillWord = wordArr[blanks[curBlankRef.current]] || round.sentence; // 문장이 아닌 현재 빈칸 단어
    for (let i = 0; i < times; i++) {
      if (closedRef.current) return; // 닫혔으면 중단
      setRefillProg(i + 1);
      if (speak) { try { await speak(refillWord); } catch (e) { /* */ } }
      if (i < times - 1) await new Promise(r => setTimeout(r, 400));
    }
    if (closedRef.current) return;
    setStones(s => s + grant);
    setNeedRefill(false);
    setRefillBusy(0); setRefillProg(0);
  };

  const anchor = anchorRef.current;

  return (
    <div className="sg-root">
      <div className="sg-area" ref={containerRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <button className="sg-close" onPointerDown={(e) => e.stopPropagation()} onClick={handleClose}>✕ 나가기</button>
        {/* 배경: 구름·새 애니메이션 */}
        <div className="sg-sky" aria-hidden="true">
          <span className="sg-cloud sg-c1">☁️</span>
          <span className="sg-cloud sg-c2">☁️</span>
          <span className="sg-cloud sg-c3">☁️</span>
          <span className="sg-cloud sg-c4">☁️</span>
          {birds.map(b => b.falling ? (
            <span key={b.id} className="sg-bird sg-bird-fall" style={{ left: b.x, top: b.y, fontSize: b.size }}>{b.emoji}</span>
          ) : (
            <span key={b.id}
              ref={el => { birdEls.current[b.id] = el; }}
              className="sg-bird sg-bird-flying"
              style={{ top: b.top, fontSize: b.size, animationDuration: b.dur + 's', animationDelay: b.delay + 's' }}>
              {b.emoji}
            </span>
          ))}
        </div>
        <canvas ref={canvasRef} className="sg-canvas" />

        {/* 목표 문장 (중앙 상단) + 듣기 (보드 밖) */}
        <div className="sg-board-row">
          {rounds.length > 0 && <span className="sg-round-num">{Math.min(roundIdx + 1, rounds.length)}/{rounds.length}</span>}
          <div className="sg-board">
            {wordArr.map((w, i) => {
              const bi = blanks.indexOf(i);
              if (bi === -1) return <span key={i} className="sg-word">{w}</span>;
              const got = bi < curBlank;
              return (
                <span key={i}
                  ref={bi === curBlank ? targetBlankRef : null}
                  className={`sg-blank ${got ? 'filled' : ''} ${bi === curBlank ? 'target' : ''}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!got && speak) { try { speak(clean(w)); } catch (err) { /* */ } } // ? 누르면 그 자리 정답 단어 듣기
                  }}>
                  {got ? w : '?'}
                </span>
              );
            })}
          </div>
          {round.sentence && (
            <button className="sg-listen"
              onPointerDown={(e) => e.stopPropagation()} /* 듣기 터치가 새총 발사로 이어지지 않게 */
              onClick={(e) => { e.stopPropagation(); if (speak) { try { speak(round.sentence); } catch (e2) { /* */ } } }}>
              🔊 듣기
            </button>
          )}
        </div>

        {/* 왼쪽 새총(캔버스에 그림) + 돌 */}
        {started && status === 'ready' && (
          <>
            {idleNudge && (
              <>
                <div className="sg-touch-ring" style={{ left: anchor.x, top: anchor.y }} />
                <div className="sg-touch-hand" style={{ left: anchor.x - 66, top: anchor.y + 22 }}>👆</div>
              </>
            )}
            <div className={`sg-ball ${idleNudge ? 'nudge' : ''}`} ref={ballRef}
              style={{ left: anchor.x - BALL / 2, top: anchor.y - BALL / 2, width: BALL, height: BALL }}>🪨</div>
          </>
        )}

        {/* 오른쪽 보기 단어 과녁 */}
        {started && status === 'ready' && choices.map((ch, idx) => (
          <div key={ch.id}
            ref={el => { choiceEls.current[ch.id] = el; }}
            className={`sg-target ${wrongId === ch.id ? 'wrong' : ''} ${correctId === ch.id ? 'hit' : ''}`}
            style={{ left: ch.x, top: ch.y, width: ch.w, height: ch.h, animationDelay: (wrongId === ch.id || correctId === ch.id) ? '0s' : `${idx * 0.12}s` }}>
            {ch.text}
          </div>
        ))}

        {/* 남은 돌 (왼쪽 하단) */}
        {started && status === 'ready' && (
          <div className="sg-stones">
            {stones > 0
              ? Array.from({ length: stones }).map((_, i) => <span key={i} className="sg-stone">🪨</span>)
              : <span className="sg-stone-empty">돌이 없어요!</span>}
          </div>
        )}

        {/* 하단 안내 (느린 깜빡임) */}
        {started && status === 'ready' && !needRefill && (
          <div className="sg-guide">
            {/* 미니 새총 아이콘 (이모지 없음 → SVG) */}
            <svg className="sg-guide-icon" viewBox="0 0 24 28" width="18" height="21" aria-hidden="true">
              <path d="M12 27 L12 14 M12 14 L4 3 M12 14 L20 3" stroke="#8a5a2b" strokeWidth="4.5" strokeLinecap="round" fill="none" />
              <path d="M4 3 Q12 9 20 3" stroke="#d14848" strokeWidth="2" fill="none" />
              <circle cx="12" cy="7.5" r="2.6" fill="#7d7d7d" />
            </svg>
            {' '}돌을 쭉~ 당겼다 놓아 정답 단어를 맞혀요!
          </div>
        )}

        {/* 충전 듣기 중 — 화면 가운데 크게 (학습 보조) */}
        {refillBusy > 0 && round && (
          <div className="sg-bigword">{wordArr[blanks[curBlank]] || round.sentence}</div>
        )}

        {/* 돌 충전 패널 */}
        {needRefill && started && status === 'ready' && (
          <div className="sg-refill">
            <div className="sg-refill-title">🪨 돌이 다 떨어졌어요!</div>
            {refillBusy ? (
              <div className="sg-refill-busy">🔊 듣는 중... {refillProg}/{refillBusy}</div>
            ) : (
              <div className="sg-refill-btns">
                <button className="sg-btn start" onClick={() => earnStones(3, 1)}>🔊 3번 듣고 🪨 1개</button>
                <button className="sg-btn start" onClick={() => earnStones(5, 2)}>🔊 5번 듣고 🪨 2개</button>
              </div>
            )}
          </div>
        )}

        {/* 정답 단어가 문장 빈칸으로 날아가는 연출 */}
        {flyWord && (
          <div key={flyWord.id} className="sg-flyword"
            style={{ left: flyWord.from.x, top: flyWord.from.y }}
            ref={el => {
              if (el && !el.dataset.flying) {
                el.dataset.flying = '1';
                // 초기 위치가 확실히 그려진 뒤 목적지로 이동 (슬라이드 보장)
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  el.style.left = flyWord.to.x + 'px';
                  el.style.top = flyWord.to.y + 'px';
                  el.style.transform = 'translate(-50%, -50%) scale(0.7)';
                }));
              }
            }}>
            {flyWord.text}
          </div>
        )}

        {/* 오버레이 */}
        {!started && (
          <div className="sg-overlay">
            <div className="sg-title">🎯 단어 새총</div>
            {blanks.length === 0 || !round.sentence ? (
              <>
                <div className="sg-desc">문장이 없어요. 문장 학습에서 문장을 먼저 등록해 주세요!</div>
                <button className="sg-btn ghost" onClick={handleClose}>나가기</button>
              </>
            ) : (
              <>
                <div className="sg-desc">왼쪽 새총을 당겨서 오른쪽 <b>정답 단어</b>를 맞춰요!</div>
                <button className="sg-btn start" onClick={startGame}>▶ 시작</button>
              </>
            )}
          </div>
        )}
        {status === 'clear' && (
          <div className="sg-overlay">
            <FireworksCelebration size={120} />
            <div className="sg-title">🎉 {rounds.length}문장 모두 완성!</div>
            <div className="sg-cleared">{round.sentence}</div>
            <div className="sg-btn-row">
              <button className="sg-btn start" onClick={newRound}>↺ 한 판 더</button>
              <button className="sg-btn ghost" onClick={handleClose}>나가기</button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
