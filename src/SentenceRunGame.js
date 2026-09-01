import React, { useState, useRef, useEffect, useCallback } from 'react';
import FireworksCelebration from './FireworksCelebration';
import { stopCachedAudio } from './ttsCache';
import './SentenceRunGame.css';

// 아케이드 런: 핵심 단어(빈칸) 순서대로 수집해 문장 완성
// props: sentences[], speak(text), onClear(), onClose()
const SKIP = new Set(['a', 'i', 'an', 'the', 'is', 'am', 'to', 'of', 'it', 'in', 'on', 'no', 'so', 'at', 'or', 'do', 'be', 'my', 'me', 'he', 'we', 'up', 'if', 'as']);
const FALLBACK_DISTRACTORS = ['dog', 'cat', 'sun', 'run', 'big', 'red', 'box', 'cup', 'hat', 'fun'];
const LANES = 3;
const MAX_BLANKS = 4;
const SPEED = 2.6;        // px/frame
const CHIP_H = 54;
const HP_START = 5;

const clean = (w) => (w || '').replace(/[^a-zA-Z']/g, '').toLowerCase();
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

function buildRound(sentences) {
  const list = (sentences || []).filter(Boolean);
  // 빈칸(핵심 단어)이 있는 문장만
  const withBlank = list.filter(s => s.split(/\s+/).some(w => { const c = clean(w); return c.length >= 2 && !SKIP.has(c); }));
  const pickFrom = withBlank.length ? withBlank : list;
  const sentence = pickFrom[Math.floor(Math.random() * pickFrom.length)] || '';
  const wordArr = sentence.split(/\s+/).filter(Boolean);
  let blanks = [];
  wordArr.forEach((w, i) => { const c = clean(w); if (c.length >= 2 && !SKIP.has(c)) blanks.push(i); });
  if (blanks.length === 0 && wordArr.length) blanks = [0];
  blanks = blanks.slice(0, MAX_BLANKS);
  // 오답 풀 = 레슨 전체 단어(핵심) 중복 제거
  const poolSet = new Set();
  list.forEach(s => s.split(/\s+/).forEach(w => { const c = clean(w); if (c.length >= 2 && !SKIP.has(c)) poolSet.add(c); }));
  const pool = [...poolSet];
  return { sentence, wordArr, blanks, pool };
}

export default function SentenceRunGame({ sentences = [], speak, onClear, onClose }) {
  const [round, setRound] = useState(() => buildRound(sentences));
  const [gameState, setGameState] = useState('ready'); // ready | playing | clear | over
  const [collectedCount, setCollectedCount] = useState(0); // 수집한 빈칸 수
  const [hp, setHp] = useState(HP_START);
  const [playerLane, setPlayerLane] = useState(1);
  const [chips, setChips] = useState([]);
  const [shake, setShake] = useState(false);

  const areaRef = useRef(null);
  const rafRef = useRef(null);
  const chipsRef = useRef([]);
  const laneRef = useRef(1);
  const curBlankRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const idRef = useRef(0);
  const stateRef = useRef('ready');
  const clearedRef = useRef(false);

  const { wordArr, blanks, pool } = round;

  // 현재 수집해야 할 정답 단어
  const correctWordFor = (blankIdx) => clean(wordArr[blanks[blankIdx]]);

  const spawnWave = useCallback(() => {
    const bi = curBlankRef.current;
    if (bi >= blanks.length) return;
    const correct = correctWordFor(bi);
    const distractors = shuffle(pool.filter(p => p !== correct));
    const picks = distractors.slice(0, LANES - 1);
    while (picks.length < LANES - 1) {
      const f = FALLBACK_DISTRACTORS[Math.floor(Math.random() * FALLBACK_DISTRACTORS.length)];
      if (f !== correct && !picks.includes(f)) picks.push(f);
    }
    const laneOrder = shuffle([0, 1, 2]);
    const wave = [
      { lane: laneOrder[0], text: correct, correct: true },
      { lane: laneOrder[1], text: picks[0], correct: false },
      { lane: laneOrder[2], text: picks[1], correct: false },
    ].map(c => ({ ...c, id: ++idRef.current, y: -CHIP_H }));
    chipsRef.current = wave;
    setChips(wave);
  }, [blanks.length, pool, wordArr]); // eslint-disable-line react-hooks/exhaustive-deps

  const endLoop = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  const stopAudio = () => { try { stopCachedAudio(); } catch (e) { /* */ } try { window.speechSynthesis.cancel(); } catch (e) { /* */ } };

  const finish = (win) => {
    endLoop();
    stateRef.current = win ? 'clear' : 'over';
    setGameState(win ? 'clear' : 'over');
    if (win) {
      try { if (speak) speak(round.sentence); } catch (e) { /* */ }
      if (!clearedRef.current) { clearedRef.current = true; if (onClear) onClear(); }
    }
  };

  const loop = useCallback(() => {
    const area = areaRef.current;
    const H = area ? area.clientHeight : 460;
    const hitMin = H - 120, hitMax = H - 40;
    let arr = chipsRef.current.map(c => ({ ...c, y: c.y + SPEED }));

    // 충돌 판정
    for (const c of arr) {
      if (c.done) continue;
      if (c.lane === laneRef.current && c.y >= hitMin && c.y <= hitMax) {
        if (c.correct) {
          c.done = true;
          const nextBi = curBlankRef.current + 1;
          curBlankRef.current = nextBi;
          setCollectedCount(nextBi);
          try { if (speak) speak(clean(c.text)); } catch (e) { /* */ }
          arr = []; // 나머지 칩 제거 → 다음 빈칸 스폰
          if (nextBi >= blanks.length) { chipsRef.current = []; setChips([]); finish(true); return; }
          lastSpawnRef.current = performance.now();
          break;
        } else {
          c.done = true;
          setHp(prev => {
            const nv = prev - 1;
            if (nv <= 0) { chipsRef.current = []; setChips([]); finish(false); }
            return nv;
          });
          setShake(true);
          setTimeout(() => setShake(false), 350);
        }
      }
    }

    // 화면 밖 제거
    arr = arr.filter(c => !c.done && c.y < H + CHIP_H);

    // 웨이브가 비었으면 잠시 후 새로 스폰 (놓쳐도 다시)
    if (arr.length === 0 && stateRef.current === 'playing') {
      const now = performance.now();
      if (now - lastSpawnRef.current > 600) {
        lastSpawnRef.current = now;
        chipsRef.current = [];
        spawnWave();
        arr = chipsRef.current;
      }
    }

    chipsRef.current = arr;
    setChips(arr);
    if (stateRef.current === 'playing') rafRef.current = requestAnimationFrame(loop);
  }, [blanks.length, spawnWave]); // eslint-disable-line react-hooks/exhaustive-deps

  const startGame = () => {
    curBlankRef.current = 0;
    laneRef.current = 1;
    clearedRef.current = false;
    setPlayerLane(1);
    setCollectedCount(0);
    setHp(HP_START);
    setChips([]);
    chipsRef.current = [];
    stateRef.current = 'playing';
    setGameState('playing');
    lastSpawnRef.current = performance.now();
    spawnWave();
    chipsRef.current = chipsRef.current; // spawnWave set it
    endLoop();
    rafRef.current = requestAnimationFrame(loop);
  };

  const newGame = () => { setRound(buildRound(sentences)); setGameState('ready'); };

  const move = (dir) => {
    const nl = Math.max(0, Math.min(LANES - 1, laneRef.current + dir));
    laneRef.current = nl;
    setPlayerLane(nl);
  };

  // 키보드 + 정리
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); endLoop(); stopAudio(); };
  }, []);

  // 스와이프
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 30) move(dx > 0 ? 1 : -1);
    touchX.current = null;
  };

  const laneX = (lane) => `${(lane * 2 + 1) / (LANES * 2) * 100}%`;

  return (
    <div className="srg-wrap">
      {/* HUD: 목표 문장 보드 */}
      <div className="srg-board">
        {wordArr.map((w, i) => {
          const bIndex = blanks.indexOf(i);
          if (bIndex === -1) return <span key={i} className="srg-word">{w}</span>;
          const got = bIndex < collectedCount;
          return <span key={i} className={`srg-blank ${got ? 'filled' : ''}`}>{got ? w : '____'}</span>;
        })}
      </div>
      <div className="srg-hp">{'❤️'.repeat(Math.max(0, hp))}{'🤍'.repeat(Math.max(0, HP_START - hp))}</div>

      {/* 플레이 영역 */}
      <div className={`srg-area ${shake ? 'srg-shake' : ''}`} ref={areaRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="srg-lane-lines"><span /><span /></div>

        {chips.map(c => (
          <div key={c.id} className={`srg-chip ${c.correct ? 'ok' : 'no'}`}
            style={{ left: laneX(c.lane), transform: `translate3d(-50%, ${c.y}px, 0)` }}>
            {c.text}
          </div>
        ))}

        <div className="srg-player" style={{ left: laneX(playerLane) }}>🚗</div>

        {gameState === 'ready' && (
          <div className="srg-overlay">
            <div className="srg-title">🎮 단어 수집 게임</div>
            <div className="srg-desc">차선을 옮겨 <b>순서대로 정답 단어</b>를 모아 문장을 완성하세요!</div>
            <button className="srg-btn start" onClick={startGame}>▶ 게임 시작</button>
          </div>
        )}
        {gameState === 'clear' && (
          <div className="srg-overlay">
            <FireworksCelebration size={120} />
            <div className="srg-title">🎉 문장 완성!</div>
            <div className="srg-cleared-sentence">{round.sentence}</div>
            <div className="srg-btn-row">
              <button className="srg-btn start" onClick={newGame}>↺ 다른 문장</button>
              <button className="srg-btn ghost" onClick={onClose}>나가기</button>
            </div>
          </div>
        )}
        {gameState === 'over' && (
          <div className="srg-overlay">
            <div className="srg-title">아쉬워요 😢</div>
            <div className="srg-desc">다시 도전해볼까요?</div>
            <div className="srg-btn-row">
              <button className="srg-btn start" onClick={startGame}>↺ 다시</button>
              <button className="srg-btn ghost" onClick={onClose}>나가기</button>
            </div>
          </div>
        )}
      </div>

      {/* 조작 버튼 (터치) */}
      {gameState === 'playing' && (
        <div className="srg-controls">
          <button className="srg-ctrl" onClick={() => move(-1)}>◀</button>
          <button className="srg-ctrl" onClick={() => move(1)}>▶</button>
        </div>
      )}
    </div>
  );
}
