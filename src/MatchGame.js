import React, { useState, useEffect, useCallback, useRef } from 'react';
import './WordActivities.css';

// 단어 ↔ 그림 짝맞추기 (메모리 카드) — 8세용
// props:
//   words: string[]  레슨 단어
//   getImage: (word) => Promise<url>  이미지 URL 조회 (선택)
//   speak: (word) => void  맞췄을 때 발음 (선택)
const MAX_PAIRS = 6; // 한 판 최대 짝 수

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MatchGame({ words = [], getImage, speak }) {
  const list = words.filter(Boolean);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);       // { uid, word, type:'word'|'img', img, matched }
  const [flipped, setFlipped] = useState([]);    // 현재 뒤집힌 카드 uid (최대 2)
  const [busy, setBusy] = useState(false);       // 불일치 애니메이션 중 클릭 막기
  const [matchedCount, setMatchedCount] = useState(0);
  const [moves, setMoves] = useState(0);
  const [pairCount, setPairCount] = useState(0);
  const reqIdRef = useRef(0); // 라운드 식별 (비동기 이미지 응답 경쟁 방지)

  // 한 판 구성: 단어 선택 → 이미지 조회 → 카드 생성/셔플
  const buildRound = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setCards([]); setFlipped([]); setBusy(false);
    setMatchedCount(0); setMoves(0);

    const picked = shuffle(list).slice(0, Math.min(MAX_PAIRS, list.length));
    setPairCount(picked.length);

    // 이미지 병렬 조회 (실패해도 글자 카드로 폴백)
    const imgs = await Promise.all(picked.map(w =>
      (getImage ? getImage(w) : Promise.resolve('')).catch(() => '')
    ));
    if (myReq !== reqIdRef.current) return; // 더 최신 라운드가 시작됨 → 폐기

    const built = [];
    picked.forEach((w, i) => {
      built.push({ uid: 'w' + i, word: w, type: 'word', img: '', matched: false });
      built.push({ uid: 'i' + i, word: w, type: 'img', img: imgs[i] || '', matched: false });
    });
    setCards(shuffle(built));
    setLoading(false);
  }, [list, getImage]);

  useEffect(() => { buildRound(); /* eslint-disable-next-line */ }, []);

  const allMatched = pairCount > 0 && matchedCount === pairCount;

  const handleClick = (card) => {
    if (busy || card.matched) return;
    if (flipped.includes(card.uid)) return;
    if (flipped.length >= 2) return;

    const next = [...flipped, card.uid];
    setFlipped(next);

    if (next.length === 2) {
      setMoves(m => m + 1);
      const [aUid, bUid] = next;
      const a = cards.find(c => c.uid === aUid);
      const b = cards.find(c => c.uid === bUid);
      // 같은 단어 + 서로 다른 종류(글자/그림)면 정답
      if (a && b && a.word === b.word && a.type !== b.type) {
        // 정답 처리
        if (speak) { try { speak(a.word); } catch (e) { /* ignore */ } }
        setCards(prev => prev.map(c => (c.uid === aUid || c.uid === bUid) ? { ...c, matched: true } : c));
        setMatchedCount(n => n + 1);
        setFlipped([]);
      } else {
        // 불일치 → 잠깐 보여주고 다시 뒤집기
        setBusy(true);
        setTimeout(() => { setFlipped([]); setBusy(false); }, 850);
      }
    }
  };

  return (
    <div className="mg-wrap">
      <div className="mg-head">
        <span className="mg-title">🃏 짝맞추기</span>
        {!loading && pairCount > 0 && (
          <span className="mg-progress">{matchedCount} / {pairCount} 짝 · {moves}번 시도</span>
        )}
      </div>

      {list.length === 0 ? (
        <div className="wsc-empty">이 레슨에 단어가 없어요. 단어 관리에서 추가해 주세요!</div>
      ) : loading ? (
        <div className="mg-loading">
          <span className="wa-loading-spin">🔍</span> 카드 준비 중...
        </div>
      ) : allMatched ? (
        <div className="mg-win">
          <div className="mg-win-emoji">🎉</div>
          <div className="mg-win-msg">모두 맞췄어요! ({moves}번 시도)</div>
          <button className="wa-btn" style={{ background: '#ff8a3d', color: '#fff' }} onClick={buildRound}>
            ↺ 다시 하기
          </button>
        </div>
      ) : (
        <>
          <div className={`mg-grid mg-cols-${pairCount * 2 > 8 ? 4 : (pairCount <= 2 ? 2 : 3)}`}>
            {cards.map(card => {
              const isUp = card.matched || flipped.includes(card.uid);
              return (
                <button
                  key={card.uid}
                  className={`mg-card ${isUp ? 'up' : ''} ${card.matched ? 'matched' : ''}`}
                  onClick={() => handleClick(card)}
                  disabled={card.matched}
                >
                  <span className="mg-card-inner">
                    <span className="mg-face mg-back">🎴</span>
                    <span className="mg-face mg-front">
                      {card.type === 'word' ? (
                        <span className="mg-word">{card.word}</span>
                      ) : card.img ? (
                        <img src={card.img} alt={card.word} className="mg-img" />
                      ) : (
                        <span className="mg-letter">{(card.word[0] || '?').toUpperCase()}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mg-actions">
            <button className="wa-btn wa-reset" onClick={buildRound}>↺ 다시 섞기</button>
          </div>
        </>
      )}
    </div>
  );
}
