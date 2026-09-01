import React, { useState, useEffect } from 'react';
import HintQuiz from './HintQuiz';
import FireworksCelebration from './FireworksCelebration';
import './WordActivities.css';

// 누적 복습 퀴즈: 여러 레슨 단어를 모아 무작위로 퀴즈
// props: words[](누적 단어), weakWords[](자주 틀린 단어, 앞쪽일수록 약함),
//        speak(word), getImage(word), onWordResult(word, good), onClose()
const MAX_Q = 10;
const WEAK_SLOTS = 6; // 10문제 중 최대 6개는 약한 단어로 채움
function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

export default function ReviewQuiz({ words = [], weakWords = [], speak, getImage, onWordResult, onClose }) {
  const [items] = useState(() => {
    const norm = (w) => (w || '').toLowerCase().trim();
    const pool = [...new Set(words.filter(Boolean).map(norm))];
    // 약한 단어 우선 배치 (많이 틀린 순) → 나머지는 무작위로 채움
    const weak = [...new Set(weakWords.map(norm).filter(Boolean))].slice(0, WEAK_SLOTS);
    const rest = shuffle(pool.filter(w => !weak.includes(w)));
    const all = [...weak, ...rest];
    return shuffle(all.slice(0, Math.min(MAX_Q, all.length))); // 출제 순서는 섞어서 지루하지 않게
  });
  const [idx, setIdx] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [done, setDone] = useState(false);
  const word = items[idx] || '';

  useEffect(() => {
    let alive = true;
    setImageUrl('');
    if (word && getImage) Promise.resolve(getImage(word)).then(u => { if (alive) setImageUrl(u || ''); }).catch(() => {});
    return () => { alive = false; };
  }, [word, getImage]);

  const onSolved = (info) => {
    if (onWordResult) {
      const clean = !!(info && info.clean);
      onWordResult(word, clean, clean ? '' : (info && info.misses > 0 ? 'quizMiss' : 'quizHint')); // 과정 기록
    }
    setTimeout(() => {
      if (idx + 1 < items.length) setIdx(idx + 1);
      else setDone(true);
    }, 700);
  };

  if (items.length === 0) {
    return (
      <div className="wsc-embed">
        <div className="wsc-empty">복습할 단어가 없어요. 먼저 단어를 등록해 주세요!</div>
        <button className="wa-btn wa-reset" onClick={onClose}>닫기</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="wsc-embed">
        <div className="wsc-finish">
          <FireworksCelebration size={120} />
          <div className="wsc-finish-title">🎉 복습 완료!</div>
          <div className="wsc-finish-sub">{items.length}개 단어를 복습했어요!</div>
          <button className="wa-btn wa-reset" onClick={onClose}>나가기</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wsc-embed">
      <div className="wsc-progress">
        <div className="wsc-word-count" style={{ textAlign: 'center' }}>복습 퀴즈 {idx + 1} / {items.length}</div>
        <div className="wsc-bar"><div className="wsc-bar-fill" style={{ width: `${((idx + 1) / items.length) * 100}%` }} /></div>
      </div>
      <HintQuiz key={word} word={word} imageUrl={imageUrl} speak={speak} onComplete={onSolved} />
    </div>
  );
}
