import React, { useState, useEffect, useRef, useCallback } from 'react';
import './WordActivities.css';
import { stopCachedAudio } from './ttsCache';

// 힌트 퀴즈 (타일 탭) — 8세용
// props:
//   word: 정답 영어 단어 (필수)
//   imageUrl: 단어 이미지 URL (선택)
//   meaningKo: 한글 뜻 (선택)
//   speak: (text) => void  맞혔을 때 발음 재생 (선택)
//   onComplete: (info) => void 정답 처리 후 콜백 (선택)
//     info = { misses, hintsUsed, clean } — clean=한 번에 힌트 없이 맞힘
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function HintQuiz({ word, imageUrl, meaningKo, speak, onComplete }) {
  const target = (word || '').toLowerCase().trim();
  const n = target.length;

  // 타일: 정답 글자 + 무작위 오답 2개 (각 고유 id)
  const buildTiles = useCallback(() => {
    const base = target.split('').map((ch, i) => ({ id: 'c' + i, char: ch, used: false }));
    const pool = LETTERS.filter(l => !target.includes(l));
    const distractors = shuffle(pool).slice(0, Math.min(2, pool.length))
      .map((ch, i) => ({ id: 'd' + i, char: ch, used: false }));
    return shuffle([...base, ...distractors]);
  }, [target]);

  const [tiles, setTiles] = useState(buildTiles);
  const [slots, setSlots] = useState([]); // [{char, locked, tileId}|null]
  const [availableHints, setAvailableHints] = useState(1); // 사용 가능한 힌트 수 (최초 1개)
  const [listenProgress, setListenProgress] = useState(0); // 힌트 얻기용 듣기 진행(0~2)
  const [solved, setSolved] = useState(false);
  const [wrong, setWrong] = useState(false);
  // 과정 기록 (아이 화면은 그대로, 약점 판단용으로만 사용)
  const missRef = useRef(0);   // 틀린 조합 횟수
  const hintRef = useRef(0);   // 사용한 힌트 수

  // 초기화 (단어 바뀌면)
  const reset = useCallback(() => {
    const t = buildTiles();
    const s = Array(n).fill(null);
    setTiles(t);
    setSlots(s);
    setAvailableHints(1);
    setListenProgress(0);
    setSolved(false);
    setWrong(false);
  }, [buildTiles, n]);

  useEffect(() => { reset(); }, [reset]);
  // 과정 카운터는 단어가 바뀔 때만 초기화 ("↺ 다시"로 리셋되지 않게)
  useEffect(() => { missRef.current = 0; hintRef.current = 0; }, [target]);

  // ─── 음성 재생 공통 (듣기·힌트얻기가 서로 겹치지 않게 한 번에 하나만) ───
  const speakingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);      // 재생 중 (자동 포함)
  const [manualPlay, setManualPlay] = useState(false);  // 사용자가 누른 재생 → 멈춤 버튼 표시
  const speakOnce = async (times = 1, manual = false) => {
    if (speakingRef.current || !speak) return false;
    speakingRef.current = true; setSpeaking(true); if (manual) setManualPlay(true);
    for (let i = 0; i < times; i++) {
      if (!speakingRef.current) break; // 멈춤 눌림
      try { await speak(target); } catch (e) { /* ignore */ }
      if (i < times - 1) await new Promise(r => setTimeout(r, 500));
    }
    speakingRef.current = false; setSpeaking(false); setManualPlay(false);
    return true;
  };
  // 수동 재생 멈춤
  const stopSpeak = () => {
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    speakingRef.current = false; setSpeaking(false); setManualPlay(false);
  };
  const speakOnceRef = useRef(speakOnce); speakOnceRef.current = speakOnce;

  const nextEmpty = (s) => s.findIndex(x => x === null);

  const checkComplete = useCallback((s) => {
    if (s.some(x => x === null)) return;
    const guess = s.map(x => x.char).join('');
    if (guess === target) {
      setSolved(true);
      const info = {
        misses: missRef.current,
        hintsUsed: hintRef.current,
        clean: missRef.current === 0 && hintRef.current === 0, // 한 번에 힌트 없이 성공
      };
      (async () => {
        await speakOnceRef.current(3); // 재생 중 듣기·힌트 버튼 잠금
        if (onComplete) onComplete(info);
      })();
    } else {
      missRef.current += 1; // 헤맨 횟수 기록
      setWrong(true);
      setTimeout(() => setWrong(false), 600);
    }
  }, [target, speak, onComplete]);

  const placeTile = (tile) => {
    if (solved || tile.used) return;
    const idx = nextEmpty(slots);
    if (idx === -1) return;
    const newSlots = slots.slice();
    newSlots[idx] = { char: tile.char, locked: false, tileId: tile.id };
    const newTiles = tiles.map(t => t.id === tile.id ? { ...t, used: true } : t);
    setSlots(newSlots);
    setTiles(newTiles);
    checkComplete(newSlots);
  };

  const removeSlot = (i) => {
    if (solved) return;
    const slot = slots[i];
    if (!slot || slot.locked) return;
    const newSlots = slots.slice();
    newSlots[i] = null;
    setSlots(newSlots);
    if (slot.tileId) {
      setTiles(tiles.map(t => t.id === slot.tileId ? { ...t, used: false } : t));
    }
  };

  // 힌트 사용: 다음 글자 하나 공개 (사용 가능 힌트 1개 소모)
  const useHint = () => {
    if (solved || availableHints <= 0) return;
    const idx = nextEmpty(slots);
    const targetIdx = idx === -1 ? slots.findIndex(x => x && !x.locked) : idx;
    if (targetIdx === -1) return;
    const newSlots = slots.slice();
    const old = newSlots[targetIdx];
    let newTiles = tiles;
    if (old && old.tileId) newTiles = tiles.map(t => t.id === old.tileId ? { ...t, used: false } : t);
    newSlots[targetIdx] = { char: target[targetIdx], locked: true, tileId: null };
    const tile = newTiles.find(t => !t.used && t.char === target[targetIdx]);
    if (tile) newTiles = newTiles.map(t => t.id === tile.id ? { ...t, used: true } : t);
    setSlots(newSlots);
    setTiles(newTiles);
    setAvailableHints(h => h - 1);
    hintRef.current += 1; // 힌트 사용 기록
    checkComplete(newSlots);
  };

  // 힌트 얻기: 단어 듣기 (3번 들으면 힌트 1개 추가)
  const earnHint = async () => {
    if (solved || speakingRef.current) return;
    const played = await speakOnce(1, true);
    if (!played) return; // 재생 못 했으면 진행도 올리지 않음
    setListenProgress(p => {
      const np = p + 1;
      if (np >= 3) { setAvailableHints(h => h + 1); return 0; }
      return np;
    });
  };

  return (
    <div className="wa-card">
      {!solved && (
        <div className="wa-hint-ctrl">
          <button className="wa-hint-use" onClick={useHint} disabled={availableHints <= 0} title="힌트 쓰기">
            💡 Hint
            <span className="wa-hint-badge">{availableHints}</span>
          </button>
          {manualPlay ? (
            <button className="wa-hint-earn" onClick={stopSpeak} title="멈춤">⏹️ 멈춤</button>
          ) : (
            <button className="wa-hint-earn" onClick={earnHint} disabled={speaking} title="단어 듣고 힌트 얻기">
              🔊 힌트 얻기{listenProgress > 0 ? ` ${listenProgress}/3` : ''}
            </button>
          )}
        </div>
      )}
      <div className="wa-top">
        {imageUrl ? (
          <img src={imageUrl} alt={target} className="wa-pic" />
        ) : (
          <div className="wa-pic wa-pic-empty">🖼️</div>
        )}
        {meaningKo && <div className="wa-meaning">{meaningKo}</div>}
      </div>

      <div className={`wa-slots ${wrong ? 'wa-shake' : ''} ${solved ? 'wa-solved' : ''}`}>
        {slots.map((slot, i) => (
          <button
            key={i}
            className={`wa-slot ${slot ? (slot.locked ? 'locked' : 'filled') : 'empty'}`}
            onClick={() => slot && !slot.locked && removeSlot(i)}
            disabled={solved}
          >
            {slot ? slot.char : ''}
          </button>
        ))}
      </div>

      {solved ? (
        <div className="wa-success">
          <span className="wa-success-word">{target}</span>
          <div className="wa-success-msg">⭐ 정답! 잘했어요!</div>
          {speak && (
            manualPlay
              ? <button className="wa-btn wa-reset" onClick={stopSpeak}>⏹️ 멈춤</button>
              : <button className="wa-btn wa-listen" onClick={() => speakOnce(1, true)} disabled={speaking}>
                  {speaking ? '🔊 재생 중...' : '🔊 다시 듣기'}
                </button>
          )}
        </div>
      ) : (
        <>
          <div className="wa-tiles">
            {tiles.map(t => (
              <button
                key={t.id}
                className={`wa-tile ${t.used ? 'used' : ''}`}
                onClick={() => placeTile(t)}
                disabled={t.used}
              >
                {t.char}
              </button>
            ))}
          </div>
          <div className="wa-actions">
            <button className="wa-btn wa-reset" onClick={reset}>↺ 다시</button>
            {speak && (
              manualPlay
                ? <button className="wa-btn wa-reset" onClick={stopSpeak}>⏹️ 멈춤</button>
                : <button className="wa-btn wa-listen" onClick={() => speakOnce(1, true)} disabled={speaking}>
                    {speaking ? '🔊 재생 중...' : '🔊 듣기'}
                  </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
