import React, { useState, useEffect, useRef } from 'react';
import PronunceCheck from './PronunceCheck';
import { stopCachedAudio } from './ttsCache';
import './WordActivities.css';
import { saveSetProgress, loadSetProgress, clearSetProgress } from './setProgress';
import FireworksCelebration from './FireworksCelebration';

// 문장 세트학습 (커리큘럼): 문장별 듣기 → 끊어읽기 → 읽기, 마지막에 퀴즈
// props:
//   sentences: string[]
//   speak(text, rate): 문장/단어 TTS (Promise)
//   azureKey, azureRegion: 읽기(말하기) 평가용
//   onStartQuiz(): 마지막 퀴즈 시작 (기존 빈칸 퀴즈 열기)
//   onClose(): 세트학습 종료
const STAGES = [
  { key: 'listen', label: '듣기', icon: '🔊' },
  { key: 'shadow', label: '따라 말하기', icon: '🗣️' },
  { key: 'read', label: '읽기', icon: '🎤' },
];

// ─── 문장을 "의미 덩어리"로 끊기 (따라 말하기용) ───
// 기계적으로 2단어씩 자르면 "at a small, / blue house" 처럼 어색하게 끊김
//  → 쉼표/접속사/전치사 앞에서 끊고, 관사·형용사는 뒤 명사에 붙여 둠
const BREAK_BEFORE = new Set([
  'and', 'but', 'or', 'so', 'because', 'that', 'who', 'which', 'when', 'while', 'if', 'then',
  'in', 'on', 'at', 'to', 'for', 'with', 'from', 'into', 'onto', 'over', 'under', 'about',
  'up', 'down', 'out', 'off', 'by', 'near', 'behind', 'between',
]);
// 뒤 단어와 반드시 붙여 읽는 말 (관사·소유격·수식어)
const STICKY = new Set([
  'a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'some', 'any', 'no', 'one', 'two', 'three',
  'very', 'so', 'too', 'not',
]);

export function splitPhrases(sentence, maxLen = 4) {
  const words = (sentence || '').split(/\s+/).filter(Boolean);
  if (words.length <= 3) return words.length ? [words.join(' ')] : [];

  const chunks = [];
  let cur = [];
  const bare = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

  words.forEach((w, i) => {
    const b = bare(w);
    const prev = cur.length ? bare(cur[cur.length - 1]) : '';
    // 새 덩어리를 시작할 지점인가
    const startNew =
      cur.length > 0 &&
      !STICKY.has(prev) &&                       // 관사·수식어 뒤는 끊지 않음
      (BREAK_BEFORE.has(b) || cur.length >= maxLen);
    if (startNew) { chunks.push(cur); cur = []; }
    cur.push(w);
    // 쉼표·마침표 등으로 끝나면 거기서 끊음 (자연스러운 호흡)
    if (/[,;:.!?]$/.test(w) && i < words.length - 1) { chunks.push(cur); cur = []; }
  });
  if (cur.length) chunks.push(cur);

  // 한 단어짜리 덩어리는 앞뒤에 붙여 정리
  const merged = [];
  chunks.forEach(c => {
    if (c.length === 1 && merged.length) merged[merged.length - 1] = merged[merged.length - 1].concat(c);
    else merged.push(c);
  });
  return merged.map(c => c.join(' '));
}

export default function SentenceSetCourse({ sentences = [], meanings = {}, speak, azureKey, azureRegion, onStartQuiz, onClose, progressId, onSentenceResult }) {
  const list = sentences.filter(Boolean);
  const [si, setSi] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [showKo, setShowKo] = useState(false); // 한글 뜻 표시 (기본 숨김)
  const [playing, setPlaying] = useState(false);
  const [readyForQuiz, setReadyForQuiz] = useState(false);
  const [started, setStarted] = useState(false); // 학습 시작 게이트
  // 중간에 나가도 이어서 할 수 있게 저장해둔 진도
  const [saved] = useState(() => loadSetProgress('sentence', progressId));
  const [gameSkipped, setGameSkipped] = useState(false); // 게임을 나중에 하기로 함 (메달 없이 마무리)

  const sentence = list[si] || '';
  const stage = STAGES[stageIdx].key;

  // 진도 저장 / 완주 시 삭제
  useEffect(() => {
    if (!started || readyForQuiz) return;
    saveSetProgress('sentence', progressId, { idx: si, stage: stageIdx });
  }, [started, readyForQuiz, si, stageIdx, progressId]);
  useEffect(() => { if (readyForQuiz) clearSetProgress('sentence', progressId); }, [readyForQuiz, progressId]);

  // 자동 넘김
  const siRef = useRef(si); siRef.current = si;
  const stRef = useRef(stageIdx); stRef.current = stageIdx;
  const timer = useRef(null);
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const advance = () => {
    const s = stRef.current, i = siRef.current;
    if (s < STAGES.length - 1) setStageIdx(s + 1);
    else if (i < list.length - 1) { setSi(i + 1); setStageIdx(0); }
    else setReadyForQuiz(true); // 마지막 문장까지 끝 → 퀴즈 단계
  };
  const schedule = (ms) => { cancel(); timer.current = setTimeout(() => { timer.current = null; advance(); }, ms); };
  const passedRef = useRef(false); // 읽기 통과 여부 (내 발음 재생 후 재예약용)
  useEffect(() => { passedRef.current = false; }, [si, stageIdx]);
  useEffect(() => { setShowKo(false); }, [si]); // 문장이 바뀌면 뜻은 다시 숨김

  // 현재 재생 중인 음성 정지 (창을 벗어날 때)
  const abortRef = useRef(false);
  const stopAudio = () => {
    abortRef.current = true;
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    setPlaying(false);
  };
  useEffect(() => () => { cancel(); stopAudio(); }, []); // 언마운트 정리
  // 단계/문장이 바뀌면 이전 재생 정지
  useEffect(() => () => stopAudio(), [si, stageIdx, readyForQuiz]); // eslint-disable-line react-hooks/exhaustive-deps

  const doListen = async () => {
    if (playing) return;
    abortRef.current = false;
    setPlaying(true);
    try {
      for (let r = 0; r < 3; r++) {
        if (abortRef.current) { setPlaying(false); return; }
        await speak(sentence, '-20%');
        if (r < 2) await new Promise(res => setTimeout(res, 700));
      }
    } catch (e) { /* ignore */ }
    setPlaying(false); // 자동 넘김 없음 — 아이가 › 로 직접 이동
  };

  const doShadow = async () => {
    if (playing) return;
    abortRef.current = false;
    setPlaying(true);
    try {
      // 따라 말하기 단계의 듣기는 항상 끊어 읽기 (몇 번을 눌러도 동일)
      const phrases = splitPhrases(sentence); // 의미 단위로 끊기
      for (const ph of phrases) {
        if (abortRef.current) { setPlaying(false); return; }
        await speak(ph, '-20%');
        await new Promise(res => setTimeout(res, 1500)); // 따라 말할 시간
      }
    } catch (e) { /* ignore */ }
    setPlaying(false); // 자동 넘김 없음 — 아이가 › 로 직접 이동
  };

  // 시작 후, 단계에 들어가면 자동 재생 (듣기·따라말하기)
  useEffect(() => {
    if (!started || readyForQuiz) return;
    let t;
    if (stage === 'listen') t = setTimeout(doListen, 500);
    else if (stage === 'shadow') t = setTimeout(doShadow, 500);
    return () => { if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [si, stageIdx, readyForQuiz, started]);

  const next = () => { cancel(); advance(); };
  const prev = () => {
    cancel();
    const s = stRef.current, i = siRef.current;
    if (readyForQuiz) { setReadyForQuiz(false); return; }
    if (s > 0) setStageIdx(s - 1);
    else if (i > 0) { setSi(i - 1); setStageIdx(STAGES.length - 1); }
  };

  if (list.length === 0) {
    return (
      <div className="wsc-embed">
        <div className="wsc-empty">이 레슨에 문장이 없어요. 문장 관리에서 추가해 주세요!</div>
        <button className="wa-btn wa-reset" onClick={onClose}>닫기</button>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="wsc-embed">
        <div className="wsc-finish">
          <div className="wsc-finish-title">🎒 문장 세트 학습</div>
          <div className="wsc-finish-sub">{list.length}개 문장을 듣기 → 따라 말하기 → 읽기 순서로 배우고, 마지막에 게임을 해요!</div>
          {saved && saved.idx < list.length ? (
            <>
              <div className="wsc-resume-note">지난번에 <b>{Math.min(saved.idx + 1, list.length)}번째 문장</b>까지 했어요.</div>
              <div className="wa-actions">
                <button className="wa-btn wa-hint" style={{ fontSize: '1.15rem', padding: '14px 26px' }}
                  onClick={() => { setSi(saved.idx); setStageIdx(Math.min(saved.stage || 0, STAGES.length - 1)); setStarted(true); }}>
                  ▶ 이어서 하기
                </button>
                <button className="wa-btn wa-reset"
                  onClick={() => { clearSetProgress('sentence', progressId); setSi(0); setStageIdx(0); setStarted(true); }}>
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

  if (readyForQuiz) {
    // 게임을 건너뛴 경우: 학습만 완료 (메달 없음)
    if (gameSkipped) {
      return (
        <div className="wsc-embed">
          <div className="wsc-finish">
            <FireworksCelebration size={140} />
            <div className="wsc-finish-title">🎉 문장 학습 완료!</div>
            <div className="wsc-finish-sub">
              {list.length}개 문장을 모두 끝냈어요!<br />게임을 깨면 🏅 메달을 받을 수 있어요.
            </div>
            <div className="wa-actions">
              <button className="wa-btn wa-hint" onClick={() => { setGameSkipped(false); onStartQuiz(); }}>🎮 게임 하기</button>
              <button className="wa-btn wa-reset" onClick={() => { setGameSkipped(false); setReadyForQuiz(false); setSi(0); setStageIdx(0); }}>↺ 처음부터</button>
              <button className="wa-btn wa-reset" onClick={onClose}>나가기</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="wsc-embed">
        <div className="wsc-finish">
          <div className="wsc-finish-title">🎮 이제 게임!</div>
          <div className="wsc-finish-sub">문장을 다 배웠어요. 게임까지 깨면 🏅 메달을 받아요!</div>
          <div className="wa-actions">
            <button className="wa-btn wa-hint" onClick={onStartQuiz}>🎮 게임 하기</button>
            <button className="wa-btn wa-reset" onClick={() => { setReadyForQuiz(false); setSi(0); setStageIdx(0); }}>↺ 다시 학습</button>
          </div>
          <button className="wsc-skip-game" onClick={() => setGameSkipped(true)}>나중에 할래요</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wsc-embed">
      <div className="wsc-progress">
        <div className="wsc-top-row"><span className="wsc-word-count">문장 {si + 1} / {list.length}</span></div>
        <div className="wsc-stages">
          {STAGES.map((s, i) => (
            <div key={s.key} className={`wsc-stage ${i === stageIdx ? 'active' : ''} ${i < stageIdx ? 'done' : ''}`}>
              <span className="wsc-stage-icon">{s.icon}</span>
              <span className="wsc-stage-label">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="wsc-bar">
          <div className="wsc-bar-fill" style={{ width: `${((si * STAGES.length + stageIdx + 1) / (list.length * STAGES.length)) * 100}%` }} />
        </div>
      </div>

      <div className="wsc-stage-body">
        {stage === 'listen' && (
          <div className="wa-card">
            <div className="ssc-sentence">{sentence}</div>
            {/* 한글 뜻 — 듣기 단계에서만, 눌렀을 때만 (읽기 단계에선 크러치가 되지 않게 감춤) */}
            {showKo && <div className="ssc-meaning">{meanings[sentence] || '뜻이 등록되지 않았어요'}</div>}
            <div className="wa-actions">
              <button className="wa-btn wa-listen" onClick={doListen} disabled={playing}>{playing ? '재생 중...' : '🔊 듣기'}</button>
              <button className="wa-btn wa-hint" onClick={() => setShowKo(v => !v)}>
                {showKo ? '🙈 뜻 숨기기' : '💡 뜻 보기'}
              </button>
            </div>
            <div className="wsc-stage-hint">잘 듣고 따라 말해 보세요!</div>
          </div>
        )}
        {stage === 'shadow' && (
          <div className="wa-card">
            <div className="ssc-sentence">{sentence}</div>
            <div className="wa-actions">
              <button className="wa-btn wa-listen" onClick={doShadow} disabled={playing}>{playing ? '재생 중...' : '🔊 듣기'}</button>
            </div>
            <div className="wsc-stage-hint">한 덩어리씩 듣고, 멈추면 따라 말해요!</div>
          </div>
        )}
        {stage === 'read' && (
          <div className="wa-card">
            <div className="ssc-sentence">{sentence}</div>
            <PronunceCheck
              word={sentence}
              azureKey={azureKey}
              azureRegion={azureRegion}
              speak={(t) => speak(t, '-10%')}
              onPass={(info) => {
                // 말하기(읽기)는 인식이 불안정 → ⚠️ 감점 없음, 첫 시도 성공만 졸업에 반영
                if (onSentenceResult && info && info.firstTry) onSentenceResult(sentence, true, '');
                passedRef.current = true; schedule(2000);
              }}
              onSkip={() => { cancel(); advance(); }}
              onPlaybackStart={cancel}
              onPlaybackEnd={() => { if (passedRef.current) schedule(2000); }}
              hideWord
              bare
            />
          </div>
        )}
      </div>

      <button className="wsc-nav-side wsc-prev" onClick={prev} disabled={si === 0 && stageIdx === 0} title="이전">‹</button>
      <button className="wsc-nav-side wsc-next" onClick={next} title="다음">›</button>
    </div>
  );
}
