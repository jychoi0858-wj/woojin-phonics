import React, { useState, useRef, useEffect, useCallback } from 'react';
import FireworksCelebration from './FireworksCelebration';
import { stopCachedAudio } from './ttsCache';
import './SliceGame.css';

// 🥷 단어 베기 (과일 닌자 스타일) — 8세용
// 아래에서 튀어 오르는 단어 중 "목표 단어"를 스와이프로 베기. 과일은 재미용(콤보).
// props: words[](목표 단어들), allWords[](오답 풀), speak(text), onClose()
const GRAV = 0.155;          // 오브젝트 중력 (프레임당)
const SPAWN_MS = 950;        // 스폰 주기
const MAX_TARGETS = 5;       // 한 판 목표 단어 수 (5개 고정 → 하트 6개)
const FRUITS = ['🍎', '🍌', '🍉', '🍊', '🍑'];
const JUICE = { '🍎': '#e74c3c', '🍌': '#f4d03f', '🍉': '#2ecc71', '🍊': '#e67e22', '🍑': '#ffb3a7' };
const FALLBACK = ['dog', 'cat', 'sun', 'run', 'big', 'red', 'box', 'cup', 'hat', 'bus'];

const clean = (w) => (w || '').replace(/[^a-zA-Z' ]/g, '').toLowerCase().trim();
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const SKIP = new Set(['a', 'i', 'an', 'the', 'is', 'am', 'to', 'of', 'it', 'in', 'on', 'no', 'so', 'at', 'or', 'do', 'be', 'my', 'me', 'he', 'we', 'up', 'if', 'as']);

// 문장 모드 계획: 문장 5개 → 빈칸 목록(steps) + 라운드 정보
function buildSentencePlan(sentences) {
  const list = (sentences || []).map(s => (typeof s === 'string' ? s : s?.text) || '').filter(Boolean);
  const usable = shuffle([...new Set(list)]).slice(0, 5);
  const rounds = []; const steps = [];
  usable.forEach((sentence, r) => {
    const wordArr = sentence.split(/\s+/).filter(Boolean);
    let blanks = []; const seen = new Set();
    wordArr.forEach((w, i) => {
      const c = clean(w);
      if (c.length >= 2 && !SKIP.has(c) && !seen.has(c)) { seen.add(c); blanks.push(i); }
    });
    if (!blanks.length && wordArr.length) blanks = [0];
    const maxB = Math.max(1, Math.min(3, Math.floor((wordArr.length - 1) / 2))); // 힌트 단어 > 빈칸
    blanks = shuffle(blanks).slice(0, maxB).sort((x, y) => x - y);
    rounds.push({ sentence, wordArr, blanks });
    blanks.forEach((wi, bi) => steps.push({ word: clean(wordArr[wi]), r, wi, bi }));
  });
  return { steps, rounds };
}

// 힌트 글자 공개: 재생 5회마다 1글자
function maskWord(w, hintN) {
  return w.split('').map((ch, i) => (ch === ' ' ? ' ' : (i < hintN ? ch : '_'))).join(' ');
}

// ─── 효과음 ───
let _ctx = null;
function actx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); // 저지연
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// 오디오 엔진 상시 가동: 무음 루프 재생 → 안드로이드가 엔진을 재우지 않아 첫 소리 지연 제거
let _kaOn = false;
function keepAudioAwake() {
  if (_kaOn) return;
  try {
    const c = actx();
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate); // 1초 무음
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(c.destination);
    src.start();
    _kaOn = true;
  } catch (e) { /* */ }
}

// 디코딩된 버퍼의 앞 무음 제거 (mp3 인코더 패딩까지 제거 → 즉시 발음)
function trimLead(b) {
  try {
    const c = actx();
    const d = b.getChannelData(0);
    let i = 0; const th = 0.03; // 어택을 더 공격적으로 트림 → 즉각적인 타격감
    while (i < d.length && Math.abs(d[i]) < th) i++;
    if (i < c.sampleRate * 0.003 || i >= d.length) return b; // 3ms 미만이면 그대로
    const nb = c.createBuffer(b.numberOfChannels, b.length - i, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) nb.getChannelData(ch).set(b.getChannelData(ch).subarray(i));
    return nb;
  } catch (e) { return b; }
}
function tone(freq, dur, type = 'sine', vol = 0.25, delayMs = 0) {
  try {
    const c = actx(); const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + delayMs / 1000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* */ }
}
const sfxGood = () => { tone(660, 0.12, 'sine', 0.28); tone(880, 0.12, 'sine', 0.28, 90); tone(1175, 0.2, 'sine', 0.3, 180); }; // 또로롱
const sfxBad = () => { tone(180, 0.22, 'square', 0.18); tone(140, 0.26, 'square', 0.13, 120); };
// 철퍼덕(splat): 낮은 퍽 + 부드러운 저역 퍼짐 + 물방울
function sfxSplat() {
  try {
    const c = actx();
    const t0 = c.currentTime;
    // 퍽 (낮은 타격)
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(55, t0 + 0.14);
    const og = c.createGain();
    og.gain.setValueAtTime(0.5, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(og); og.connect(c.destination);
    o.start(t0); o.stop(t0 + 0.18);
    // 질퍽한 퍼짐 (저역만 남긴 부드러운 노이즈)
    const dur = 0.24;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(800, t0);
    lp.frequency.exponentialRampToValueAtTime(220, t0 + dur);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.32, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(lp); lp.connect(ng); ng.connect(c.destination);
    src.start(t0);
    // 튀는 물방울 2개
    tone(420, 0.07, 'sine', 0.14, 130, 0);
    tone(330, 0.08, 'sine', 0.12, 220, 0);
  } catch (e) { /* */ }
}

// ─── 실제 녹음 파일 지원: public/sounds/{poop,slice,star}.mp3 있으면 그걸 재생 ───
const SAMPLES = {};
function loadSample(name) {
  try {
    fetch((process.env.PUBLIC_URL || '') + '/sounds/' + name + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => { if (ab) actx().decodeAudioData(ab).then(b => { SAMPLES[name] = trimLead(b); }).catch(() => {}); })
      .catch(() => {});
  } catch (e) { /* */ }
}
function playSample(name, vol = 1) {
  const b = SAMPLES[name];
  if (!b) return false;
  try {
    const c = actx();
    const src = c.createBufferSource(); src.buffer = b;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(c.destination);
    src.start();
    return true;
  } catch (e) { return false; }
}
const sfxSparkle = () => { // 반짝 (하프 상승, 빠르게)
  [1046, 1318, 1760, 2093, 2637].forEach((f, i) => tone(f, 0.16, 'triangle', 0.16, i * 35));
  tone(2637, 0.22, 'sine', 0.08, 200);
};
// 칼로 베는 소리: 노이즈 스위시(고→저 대역 스윕)
function sfxSlice() {
  try {
    const c = actx();
    const dur = 0.2;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(3800, c.currentTime);
    bp.frequency.exponentialRampToValueAtTime(600, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.4, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start();
  } catch (e) { /* */ }
}

export default function SliceGame({ words = [], sentences = [], mode = 'word', allWords = [], speak, onClose, onClear }) {
  // 단어 모드: 단어 5개 = steps / 문장 모드: 문장 5개의 빈칸들 = steps
  const [plan] = useState(() => {
    if (mode === 'sentence') return buildSentencePlan(sentences);
    const t = shuffle([...new Set(words.map(clean).filter(w => w && w.length >= 2))]).slice(0, MAX_TARGETS);
    return { steps: t.map(w => ({ word: w })), rounds: null };
  });
  const steps = plan.steps;
  const sRounds = plan.rounds;
  const targets = steps.map(s => s.word);
  const clearedOnceRef = useRef(false); // 클리어 기록 1회 (메달 연동)
  const [ti, setTi] = useState(0);          // 현재 목표 인덱스
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [status, setStatus] = useState('ready'); // ready | play | clear
  const [objects, setObjects] = useState([]);    // 렌더 목록 {id,type,text}
  const [pieces, setPieces] = useState([]);      // 절단 조각
  const [flash, setFlash] = useState(false);     // 오답 플래시
  const [lives, setLives] = useState(0);         // 생명 (단어 수 + 1)
  const [needRefill, setNeedRefill] = useState(false); // 생명 소진 → 듣고 충전
  const [refillBusy, setRefillBusy] = useState(0);
  const [refillProg, setRefillProg] = useState(0);
  const needRefillRef = useRef(false); needRefillRef.current = needRefill;
  const [voicePaused, setVoicePaused] = useState(false); // 목표 단어 반복 재생 멈춤
  const [playCount, setPlayCount] = useState(0); // 현재 목표 단어 재생 횟수 (5회마다 힌트 1글자)
  const voicePausedRef = useRef(false); voicePausedRef.current = voicePaused;
  const refillBusyRef = useRef(0); refillBusyRef.current = refillBusy;

  const target = targets[ti] || '';
  const hintN = Math.floor(playCount / 3); // 3회 재생마다 힌트 1글자
  const [reveal, setReveal] = useState(false); // 정답 직후 풀네임/초록 공개
  const tiRef = useRef(0); tiRef.current = ti;
  const statusRef = useRef('ready'); statusRef.current = status;
  const closedRef = useRef(false);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const elsRef = useRef({});
  const physRef = useRef({});   // id → {x,y,vx,vy,rot,vr,w,h,sliced,type,text}
  const rafRef = useRef(null);
  const spawnRef = useRef(null);
  const trailRef = useRef([]);   // 스와이프 궤적 [{x,y,t}]
  const partsRef = useRef([]);   // 과즙 파티클
  const downRef = useRef(false);
  const idRef = useRef(0);
  const sinceTargetRef = useRef(0); // 목표 단어가 안 나온 연속 단어 스폰 수 (3 넘으면 강제 등장)

  // 오답 풀
  const distractorPool = useCallback(() => {
    const tset = new Set(targets);
    const pool = [...new Set(allWords.map(clean))].filter(w => w && w.length >= 2 && !tset.has(w));
    return pool.length ? pool : FALLBACK;
  }, [allWords, targets]);

  const stopAll = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (spawnRef.current) { clearInterval(spawnRef.current); spawnRef.current = null; }
    if (speedTimerRef.current) { clearTimeout(speedTimerRef.current); speedTimerRef.current = null; }
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
  };
  const handleClose = () => { closedRef.current = true; stopAll(); if (onClose) onClose(); };
  useEffect(() => () => { closedRef.current = true; stopAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 녹음 효과음(mp3) 미리 로드 — 없으면 합성음 폴백
  useEffect(() => { ['poop', 'slice', 'star', 'fruit'].forEach(loadSample); }, []);


  // 캔버스 DPR
  useEffect(() => {
    const cv = canvasRef.current, c = containerRef.current;
    if (cv && c) {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(c.clientWidth * dpr);
      cv.height = Math.round(c.clientHeight * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, [status]);

  // ─── 스폰 ───
  const spawnOne = useCallback(() => {
    if (document.hidden) return; // 화면 꺼짐/백그라운드 중엔 스폰 안 함
    const c = containerRef.current; if (!c || statusRef.current !== 'play' || needRefillRef.current) return;
    const W = c.clientWidth, H = c.clientHeight;
    const id = 'o' + (++idRef.current);
    let type, text;
    const roll = Math.random();
    if (roll < 0.045) { type = 'poop'; text = '💩'; }        // 희귀: 똥 (~4.5%)
    else if (roll < 0.09) { type = 'star'; text = '🌟'; }    // 희귀: 황금별 (~4.5%)
    else if (roll < 0.45) { type = 'fruit'; text = FRUITS[Math.floor(Math.random() * FRUITS.length)]; }
    else {
      type = 'word';
      const cur = targets[tiRef.current];
      // 랜덤이되, 목표 단어가 너무 안 나오지 않게 보장:
      // 단어 3번 연속 오답만 나오면 4번째는 반드시 목표 단어
      if (cur && sinceTargetRef.current >= 3) {
        text = cur;
      } else {
        const pool = shuffle(distractorPool()).slice(0, 3 + Math.floor(Math.random() * 5));
        const cand = cur ? [...pool, cur] : pool;
        text = cand[Math.floor(Math.random() * cand.length)] || cur;
      }
      sinceTargetRef.current = (text === cur) ? 0 : sinceTargetRef.current + 1;
    }
    const w = type === 'word' ? Math.max(78, text.length * 18 + 34) : (type === 'fruit' ? 80 : 68);
    const h = type === 'word' ? 56 : (type === 'fruit' ? 80 : 68);
    const x = W * (0.12 + Math.random() * 0.76);
    const peak = H * (0.15 + Math.random() * 0.22); // 정점을 더 위쪽으로
    const vy = -Math.sqrt(2 * GRAV * (H - peak));
    const vx = (W / 2 - x) * 0.0022 + (Math.random() - 0.5) * 1.2; // 살짝 중앙으로
    physRef.current[id] = { x, y: H + h, vx, vy, rot: 0, vr: (Math.random() - 0.5) * 2.2, w, h, sliced: false, type, text };
    setObjects(prev => [...prev, { id, type, text }]);
  }, [targets, distractorPool]);

  const removeObj = (id) => {
    delete physRef.current[id];
    delete elsRef.current[id];
    setObjects(prev => prev.filter(o => o.id !== id));
  };

  // ─── 절단 연출 (clip-path 두 조각 + 회전 낙하) ───
  const makePieces = (p, angleSnap) => {
    let clips;
    if (angleSnap === 'h') clips = ['polygon(0 0,100% 0,100% 50%,0 50%)', 'polygon(0 50%,100% 50%,100% 100%,0 100%)'];
    else if (angleSnap === 'v') clips = ['polygon(0 0,50% 0,50% 100%,0 100%)', 'polygon(50% 0,100% 0,100% 100%,50% 100%)'];
    else clips = ['polygon(0 0,100% 0,0 100%)', 'polygon(100% 0,100% 100%,0 100%)'];
    const base = { type: p.type, text: p.text, w: p.w, h: p.h, x: p.x, y: p.y, rot: p.rot };
    const mk = (clip, dir) => ({
      ...base,
      id: 'p' + (++idRef.current),
      clip,
      dx: dir * (14 + Math.random() * 26),
      spin: Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360),
    });
    const two = [mk(clips[0], -1), mk(clips[1], 1)];
    setPieces(prev => [...prev, ...two]);
    setTimeout(() => setPieces(prev => prev.filter(x => x.id !== two[0].id && x.id !== two[1].id)), 1000);
  };

  const juice = (x, y, color) => {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      partsRef.current.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, r: 3 + Math.random() * 4, color, life: 1 });
    }
  };

  // ─── 베기 판정 ───
  const transitRef = useRef(false); // 정답 후 다음 단어로 넘어가는 텀 (판정 잠금)

  // 속도 효과 (💩=5초 빠르게 / 🌟=5초 느리게)
  const speedRef = useRef(1);
  const speedTimerRef = useRef(null);
  const [effectLabel, setEffectLabel] = useState(null); // 'fast' | 'slow' | null
  const applySpeed = (mult, label) => {
    speedRef.current = mult;
    setEffectLabel(label);
    if (speedTimerRef.current) clearTimeout(speedTimerRef.current);
    speedTimerRef.current = setTimeout(() => { speedRef.current = 1; setEffectLabel(null); }, 5000);
  };

  // 목표 단어 자동 반복 재생 (2초 텀) — 멈춤 버튼으로 음성만 정지
  const loopTokenRef = useRef(0);
  useEffect(() => {
    if (status !== 'play') return;
    const token = ++loopTokenRef.current;
    let alive = true;
    (async () => {
      while (alive && token === loopTokenRef.current && !closedRef.current && statusRef.current === 'play') {
        const cur = targets[tiRef.current];
        // 생명 소진(충전 패널) 중엔 자동 재생·힌트 카운트 정지 — 3번/5번 듣기 버튼이 대신 재생
        if (cur && !voicePausedRef.current && !refillBusyRef.current && !needRefillRef.current && !transitRef.current && !document.hidden) {
          try { if (speak) await speak(cur); } catch (e) { /* */ }
          setPlayCount(c => c + 1); // 재생 횟수 → 힌트 공개
        }
        await new Promise(r => setTimeout(r, 2000)); // 2초 텀
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ti, status]);

  // 목표가 바뀌면 재생 횟수(힌트) 초기화 + 일시정지 해제(다음 단어/문장은 자동재생)
  useEffect(() => { setPlayCount(0); setVoicePaused(false); sinceTargetRef.current = 2; }, [ti]); // 새 목표는 빨리 등장하게(최대 1번 오답 뒤 보장)

  const toggleVoice = () => {
    setVoicePaused(p => {
      const np = !p;
      if (np) { try { stopCachedAudio(); } catch (e) { /* */ } try { window.speechSynthesis.cancel(); } catch (e) { /* */ } } // 재생 중인 음성 즉시 정지
      return np;
    });
  };

  const sliceObj = (id, angleSnap) => {
    const p = physRef.current[id];
    if (!p || p.sliced) return;
    p.sliced = true;
    if (!playSample('slice', 0.6)) sfxSlice(); // 칼 베기 소리 (mp3 있으면 그걸로)
    makePieces(p, angleSnap);
    if (p.type === 'poop') {
      juice(p.x, p.y, '#7a4e22');
      if (!playSample('poop')) sfxSplat(); // 철퍼덕! (mp3 있으면 그걸로)
      applySpeed(1.75, 'fast'); // 5초 동안 빨라짐
    } else if (p.type === 'star') {
      juice(p.x, p.y, '#ffd54a');
      if (!playSample('star')) sfxSparkle(); // 반짝✨
      applySpeed(0.5, 'slow'); // 5초 동안 느려짐
    } else if (p.type === 'fruit') {
      juice(p.x, p.y, JUICE[p.text] || '#ffb347');
      playSample('fruit', 0.63); // 과일 터지는 소리 (기존의 70%)
      setCombo(c => c + 1);
      setScore(s => s + 1);
    } else if (transitRef.current) {
      // 다음 단어로 넘어가는 텀 — 단어 판정 없음 (조각 연출만)
    } else if (p.text === targets[tiRef.current]) {
      sfxGood(); // 또로롱~ 정답 소리
      setScore(s => s + 5);
      setCombo(c => c + 1);
      transitRef.current = true;
      setReveal(true); // 힌트창/빈칸에 정답 공개
      const cur = tiRef.current;
      const next = cur + 1;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      (async () => {
        if (mode === 'sentence' && sRounds) {
          const st = steps[cur];
          const nx = steps[next];
          const lastOfSentence = st && (!nx || nx.r !== st.r);
          if (lastOfSentence) {
            await sleep(600); // 초록 정답 잠깐 보여주고
            if (closedRef.current) return;
            const rd = sRounds[st.r];
            if (speak && rd) { try { await speak(rd.sentence); } catch (e) { /* */ } } // 완성 문장 읽기
            await sleep(2000); // 2초 뒤 다음 문장
          } else {
            await sleep(1500); // 다음 빈칸까지 1.5초
          }
        } else {
          // 단어 모드: 풀네임 보여주며 읽어주고 2초 뒤 다음
          if (speak) { try { await speak(targets[cur]); } catch (e) { /* */ } }
          await sleep(2000);
        }
        if (closedRef.current) return;
        setReveal(false);
        transitRef.current = false;
        if (next >= targets.length) {
          setStatus('clear'); stopAll();
          if (!clearedOnceRef.current) { clearedOnceRef.current = true; if (onClear) onClear(); } // 클리어 기록 (1회, 메달 연동)
        }
        else setTi(next); // 새 목표 안내는 자동 반복 재생 루프가 담당
      })();
    } else {
      sfxBad();
      setCombo(0);
      setFlash(true); setTimeout(() => setFlash(false), 350);
      setLives(l => { const nl = Math.max(0, l - 1); if (nl <= 0) setNeedRefill(true); return nl; }); // 오답 → 생명 -1
    }
    removeObj(id);
  };

  // 생명 충전: 목표 단어를 N번 듣고 하트 받기
  const earnLives = async (times, grant) => {
    if (refillBusy) return;
    setRefillBusy(times); setRefillProg(0);
    for (let i = 0; i < times; i++) {
      if (closedRef.current) return;
      setRefillProg(i + 1);
      if (speak && targets[tiRef.current]) { try { await speak(targets[tiRef.current]); } catch (e) { /* */ } }
      if (i < times - 1) await new Promise(r => setTimeout(r, 400));
    }
    if (closedRef.current) return;
    setLives(l => l + grant);
    setNeedRefill(false);
    setRefillBusy(0); setRefillProg(0);
  };

  // ─── 메인 루프: 물리 + 궤적 + 파티클 ───
  const loop = useCallback(() => {
    const c = containerRef.current, cv = canvasRef.current;
    if (!c || !cv) return;
    const H = c.clientHeight;
    const now = performance.now();

    // 오브젝트 물리 (💩/🌟 속도 효과 반영)
    const ts = speedRef.current;
    const gone = [];
    Object.entries(physRef.current).forEach(([id, p]) => {
      p.x += p.vx * ts; p.y += p.vy * ts; p.vy += GRAV * ts; p.rot += p.vr * ts;
      const el = elsRef.current[id];
      if (el) el.style.transform = `translate3d(${p.x - p.w / 2}px, ${p.y - p.h / 2}px, 0) rotate(${p.rot}deg)`;
      if (p.y > H + 120) gone.push(id);
    });
    gone.forEach(removeObj);

    // 캔버스: 궤적 + 과즙
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const pts = trailRef.current.filter(pt => now - pt.t < 260);
    trailRef.current = pts;
    if (pts.length > 1) {
      for (let i = 1; i < pts.length; i++) {
        const alpha = 1 - (now - pts[i].t) / 260;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 5 * alpha + 1;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(80,180,255,0.9)';
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    partsRef.current = partsRef.current.filter(pp => pp.life > 0);
    partsRef.current.forEach(pp => {
      pp.x += pp.vx; pp.y += pp.vy; pp.vy += 0.25; pp.life -= 0.03;
      ctx.globalAlpha = Math.max(0, pp.life);
      ctx.fillStyle = pp.color;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (statusRef.current === 'play') rafRef.current = requestAnimationFrame(loop);
    else { rafRef.current = null; ctx.clearRect(0, 0, cv.width, cv.height); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startGame = () => {
    closedRef.current = false;
    Object.keys(physRef.current).forEach(k => delete physRef.current[k]);
    setObjects([]); setPieces([]);
    setTi(0); setScore(0); setCombo(0);
    setLives((mode === 'sentence' && sRounds ? sRounds.length : targets.length) + 1); // 생명 = 단어(문장) 수 + 1
    setNeedRefill(false); setRefillBusy(0); setRefillProg(0);
    transitRef.current = false;
    setReveal(false);
    speedRef.current = 1;
    if (speedTimerRef.current) { clearTimeout(speedTimerRef.current); speedTimerRef.current = null; }
    setEffectLabel(null);
    setVoicePaused(false);
    keepAudioAwake(); // 시작 버튼 제스처로 오디오 상시 가동
    setStatus('play');
    statusRef.current = 'play'; // 첫 단어 안내는 자동 반복 재생 루프가 담당
    if (spawnRef.current) clearInterval(spawnRef.current);
    spawnRef.current = setInterval(spawnOne, SPAWN_MS);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  // 화면 꺼짐/백그라운드 → 게임 일시정지, 복귀 → 쌓인 오브젝트 비우고 재개 (몰림/버벅임 방지)
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (spawnRef.current) { clearInterval(spawnRef.current); spawnRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      } else if (statusRef.current === 'play' && !closedRef.current) {
        Object.keys(physRef.current).forEach(k => delete physRef.current[k]); // 쌓인 것 정리
        setObjects([]); setPieces([]);
        trailRef.current = []; partsRef.current = [];
        if (!spawnRef.current) spawnRef.current = setInterval(spawnOne, SPAWN_MS);
        if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [spawnOne, loop]);

  // ─── 포인터(스와이프) ───
  const rel = (e) => { const r = containerRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const lastSwishRef = useRef(0); // 허공 스윙 소리 쓰로틀
  const onDown = (e) => { downRef.current = true; keepAudioAwake(); const p = rel(e); trailRef.current.push({ ...p, t: performance.now() }); }; // 터치 즉시 오디오 상시 가동
  const onUp = () => { downRef.current = false; };
  const onMove = (e) => {
    if (!downRef.current || statusRef.current !== 'play' || needRefillRef.current) return; // 생명 없으면 베기 불가
    const p = rel(e);
    const pts = trailRef.current;
    const last = pts[pts.length - 1];
    pts.push({ ...p, t: performance.now() });
    // 베기 각도 스냅
    let snap = 'd';
    if (last) {
      const dx = p.x - last.x, dy = p.y - last.y;
      const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
      if (ang < 25 || ang > 155) snap = 'h';
      else if (ang > 65 && ang < 115) snap = 'v';
    }
    // 충돌 판정
    let hitAny = false;
    Object.entries(physRef.current).forEach(([id, o]) => {
      if (o.sliced) return;
      const pad = 8;
      if (p.x > o.x - o.w / 2 - pad && p.x < o.x + o.w / 2 + pad && p.y > o.y - o.h / 2 - pad && p.y < o.y + o.h / 2 + pad) {
        sliceObj(id, snap);
        hitAny = true;
      }
    });

    // 허공 스윙: 빠르게 그었는데 아무것도 못 벴을 때 (작게, 0.3초 쓰로틀)
    const now = performance.now();
    if (hitAny) lastSwishRef.current = now;
    else if (last && Math.hypot(p.x - last.x, p.y - last.y) > 24 && now - lastSwishRef.current > 300) {
      lastSwishRef.current = now;
      if (!playSample('slice', 0.22)) sfxSlice();
    }
  };

  return (
    <div className="slc-root">
      <div className={`slc-area ${flash ? 'slc-flash' : ''}`} ref={containerRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>

        {/* 대나무 배경 (길고 가는 줄기, 잎 없음) */}
        <div className="slc-bamboo" aria-hidden="true">
          <i className="slc-stalk s1" /><i className="slc-stalk s2" /><i className="slc-stalk s3" />
          <i className="slc-stalk s4" /><i className="slc-stalk s5" /><i className="slc-stalk s6" />
        </div>

        <button className="slc-close" onClick={handleClose}>✕ 나가기</button>

        {/* HUD */}
        {status !== 'ready' && (
          <div className="slc-hud">
            <div className="slc-stats">
              <span>⭐ {score}</span>
              <span className="slc-progress">
                {mode === 'sentence' && sRounds
                  ? `${status === 'clear' ? sRounds.length : (steps[ti]?.r ?? 0) + 1}/${sRounds.length}`
                  : `${status === 'clear' ? targets.length : ti}/${targets.length}`}
              </span>
            </div>

            {/* 힌트 단어 — 재생버튼 박스 왼쪽 별도 영역, 큰 글씨 (3회 재생마다 1글자, 정답 시 풀네임) */}
            {mode !== 'sentence' && (reveal || hintN > 0) && target && (
              <div className={`slc-hintbig ${reveal ? 'full' : ''}`}>
                💡 {reveal ? maskWord(target, 999) : maskWord(target, hintN)}
              </div>
            )}

            {mode === 'sentence' && sRounds && status !== 'clear' && steps[ti] ? (
              /* 문장 모드: 빈칸이 있는 문장 보드 */
              <div className="slc-board">
                {(() => {
                  const st = steps[ti];
                  const rd = sRounds[st.r];
                  const base = steps.findIndex(s => s.r === st.r); // 이 문장의 첫 step 인덱스
                  return rd.wordArr.map((w, i) => {
                    const bi = rd.blanks.indexOf(i);
                    if (bi === -1) return <span key={i} className="slc-bword">{w}</span>;
                    const stepIdx = base + bi;
                    if (stepIdx < ti) return <span key={i} className="slc-bblank filled">{w}</span>;
                    const isCur = stepIdx === ti;
                    if (isCur && reveal) return <span key={i} className="slc-bblank filled">{st.word}</span>; // 정답 → 초록 공개
                    return (
                      <span key={i} className={`slc-bblank ${isCur ? 'cur' : ''}`}>
                        {isCur ? (hintN > 0 ? maskWord(st.word, hintN) : '?') : '?'}
                      </span>
                    );
                  });
                })()}
                <button className="slc-listen"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleVoice(); }}
                  title={voicePaused ? '음성 다시 재생' : '음성 멈춤'}>
                  {voicePaused ? '▶️' : '⏸️'}
                </button>
              </div>
            ) : (
              <div className="slc-target-box">
                🎯 <span className="slc-target">{target ? '?' : '완료!'}</span>
                {target && (
                  <button className="slc-listen"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggleVoice(); }}
                    title={voicePaused ? '음성 다시 재생' : '음성 멈춤'}>
                    {voicePaused ? '▶️' : '⏸️'}
                  </button>
                )}
              </div>
            )}

            {combo >= 2 && <span className="slc-combo-chip">🔥 {combo} 콤보!</span>}
            {effectLabel === 'fast' && <span className="slc-effect fast">💩 빨라졌다!</span>}
            {effectLabel === 'slow' && <span className="slc-effect slow">✨ 느려졌다!</span>}
          </div>
        )}

        {/* 날아다니는 오브젝트 */}
        {objects.map(o => (
          <div key={o.id}
            ref={el => { elsRef.current[o.id] = el; }}
            className={`slc-obj ${o.type === 'word' ? 'word' : 'fruit'}`}>
            {o.text}
          </div>
        ))}

        {/* 절단 조각 */}
        {pieces.map(pc => (
          <div key={pc.id}
            className={`slc-piece ${pc.type === 'word' ? 'word' : 'fruit'}`}
            style={{ left: pc.x - pc.w / 2, top: pc.y - pc.h / 2, width: pc.w, height: pc.h, clipPath: pc.clip, transform: `rotate(${pc.rot}deg)` }}
            ref={el => {
              if (el && !el.dataset.fall) {
                el.dataset.fall = '1';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  el.style.transform = `translate(${pc.dx}px, 70vh) rotate(${pc.rot + pc.spin}deg)`;
                  el.style.opacity = '0.25';
                }));
              }
            }}>
            {pc.text}
          </div>
        ))}

        {/* 하단 안내 (느린 깜빡임) */}
        {status === 'play' && !needRefill && (
          <div className="slc-guide">🥷 들리는 단어를 찾아 손가락으로 슥~ 베어요!</div>
        )}

        {/* 남은 생명 (왼쪽 하단, 가로 하트) */}
        {status === 'play' && (
          <div className="slc-hearts">
            {lives > 0
              ? Array.from({ length: lives }).map((_, i) => <span key={i} className="slc-heart">❤️</span>)
              : <span className="slc-hearts-empty">생명이 없어요!</span>}
          </div>
        )}

        {/* 생명 충전 패널 */}
        {/* 충전 듣기 중 — 화면 가운데 단어 크게 (학습 보조) */}
        {refillBusy > 0 && targets[ti] && (
          <div className="slc-bigword">{targets[ti]}</div>
        )}

        {needRefill && status === 'play' && (
          <div className="slc-refill">
            <div className="slc-refill-title">💔 생명이 다 떨어졌어요!</div>
            {refillBusy ? (
              <div className="slc-refill-busy">🔊 단어 듣는 중... {refillProg}/{refillBusy}</div>
            ) : (
              <div className="slc-refill-btns">
                <button className="slc-btn start" onPointerDown={(e) => e.stopPropagation()} onClick={() => earnLives(3, 1)}>🔊 3번 듣고 ❤️ 1개</button>
                <button className="slc-btn start" onPointerDown={(e) => e.stopPropagation()} onClick={() => earnLives(5, 2)}>🔊 5번 듣고 ❤️ 2개</button>
              </div>
            )}
          </div>
        )}

        {/* 궤적/파티클 캔버스 (최상단) */}
        <canvas ref={canvasRef} className="slc-canvas" />

        {/* 오버레이 */}
        {status === 'ready' && (
          <div className="slc-overlay">
            <div className="slc-title">🥷 단어 베기</div>
            {targets.length === 0 ? (
              <>
                <div className="slc-desc">{mode === 'sentence' ? '문장이 없어요. 문장 관리에서 먼저 등록해 주세요!' : '단어가 없어요. 단어 관리에서 먼저 등록해 주세요!'}</div>
                <button className="slc-btn ghost" onClick={handleClose}>나가기</button>
              </>
            ) : (
              <>
                <div className="slc-desc">🎯 <b>목표 단어</b>가 튀어 오르면 손가락으로 <b>슥─ 베어요!</b><br />과일을 베면 콤보가 올라가요 🍉</div>
                <button className="slc-btn start" onClick={startGame}>▶ 시작</button>
              </>
            )}
          </div>
        )}
        {status === 'clear' && (
          <div className="slc-overlay">
            <FireworksCelebration size={120} />
            <div className="slc-title">🎉 모두 베었다!</div>
            <div className="slc-desc">⭐ 점수 {score}점 · 단어 {targets.length}개 완료!</div>
            <div className="slc-btn-row">
              <button className="slc-btn start" onClick={startGame}>↺ 한 판 더</button>
              <button className="slc-btn ghost" onClick={handleClose}>나가기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
