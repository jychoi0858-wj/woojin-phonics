import React, { useState, useEffect, useRef } from 'react';
import HintQuiz from './HintQuiz';
import TraceWord from './TraceWord';
import PronunceCheck from './PronunceCheck';
import FireworksCelebration from './FireworksCelebration';
import { stopCachedAudio } from './ttsCache';
import { saveSetProgress, loadSetProgress, clearSetProgress } from './setProgress';
import './WordActivities.css';

// 레슨 세트 코스 (인라인): 단어별 듣기 → 쓰기 → 퀴즈 → 말하기
// props:
//   words: string[]
//   azureKey, azureRegion
//   speak(word): 단어 한 번 TTS (퀴즈/쓰기 피드백)
//   playListen(word, mode): 듣기 단계 재생 (mode: 'word' | 'phonics') → Promise
//   getImage(word): Promise<url>
//   onClose(): 세트 종료
const STAGE_DEFS = [
  { key: 'listen', label: '듣기', icon: '🔊' },
  { key: 'write', label: '쓰기', icon: '✏️' },
  { key: 'quiz', label: '퀴즈', icon: '🧩' },
  { key: 'speak', label: '말하기', icon: '🎤' },
];

export default function WordSetCourse({ words = [], azureKey, azureRegion, speak, playListen, stop, getImage, onClose, onAllComplete, onWordResult, onStartGame, stages, title, subtitle, progressId }) {
  const list = words.filter(Boolean);
  // 복습 모드 등에서 일부 단계만 사용 가능
  const STAGES = stages && stages.length ? STAGE_DEFS.filter(s => stages.includes(s.key)) : STAGE_DEFS;
  const [wi, setWi] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [finished, setFinished] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // 학습 시작 게이트
  // 중간에 나가도 이어서 할 수 있게 저장해둔 진도
  const [saved] = useState(() => loadSetProgress('word', progressId));
  const [gameSkipped, setGameSkipped] = useState(false); // 게임을 나중에 하기로 함 (메달 없이 마무리)

  const word = list[wi] || '';
  const stage = STAGES[stageIdx].key;

  // 진도 저장 (단어/단계가 바뀔 때마다)
  useEffect(() => {
    if (!started || finished) return;
    saveSetProgress('word', progressId, { idx: wi, stage: stageIdx });
  }, [started, finished, wi, stageIdx, progressId]);

  // 완주하면 저장된 진도 삭제 (다음엔 처음부터)
  useEffect(() => { if (finished) clearSetProgress('word', progressId); }, [finished, progressId]);

  // 이미지 로드
  useEffect(() => {
    let alive = true;
    setImageUrl('');
    if (word && getImage) {
      Promise.resolve(getImage(word)).then(url => { if (alive) setImageUrl(url || ''); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [word, getImage]);

  // 자동 넘김 (단계 클리어 시 1~2초 뒤)
  const wiRef = useRef(wi); wiRef.current = wi;
  const stageRef = useRef(stageIdx); stageRef.current = stageIdx;
  const advTimer = useRef(null);
  const cancelAdvance = () => { if (advTimer.current) { clearTimeout(advTimer.current); advTimer.current = null; } };
  const advance = () => {
    const si = stageRef.current, w = wiRef.current;
    if (si < STAGES.length - 1) setStageIdx(si + 1);
    else if (w < list.length - 1) { setWi(w + 1); setStageIdx(0); }
    else setFinished(true);
  };
  const scheduleAdvance = (ms = 1200) => { cancelAdvance(); advTimer.current = setTimeout(() => { advTimer.current = null; advance(); }, ms); };
  const handleStageClear = () => scheduleAdvance(1200);
  const passedRef = useRef(false); // 말하기 통과 여부 (내 발음 재생 후 재예약용)
  useEffect(() => { passedRef.current = false; }, [wi, stageIdx]);
  useEffect(() => cancelAdvance, []); // 언마운트 시 정리

  // 전체 완주 시 1회 기록 (금메달)
  const completedRef = useRef(false);
  useEffect(() => {
    if (finished && !completedRef.current) { completedRef.current = true; if (onAllComplete) onAllComplete(); }
    if (!finished) completedRef.current = false;
  }, [finished, onAllComplete]);

  // 창을 벗어날 때 재생 중이던 음성 정지
  const abortRef = useRef(false);
  const stopAudio = () => {
    abortRef.current = true;
    try { if (stop) stop(); } catch (e) { /* */ }
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    setPlaying(false);
  };
  useEffect(() => () => { cancelAdvance(); stopAudio(); }, []); // 언마운트 정리
  // 단계/단어가 바뀌면 이전 재생 정지
  useEffect(() => () => stopAudio(), [wi, stageIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const doListen = async () => {
    if (playing || !word) return;
    abortRef.current = false;
    setPlaying(true);
    try {
      if (playListen) await playListen(word, 'word');
      else if (speak) await speak(word);
    } catch (e) { /* ignore */ }
    setPlaying(false);
    if (abortRef.current) return; // 벗어났으면 자동 넘김 안 함
    scheduleAdvance(1500); // 듣기 끝나면 자동으로 다음 단계
  };

  // 시작 후 듣기 단계에 들어가면 자동 재생
  useEffect(() => {
    if (!started || finished) return;
    let t;
    if (stage === 'listen') t = setTimeout(doListen, 500);
    return () => { if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wi, stageIdx, started, finished]);

  const prev = () => {
    cancelAdvance();
    if (stageIdx > 0) setStageIdx(stageIdx - 1);
    else if (wi > 0) { setWi(wi - 1); setStageIdx(STAGES.length - 1); }
  };
  const restart = () => { clearSetProgress('word', progressId); setWi(0); setStageIdx(0); setFinished(false); };

  if (list.length === 0) {
    return (
      <div className="wsc-embed">
        <div className="wsc-empty">이 레슨에 단어가 없어요. 단어 관리에서 추가해 주세요!</div>
        <button className="wa-btn wa-reset" onClick={onClose}>닫기</button>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="wsc-embed">
        <div className="wsc-finish">
          <div className="wsc-finish-title">{title || '🎒 세트 학습'}</div>
          <div className="wsc-finish-sub">{subtitle || `${list.length}개 단어를 듣기 → 쓰기 → 퀴즈 → 말하기 순서로 배워요!`}</div>
          {saved && saved.idx < list.length ? (
            <>
              <div className="wsc-resume-note">지난번에 <b>{Math.min(saved.idx + 1, list.length)}번째 단어</b>까지 했어요.</div>
              <div className="wa-actions">
                <button className="wa-btn wa-hint" style={{ fontSize: '1.15rem', padding: '14px 26px' }}
                  onClick={() => { setWi(saved.idx); setStageIdx(Math.min(saved.stage || 0, STAGES.length - 1)); setStarted(true); }}>
                  ▶ 이어서 하기
                </button>
                <button className="wa-btn wa-reset"
                  onClick={() => { clearSetProgress('word', progressId); setWi(0); setStageIdx(0); setStarted(true); }}>
                  ↺ 처음부터
                </button>
              </div>
            </>
          ) : (
            <button className="wa-btn wa-hint" style={{ fontSize: '1.15rem', padding: '14px 30px' }} onClick={() => setStarted(true)}>
              ▶ 학습 시작
            </button>
          )}
        </div>
      </div>
    );
  }

  if (finished) {
    // 게임이 연결되어 있으면 게임까지 해야 메달 (단, 힘들면 건너뛸 수 있음)
    if (onStartGame && !gameSkipped) {
      return (
        <div className="wsc-embed">
          <div className="wsc-finish">
            <div className="wsc-finish-title">🎮 이제 게임!</div>
            <div className="wsc-finish-sub">단어를 다 배웠어요. 게임까지 깨면 🏅 메달을 받아요!</div>
            <div className="wa-actions">
              <button className="wa-btn wa-hint" style={{ fontSize: '1.15rem', padding: '14px 28px' }} onClick={onStartGame}>
                🎮 게임 하기
              </button>
              <button className="wa-btn wa-reset" onClick={restart}>↺ 다시 학습</button>
            </div>
            <button className="wsc-skip-game" onClick={() => setGameSkipped(true)}>나중에 할래요</button>
          </div>
        </div>
      );
    }
    return (
      <div className="wsc-embed">
        <div className="wsc-finish">
          <FireworksCelebration size={140} />
          <div className="wsc-finish-title">🎉 레슨 완료!</div>
          <div className="wsc-finish-sub">
            {list.length}개 단어를 모두 끝냈어요!
            {onStartGame && gameSkipped && <><br />게임을 깨면 🏅 메달을 받을 수 있어요.</>}
          </div>
          <div className="wa-actions">
            {onStartGame && gameSkipped && (
              <button className="wa-btn wa-hint" onClick={() => { setGameSkipped(false); onStartGame(); }}>🎮 게임 하기</button>
            )}
            <button className="wa-btn wa-hint" onClick={restart}>↺ 처음부터</button>
            <button className="wa-btn wa-reset" onClick={onClose}>나가기</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wsc-embed">
      {/* 진행 표시 */}
      <div className="wsc-progress">
        <div className="wsc-top-row">
          <span className="wsc-word-count">단어 {wi + 1} / {list.length}</span>
        </div>
        <div className="wsc-stages">
          {STAGES.map((s, i) => (
            <div key={s.key} className={`wsc-stage ${i === stageIdx ? 'active' : ''} ${i < stageIdx ? 'done' : ''}`}>
              <span className="wsc-stage-icon">{s.icon}</span>
              <span className="wsc-stage-label">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="wsc-bar">
          <div className="wsc-bar-fill" style={{ width: `${((wi * STAGES.length + stageIdx + 1) / (list.length * STAGES.length)) * 100}%` }} />
        </div>
      </div>

      {/* 단계별 활동 */}
      <div className="wsc-stage-body">
        {stage === 'listen' && (
          <div className="wa-card">
            <div className="wa-top">
              {imageUrl
                ? <img src={imageUrl} alt={word} className="wa-pic" />
                : <div className="wa-pic wa-pic-empty">🖼️<span className="wa-pic-none">이미지를 찾을 수 없어요</span></div>}
            </div>
            <div className="wa-pronounce-word">{word}</div>
            <div className="wa-actions">
              <button className="wa-btn wa-listen" onClick={doListen} disabled={playing}>
                {playing ? '재생 중...' : '🔊 듣기'}
              </button>
            </div>
            <div className="wsc-stage-hint">잘 듣고 따라 말해 보세요!</div>
          </div>
        )}
        {stage === 'quiz' && (
          <HintQuiz word={word} imageUrl={imageUrl} speak={speak}
            onComplete={(info) => {
              // 헤매거나 힌트를 썼으면 약점으로 기록 (화면 흐름은 그대로)
              if (onWordResult) {
                const clean = !!(info && info.clean);
                const reason = clean ? '' : (info && info.misses > 0 ? 'quizMiss' : 'quizHint');
                onWordResult(word, clean, reason);
              }
              handleStageClear();
            }} />
        )}
        {stage === 'write' && <TraceWord word={word} speak={speak} onComplete={handleStageClear} />}
        {stage === 'speak' && (
          <PronunceCheck
            word={word}
            azureKey={azureKey}
            azureRegion={azureRegion}
            speak={speak}
            onPass={(info) => {
              // 말하기는 인식이 불안정 → ⚠️ 감점에는 쓰지 않고, 첫 시도 성공만 졸업(streak)에 반영
              if (onWordResult && info && info.firstTry) onWordResult(word, true, '');
              passedRef.current = true; scheduleAdvance(2500);
            }}
            onSkip={() => { cancelAdvance(); advance(); }} /* 넘어가기도 감점 없음 (인식 문제일 수 있음) */
            onPlaybackStart={cancelAdvance}
            onPlaybackEnd={() => { if (passedRef.current) scheduleAdvance(2000); }}
          />
        )}
      </div>

      {/* 뒤로가기만 (앞으로가기는 각 단계 완료 시 자동 넘김) */}
      <button className="wsc-nav-side wsc-prev" onClick={prev} disabled={wi === 0 && stageIdx === 0} title="이전">‹</button>
    </div>
  );
}
