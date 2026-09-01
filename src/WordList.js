import React, { useState, useRef } from 'react';
import { isWeakStat, reasonList } from './learningStats';
import { findPattern, findSoundFriends, soundFile, isIrregular } from './phonics';
import { playPhonicsSound, stopPhonicsSound } from './phonicsAudio';
import PronunceCheck from './PronunceCheck';
import './WordActivities.css';

// 단어 학습 (리스트형) — 등록 단어를 리스트로
// 단어별: 그냥 듣기 / 파닉스 발음 / 읽기 평가, 상단에 반복·간격 설정
// props: words[], playListen(word, mode, repeat, gapMs), speak(word), azureKey, azureRegion, onClose
export default function WordList({ words = [], meanings = {}, wordStats = {}, allWords = [], getImage, playListen, speak, stop, azureKey, azureRegion, onClose, onOpenGame, onFixWeak }) {
  const list = words.filter(Boolean);
  const [activeWord, setActiveWord] = useState(null);
  const [playing, setPlaying] = useState(null); // `${i}-${mode}` | null
  const [openIdx, setOpenIdx] = useState(-1);   // 펼쳐진 단어 (그림 + 뜻)
  const [whyWord, setWhyWord] = useState(null); // ⚠️ 눌렀을 때 이유 팝업
  // 이 레슨에서 어려워한 단어들
  const weakWords = list.filter(w => isWeakStat(wordStats[(w || '').toLowerCase().trim()]));
  const [imgs, setImgs] = useState({});         // { word: url | '' }

  const phBusyRef = useRef(false);
  const phAbortRef = useRef(false);
  const phRunRef = useRef(0);                   // 재생 회차 토큰 (겹침 방지)
  const [noSound, setNoSound] = useState('');   // 음원이 아직 없을 때 안내

  // 재생 시작 — 토큰을 발급하고 버튼을 잠금
  const beginRun = (key) => {
    const token = ++phRunRef.current;
    phAbortRef.current = false;
    phBusyRef.current = true;
    setPlaying(key);
    return token;
  };
  // 재생 끝 — 가장 최근 회차일 때만 버튼을 되돌림
  const endRun = (token) => {
    if (phRunRef.current !== token) return;     // 이미 새 재생이 시작됨
    phBusyRef.current = false;
    setPlaying(null);
  };

  const stopSoundPiece = () => {
    phRunRef.current++;                         // 진행 중인 회차를 무효화
    phAbortRef.current = true;
    stopPhonicsSound();
    if (stop) stop();
    phBusyRef.current = false;
    setPlaying(null);
  };

  // 펼칠 때 그림 로드 (프리페치돼 있으면 즉시)
  const toggleOpen = (i, w) => {
    const next = openIdx === i ? -1 : i;
    setOpenIdx(next);
    if (next !== -1 && getImage && imgs[w] === undefined) {
      Promise.resolve(getImage(w)).then(url => setImgs(prev => ({ ...prev, [w]: url || '' }))).catch(() => setImgs(prev => ({ ...prev, [w]: '' })));
    }
  };
  const [repeatCount, setRepeatCount] = useState(3);
  const [gap, setGap] = useState(1); // 초
  const [speedRate, setSpeedRate] = useState(0.7); // TTS 속도

  // 파닉스 소리만 재생 (위의 반복·간격 설정을 따름)
  const playPhonicsOnly = async (p, idx) => {
    if (phBusyRef.current || playing) return;
    setNoSound('');
    const token = beginRun(idx + '-phsound');
    try {
      for (let r = 0; r < repeatCount; r++) {
        if (phAbortRef.current) break;
        const ok = await playPhonicsSound(soundFile(p.sound));
        if (!ok) { setNoSound(p.label); break; }   // 음원이 아직 등록되지 않음
        if (r < repeatCount - 1) await new Promise(res => setTimeout(res, gap * 1000));
      }
      if (!phAbortRef.current) await new Promise(res => setTimeout(res, 200)); // 여운
    } catch (e) { /* ignore */ }
    endRun(token);
  };

  // 같은 소리가 나는 단어들만 이어서 읽어 주기
  const playFriends = async (friends, idx) => {
    if (phBusyRef.current || playing || !speak) return;
    const token = beginRun(idx + '-phfriends');
    try {
      for (let fi = 0; fi < friends.length; fi++) {
        if (phAbortRef.current) break;
        await speak(friends[fi]);
        if (phAbortRef.current) break;
        await new Promise(res => setTimeout(res, fi < friends.length - 1 ? 400 : 200));
      }
    } catch (e) { /* ignore */ }
    endRun(token);
  };

  const play = async (w, i, mode) => {
    if (playing) return;
    setOpenIdx(prev => (prev === i ? prev : -1)); // 다른 단어의 뜻·그림은 닫음
    setPlaying(i + '-' + mode);
    try {
      if (playListen) await playListen(w, mode, repeatCount, gap * 1000, speedRate);
      else if (speak) await speak(w);
    } catch (e) { /* ignore */ }
    setPlaying(null);
  };

  const stopPlay = () => { if (stop) stop(); setPlaying(null); };

  return (
    <div className="wlist-embed">
      <div className="wlist-head">
        <span className="wlist-title">📖 단어 학습</span>
      </div>

      {/* 반복 / 간격 / 속도 설정 (라디오 통일) */}
      <div className="sm-settings-bar wlist-settings-bar">
        <div className="sm-setting-group">
          <span className="sm-setting-label">반복:</span>
          {[1, 2, 3, 5].map(n => (
            <label key={n} className="sm-radio">
              <input type="radio" name="wlRepeat" checked={repeatCount === n} onChange={() => setRepeatCount(n)} disabled={!!playing} />
              <span className="sm-radio-text">{n}회</span>
            </label>
          ))}
        </div>
        <div className="sm-setting-group">
          <span className="sm-setting-label">간격:</span>
          {[1, 2, 3].map(s => (
            <label key={s} className="sm-radio">
              <input type="radio" name="wlGap" checked={gap === s} onChange={() => setGap(s)} disabled={!!playing} />
              <span className="sm-radio-text">{s}초</span>
            </label>
          ))}
        </div>
        <div className="sm-setting-group">
          <span className="sm-setting-label">속도:</span>
          {[{ l: '아주 느리게', v: 0.4 }, { l: '느리게', v: 0.55 }, { l: '조금 느리게', v: 0.7 }, { l: '보통', v: 0.9 }, { l: '빠르게', v: 1.1 }].map(o => (
            <label key={o.v} className="sm-radio">
              <input type="radio" name="wlSpeed" checked={speedRate === o.v} onChange={() => setSpeedRate(o.v)} disabled={!!playing} />
              <span className="sm-radio-text">{o.l}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 어려워한 단어만 모아 다시 학습 */}
      {onFixWeak && weakWords.length > 0 && (
        <button className="wlist-fix-weak" onClick={() => onFixWeak(weakWords)}>
          ⚠️ 어려워한 단어 {weakWords.length}개만 다시 하기
        </button>
      )}

      {list.length === 0 ? (
        <div className="wsc-empty">이 레슨에 단어가 없어요. 단어 관리에서 추가해 주세요!</div>
      ) : (
        <div className="wlist-list">
          {list.map((w, i) => {
            const key = (w || '').toLowerCase().trim();
            const ko = meanings[key] || '';
            const img = imgs[w];
            const open = openIdx === i;
            return (
              <div className="wlist-block" key={i}>
                <div className="wlist-item">
                  <span className="wlist-num">{i + 1}</span>
                  {/* 단어를 눌러도 펼쳐짐 (먼저 떠올려 보고 확인) */}
                  <button className="wlist-word-btn"
                    onClick={() => toggleOpen(i, w)}
                    disabled={!!playing && playing !== i + '-word'} /* 재생 중엔 그 단어만 열 수 있음 */
                    title="뜻과 그림 보기">
                    <span className="wlist-word">{w}</span>
                    {/* 자주 헤맨 단어 표시 (연속 2회 맞히면 사라짐) */}
                    {(() => {
                      const st = wordStats[key];
                      if (!isWeakStat(st)) return null;
                      return (
                        <span className="wlist-weak" title="눌러서 이유 보기"
                          onClick={(e) => { e.stopPropagation(); setWhyWord({ word: w, st }); }}>⚠️</span>
                      );
                    })()}
                  </button>
                  <div className="wlist-btns">
                    <button
                      className={`wlist-btn ${playing === i + '-word' ? 'stop' : 'listen'}`}
                      onClick={() => playing === i + '-word' ? stopPlay() : play(w, i, 'word')}
                      disabled={!!playing && playing !== i + '-word'} /* 재생 중인 단어의 멈춤만 허용, 나머지는 잠금 */
                    >
                      {playing === i + '-word' ? '⏹️ 멈춤' : '🔊 듣기'}
                    </button>
                    {azureKey && azureRegion && (
                      <button className="wlist-btn speak" onClick={() => setActiveWord(w)} disabled={!!playing}>🎤 읽기</button>
                    )}
                    {/* 뜻·그림 보기 — 듣기/읽기와 같은 크기 */}
                    <button
                      className={`wlist-btn meaning ${open ? 'on' : ''}`}
                      onClick={() => toggleOpen(i, w)}
                      disabled={!!playing && playing !== i + '-word'} /* 재생 중인 단어만 열람 가능 */
                    >
                      {open ? '🙈 닫기' : '💡 뜻·그림'}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="wlist-detail">
                    {img === undefined ? (
                      <div className="wlist-pic wlist-pic-empty">🔍</div>
                    ) : img ? (
                      <img className="wlist-pic" src={img} alt={w} />
                    ) : (
                      <div className="wlist-pic wlist-pic-empty">
                        🖼️<span className="wlist-pic-none">이미지를 찾을 수 없어요</span>
                      </div>
                    )}
                    <div className="wlist-detail-col">
                      <div className="wlist-ko">{ko || <span className="wlist-ko-none">뜻이 등록되지 않았어요</span>}</div>
                      {/* 소리 조각 — 파닉스 패턴 강조 + 같은 소리 친구 */}
                      {(() => {
                        // 규칙으로 읽히지 않는 단어 — 쪼개지 말고 통째로
                        if (isIrregular(w)) {
                          return (
                            <div className="wlist-phonics">
                              <div className="wlist-ph-nosound">
                                💛 <b>{w}</b>는 파닉스 규칙대로 읽히지 않아요. 소리를 쪼개지 말고 통째로 기억해요.
                              </div>
                            </div>
                          );
                        }
                        const p = findPattern(w);
                        if (!p) return null;
                        const friends = findSoundFriends(w, allWords, 3);
                        return (
                          <div className="wlist-phonics">
                            <div className="wlist-ph-word">
                              {w.split('').map((c, ci) => (
                                <span key={ci} className={p.marks.includes(ci) ? 'ph-mark' : ''}>{c}</span>
                              ))}
                            </div>
                            <div className="wlist-ph-row">
                              {playing === i + '-phsound' ? (
                                <button className="wlist-ph-btn" onClick={stopSoundPiece}>⏹️ 멈춤</button>
                              ) : (
                                <button className="wlist-ph-btn" onClick={() => playPhonicsOnly(p, i)} disabled={!!playing}>
                                  🔈 <b>{p.label}</b> 소리 듣기
                                </button>
                              )}
                              {friends.length > 0 && (
                                playing === i + '-phfriends' ? (
                                  <button className="wlist-ph-btn friends" onClick={stopSoundPiece}>⏹️ 멈춤</button>
                                ) : (
                                  <button className="wlist-ph-btn friends" onClick={() => playFriends(friends, i)} disabled={!!playing}>
                                    👬 같은 소리 듣기
                                  </button>
                                )
                              )}
                              <span className="wlist-ph-desc">{p.desc}</span>
                            </div>
                            {noSound === p.label && (
                              <div className="wlist-ph-nosound">아직 <b>{p.label}</b> 음원이 등록되지 않았어요.</div>
                            )}
                            {friends.length > 0 && (
                              <div className="wlist-ph-friends">
                                같은 소리: {friends.join(', ')}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {list.length >= 2 && onOpenGame && (
        <button className="sl-quiz-bottom-btn" onClick={onOpenGame}>
          🎮 단어를 다 배웠다면 도전!
        </button>
      )}

      {/* 어려워한 이유 팝업 */}
      {whyWord && (
        <div className="wsc-overlay" onClick={(e) => { if (e.target === e.currentTarget) setWhyWord(null); }}>
          <div className="why-modal">
            <div className="why-title">⚠️ <b>{whyWord.word}</b></div>
            <div className="why-count">{whyWord.st.ng || 0}번 어려워했어요</div>
            <ul className="why-list">
              {reasonList(whyWord.st).length === 0 ? (
                <li>자세한 이유는 아직 기록되지 않았어요.</li>
              ) : (
                reasonList(whyWord.st).map(r => (
                  <li key={r.key}>{r.text} <b>{r.count}번</b></li>
                ))
              )}
            </ul>
            <div className="why-note">
              연속 3번 잘하면 표시가 사라져요. (지금 {whyWord.st.streak || 0}번)
            </div>
            <div className="wa-actions">
              {onFixWeak && (
                <button className="wa-btn wa-hint" onClick={() => { const w = whyWord.word; setWhyWord(null); onFixWeak([w]); }}>
                  🔁 이 단어만 다시
                </button>
              )}
              <button className="wa-btn wa-reset" onClick={() => setWhyWord(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {activeWord && (
        <div className="wsc-overlay" onClick={(e) => { if (e.target === e.currentTarget) setActiveWord(null); }}>
          <div className="wsc-modal">
            <button className="wsc-close" onClick={() => setActiveWord(null)}>✕</button>
            <PronunceCheck word={activeWord} azureKey={azureKey} azureRegion={azureRegion} speak={speak} />
          </div>
        </div>
      )}
    </div>
  );
}
