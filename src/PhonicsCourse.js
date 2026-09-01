import React, { useState, useRef, useEffect, useMemo } from 'react';
import { STAGES, SOUND_INFO, aloneNote } from './phonicsData';
import { soundFile, wordsForSound, wordsWithoutSound, marksForSound, splitGraphemes } from './phonics';
import PronunceCheck from './PronunceCheck';
import { playPhonicsSound, stopPhonicsSound, preloadPhonicsSounds } from './phonicsAudio';
import { loadProgress, recordSound, starsOf, stageRatio, nextSound } from './phonicsProgress';
import useBackHandler from './useBackHandler';
import './PhonicsCourse.css';

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// 오답 보기로 쓸 단어 풀 (다른 소리들의 예시 단어)
const DISTRACTOR_POOL = Object.values(SOUND_INFO).flatMap(v => v.words);

// ─── 정답·오답 효과음 (음원 파일 없이 그 자리에서 만들어 냄) ───
let sfxCtx = null;
function sfx(kind) {
  try {
    if (!sfxCtx) sfxCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (sfxCtx.state === 'suspended') sfxCtx.resume();
    const now = sfxCtx.currentTime;
    const right = kind === 'right';
    const notes = right ? [784, 988, 1319] : [311, 233];   // 도미솔 느낌 / 낮게 두 번
    const step = right ? 0.085 : 0.16;
    const len = right ? 0.22 : 0.28;
    notes.forEach((freq, i) => {
      const osc = sfxCtx.createOscillator();
      const gain = sfxCtx.createGain();
      osc.type = right ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const t0 = now + i * step;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(right ? 0.22 : 0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      osc.connect(gain); gain.connect(sfxCtx.destination);
      osc.start(t0);
      osc.stop(t0 + len + 0.05);
    });
  } catch (e) { /* ignore */ }
}

/**
 * 파닉스 학습
 * props:
 *   allWords  등록된 모든 단어 (아이가 이미 배운 단어를 우선 사용)
 *   speak     단어 발음 함수 (Promise)
 *   stop      발음 중지
 *   onClose   나가기
 */
export default function PhonicsCourse({ allWords = [], speak, stop, azureKey, azureRegion, onClose }) {
  const [prog, setProg] = useState(loadProgress);
  // 처음 열 때는 아직 안 한 소리가 있는 단계를 펼쳐 둠
  const [openStage, setOpenStage] = useState(() => (nextSound(loadProgress()) || {}).stageId || 1);
  const [lesson, setLesson] = useState(null);   // { soundId } | null

  const cont = useMemo(() => nextSound(prog), [prog]);

  // 뒤로가기: 한 소리 학습 중이면 소리 지도로 (앱 홈으로 바로 나가지 않게)
  useBackHandler(() => {
    if (lesson) { if (stop) stop(); stopPhonicsSound(); setLesson(null); return true; }
    return false;
  });

  if (lesson) {
    return (
      <PhonicsLesson
        soundId={lesson.soundId}
        allWords={allWords}
        speak={speak}
        stop={stop}
        azureKey={azureKey}
        azureRegion={azureRegion}
        onDone={(percent) => {
          recordSound(lesson.soundId, percent);
          setProg(loadProgress());
          setLesson(null);
        }}
        onQuit={() => { if (stop) stop(); stopPhonicsSound(); setLesson(null); }}
      />
    );
  }

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <span className="pc-title">🔤 파닉스 학습</span>
        {onClose && <button className="pc-close" onClick={onClose}>✕</button>}
      </div>

      <p className="pc-lead">
        글자가 내는 <b>소리</b>를 하나씩 익혀요. 소리를 알면 처음 보는 단어도 읽을 수 있어요.
      </p>

      {cont && (
        <button className="pc-continue" onClick={() => setLesson({ soundId: cont.soundId })}>
          ▶️ 이어서 하기 — <b>{SOUND_INFO[cont.soundId]?.label}</b> 소리
        </button>
      )}

      <div className="pc-stages">
        {STAGES.map(stage => {
          const ratio = stageRatio(prog, stage);
          const expanded = openStage === stage.id;
          return (
            <div className="pc-stage" key={stage.id}>
              <button
                className="pc-stage-head"
                onClick={() => setOpenStage(expanded ? -1 : stage.id)}
              >
                <span className="pc-stage-icon">{stage.icon}</span>
                <span className="pc-stage-name">
                  <b>{stage.id}. {stage.name}</b>
                  <em>{stage.desc}</em>
                </span>
                <span className="pc-stage-ratio">
                  {stage.sounds.filter(id => starsOf(prog, id) > 0).length}/{stage.sounds.length}
                </span>
                <span className={`pc-stage-arrow ${expanded ? 'open' : ''}`}>▾</span>
              </button>
              <div className="pc-stage-bar"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
              {expanded && (
                <div className="pc-sounds">
                  {stage.sounds.map(id => {
                    const info = SOUND_INFO[id];
                    if (!info) return null;
                    const st = starsOf(prog, id);
                    return (
                      <button className={`pc-sound ${st ? 'done' : ''}`} key={id}
                        onClick={() => setLesson({ soundId: id })}>
                        <span className="pc-sound-label">{info.label}</span>
                        <span className="pc-sound-ko">{info.ko}</span>
                        <span className="pc-sound-stars">{'⭐'.repeat(st)}{'·'.repeat(3 - st)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 한 소리 학습: ① 소리 듣기 → ② 귀로 찾기 → ③ 눈으로 찾기
// ============================================================
const EAR_ROUNDS = 3;
const EYE_ROUNDS = 3;
const ORDER = ['listen', 'blend', 'ear', 'eye'];

function PhonicsLesson({ soundId, allWords, speak, stop, azureKey, azureRegion, onDone, onQuit }) {
  const info = SOUND_INFO[soundId] || { label: soundId, ko: '', tip: '', words: [] };
  const file = soundFile(soundId);

  // 이 소리가 든 단어 (아이가 배운 단어 우선) + 오답용 단어
  const targets = useMemo(
    () => wordsForSound(soundId, allWords, info.words, 8),
    [soundId, allWords, info.words]
  );
  const distractors = useMemo(
    () => wordsWithoutSound(soundId, shuffle([...allWords, ...DISTRACTOR_POOL]), 24),
    [soundId, allWords]
  );

  const [step, setStep] = useState('listen');   // listen | blend | ear | eye | done
  const [round, setRound] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [picked, setPicked] = useState(null);   // 이번 문제에서 고른 것
  const [busy, setBusy] = useState('');         // 재생 중인 버튼 키

  const runRef = useRef(0);
  const abortRef = useRef(false);

  useEffect(() => () => { abortRef.current = true; stopPhonicsSound(); if (stop) stop(); }, [stop]);

  // 이 소리와 예시 단어 조각들의 음원을 미리 준비해 둠
  useEffect(() => {
    const files = [file, ...targets.slice(0, 3).flatMap(w => splitGraphemes(w).map(ch => soundFile(ch.sound)))];
    preloadPhonicsSounds(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundId]);

  const begin = (key) => {
    const t = ++runRef.current;
    abortRef.current = false;
    setBusy(key);
    return t;
  };
  const end = (t) => { if (runRef.current === t) setBusy(''); };
  const stopAll = () => {
    runRef.current++;
    abortRef.current = true;
    stopPhonicsSound();
    if (stop) stop();
    setBusy('');
  };

  // 소리 음원 재생 (n회)
  const playSound = async (times = 3) => {
    if (busy) return;
    const t = begin('sound');
    let ok = true;
    for (let i = 0; i < times; i++) {
      if (abortRef.current) break;
      ok = await playPhonicsSound(file);
      if (!ok) break;
      if (i < times - 1) await new Promise(r => setTimeout(r, 1500)); // 따라 할 시간
    }
    if (!ok) setNoFile(true);
    end(t);
  };
  const [noFile, setNoFile] = useState(false);

  const playWord = async (w, key) => {
    if (busy || !speak) return;
    const t = begin(key);
    try { await speak(w); } catch (e) { /* ignore */ }
    if (!abortRef.current) await new Promise(r => setTimeout(r, 150));
    end(t);
  };

  // ── ② 블렌딩: 조각 소리를 점점 빠르게 이어 붙여 단어로 ──
  const blendWords = useMemo(() => targets.slice(0, 3), [targets]);
  const [blendIdx, setBlendIdx] = useState(0);
  const [blendPass, setBlendPass] = useState(-1);   // -1 대기, 0~2 진행, 3 합쳐짐
  const [blendActive, setBlendActive] = useState(-1);
  const [showMic, setShowMic] = useState(false);

  const blendWord = blendWords[blendIdx] || '';
  const blendChunks = useMemo(() => splitGraphemes(blendWord), [blendWord]);

  const BLEND_GAPS = [900, 450, 120];   // 천천히 → 조금 빠르게 → 붙여서
  const runBlend = async () => {
    if (busy || !blendChunks.length) return;
    const t = begin('blend');
    setShowMic(false);
    // 먼저 조각 음원을 모두 준비 (내려받기·디코딩 때문에 첫 소리가 밀리지 않게)
    await preloadPhonicsSounds(blendChunks.map(ch => soundFile(ch.sound)));
    if (abortRef.current) { end(t); return; }

    for (let pass = 0; pass < BLEND_GAPS.length; pass++) {
      if (abortRef.current) break;
      setBlendPass(pass);
      for (let ci = 0; ci < blendChunks.length; ci++) {
        if (abortRef.current) break;
        const ch = blendChunks[ci];
        if (ch.sound) {
          // 강조는 실제로 소리가 나기 시작할 때 (onStart)
          const ok = await playPhonicsSound(soundFile(ch.sound), () => setBlendActive(ci));
          if (!ok) { setNoFile(true); setBlendActive(ci); }
        } else {
          setBlendActive(ci);   // 묵음 글자는 소리 없이 잠깐 표시만
          await new Promise(r => setTimeout(r, 250));
        }
        await new Promise(r => setTimeout(r, BLEND_GAPS[pass]));
      }
      setBlendActive(-1);
      if (abortRef.current) break;
      await new Promise(r => setTimeout(r, 350));
    }
    if (!abortRef.current) {
      setBlendPass(3);                       // 조각이 하나로 합쳐짐
      await new Promise(r => setTimeout(r, 300));
      if (speak && !abortRef.current) await speak(blendWord);
    }
    end(t);
  };

  const gotoBlendWord = (i) => {
    stopAll();
    setBlendIdx(i);
    setBlendPass(-1);
    setBlendActive(-1);
    setShowMic(false);
  };

  // ── 문제 만들기 ──
  const earQ = useMemo(() => {
    if (step !== 'ear') return null;
    const target = targets[round % Math.max(1, targets.length)] || info.words[0];
    const wrong = shuffle(distractors).slice(0, 2);
    return { target, choices: shuffle([target, ...wrong]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, round, soundId]);

  // 글자 위치를 짚을 수 있는 단어들 (없으면 ③단계를 건너뜀)
  const eyePool = useMemo(
    () => targets.filter(w => marksForSound(w, soundId).length > 0),
    [targets, soundId]
  );
  const hasEye = eyePool.length > 0;

  const eyeQ = useMemo(() => {
    if (step !== 'eye' || !hasEye) return null;
    const word = eyePool[round % eyePool.length];
    return { word, marks: marksForSound(word, soundId) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, round, soundId, hasEye]);

  const answer = (isRight, autoNext = true) => {
    setPicked(isRight ? 'right' : 'wrong');
    sfx(isRight ? 'right' : 'wrong');
    if (isRight) setCorrect(c => c + 1);
    if (!autoNext) return;
    setTimeout(() => {
      setPicked(null);
      const limit = step === 'ear' ? EAR_ROUNDS : EYE_ROUNDS;
      if (round + 1 >= limit) {
        setRound(0);
        setStep(step === 'ear' ? (hasEye ? 'eye' : 'done') : 'done');
      } else {
        setRound(r => r + 1);
      }
    }, isRight ? 900 : 1400);
  };

  const total = EAR_ROUNDS + (hasEye ? EYE_ROUNDS : 0);
  const percent = Math.round((correct / total) * 100);

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <button className="pc-back" onClick={onQuit}>← 돌아가기</button>
        <span className="pc-lesson-title"><b>{info.label}</b> 소리</span>
        <span className="pc-steps">
          {(hasEye ? ORDER : ORDER.filter(s => s !== 'eye')).map((s, i) => (
            <i key={s} className={step === s ? 'on' : (ORDER.indexOf(step) > ORDER.indexOf(s) ? 'done' : '')} />
          ))}
        </span>
      </div>

      {/* ① 소리 듣기 */}
      {step === 'listen' && (
        <div className="pc-panel">
          <div className="pc-big">{info.label}</div>
          <div className="pc-ko">{info.ko}</div>
          <div className="pc-tip">💡 {info.tip}</div>
          {aloneNote(soundId) && (
            <div className="pc-alone">🎧 {aloneNote(soundId)}</div>
          )}
          {busy === 'sound' ? (
            <button className="pc-main-btn" onClick={stopAll}>⏹️ 멈춤</button>
          ) : (
            <button className="pc-main-btn" onClick={() => playSound(3)} disabled={!!busy}>🔈 소리 듣기</button>
          )}
          {noFile && <div className="pc-nofile">아직 이 소리의 음원이 등록되지 않았어요. (설정에서 올릴 수 있어요)</div>}

          <div className="pc-sub">이 소리가 들어간 단어예요</div>
          <div className="pc-word-row">
            {targets.slice(0, 4).map((w, i) => {
              const marks = marksForSound(w, soundId);
              return (
                <button className="pc-word-card" key={w}
                  onClick={() => busy === 'w' + i ? stopAll() : playWord(w, 'w' + i)}
                  disabled={!!busy && busy !== 'w' + i}>
                  <span className="pc-word-text">
                    {w.split('').map((c, ci) => (
                      <span key={ci} className={marks.includes(ci) ? 'mark' : ''}>{c}</span>
                    ))}
                  </span>
                  <span className="pc-word-play">{busy === 'w' + i ? '⏹️' : '🔊'}</span>
                </button>
              );
            })}
          </div>

          <button className="pc-next-btn" onClick={() => { stopAll(); setPicked(null); gotoBlendWord(0); setStep('blend'); }}>
            다 들었어요 →
          </button>
        </div>
      )}

      {/* ② 블렌딩 — 조각 소리를 이어 붙여 단어로 */}
      {step === 'blend' && blendWord && (
        <div className="pc-panel">
          <div className="pc-q">소리를 이어 붙이면 단어가 돼요</div>
          <div className="pc-q-hint">조각이 하나씩 소리 나고, 점점 빨라지다 한 단어가 돼요.</div>

          <div className={`pc-blend pass${blendPass < 0 ? 0 : blendPass}`}>
            {blendChunks.map((ch, ci) => (
              <span
                key={ci}
                className={`pc-chunk ${ch.silent ? 'silent' : ''} ${blendActive === ci ? 'active' : ''}`}
              >
                {ch.text}
              </span>
            ))}
          </div>
          {blendPass === 3 && <div className="pc-blend-word">{blendWord}</div>}

          <div className="pc-blend-btns">
            {busy === 'blend' ? (
              <button className="pc-main-btn" onClick={stopAll}>⏹️ 멈춤</button>
            ) : (
              <button className="pc-main-btn" onClick={runBlend} disabled={!!busy}>
                {blendPass === 3 ? '🔁 다시 이어 보기' : '▶️ 이어 보기'}
              </button>
            )}
            {azureKey && azureRegion && blendPass === 3 && !showMic && (
              <button className="pc-mic-btn" onClick={() => { stopAll(); setShowMic(true); }}>
                🎤 내가 읽어 볼래
              </button>
            )}
          </div>

          {noFile && <div className="pc-nofile">아직 소리 음원이 등록되지 않았어요. (설정에서 올릴 수 있어요)</div>}

          {showMic && (
            <div className="pc-mic-panel">
              <PronunceCheck word={blendWord} azureKey={azureKey} azureRegion={azureRegion} speak={speak} />
              <button className="pc-again-btn" onClick={() => setShowMic(false)}>닫기</button>
            </div>
          )}

          <div className="pc-blend-nav">
            {blendWords.map((w, i) => (
              <button key={w} className={`pc-blend-dot ${i === blendIdx ? 'on' : ''}`}
                onClick={() => gotoBlendWord(i)}>{i + 1}</button>
            ))}
            {blendIdx < blendWords.length - 1 ? (
              <button className="pc-next-btn small" onClick={() => gotoBlendWord(blendIdx + 1)}>
                다음 단어 →
              </button>
            ) : (
              <button className="pc-next-btn small" onClick={() => { stopAll(); setShowMic(false); setPicked(null); setStep('ear'); setRound(0); }}>
                퀴즈 풀러 가기 →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ② 귀로 찾기 — 글자를 보지 않고 소리로만 고르기 */}
      {step === 'ear' && earQ && (
        <div className="pc-panel">
          <div className="pc-q">
            <b>{info.label}</b> ({info.ko}) 소리가 들어간 단어는 어느 것일까요?
          </div>
          <div className="pc-q-hint">먼저 🔊를 눌러 들어 보고, 맞다고 생각하면 아래를 눌러요.</div>
          <div className="pc-choices">
            {earQ.choices.map((w, i) => {
              const isAnswer = picked && w === earQ.target;
              return (
                <div className={`pc-choice ${isAnswer ? 'right' : ''}`} key={w + i}>
                  <div className="pc-choice-face">{picked ? w : '❓'}</div>
                  <button className="pc-choice-play"
                    onClick={() => busy === 'c' + i ? stopAll() : playWord(w, 'c' + i)}
                    disabled={!!busy && busy !== 'c' + i}>
                    {busy === 'c' + i ? '⏹️' : '🔊 듣기'}
                  </button>
                  <button className="pc-choice-pick" disabled={!!picked || !!busy}
                    onClick={() => { stopAll(); answer(w === earQ.target); }}>
                    이거예요!
                  </button>
                </div>
              );
            })}
          </div>
          {picked && (
            <div className={`pc-result ${picked}`}>
              {picked === 'right' ? '🎉 맞았어요!' : `아쉬워요. 정답은 ${earQ.target}`}
            </div>
          )}
          <div className="pc-round">{round + 1} / {EAR_ROUNDS}</div>
        </div>
      )}

      {/* ③ 눈으로 찾기 — 소리를 내는 글자를 짚기 */}
      {step === 'eye' && eyeQ && (
        <div className="pc-panel">
          <div className="pc-q">
            <b>{eyeQ.word}</b> 에서 <b>{info.ko}</b> 소리를 내는 글자를 눌러 보세요
          </div>
          <div className="pc-eye-word">
            {eyeQ.word.split('').map((c, ci) => (
              <button className={`pc-letter ${picked && eyeQ.marks.includes(ci) ? 'mark' : ''}`} key={ci}
                disabled={!!picked}
                onClick={() => answer(eyeQ.marks.includes(ci))}>
                {c}
              </button>
            ))}
          </div>
          <button className="pc-listen-small"
            onClick={() => busy === 'eyew' ? stopAll() : playWord(eyeQ.word, 'eyew')}
            disabled={!!busy && busy !== 'eyew'}>
            {busy === 'eyew' ? '⏹️ 멈춤' : '🔊 단어 들어 보기'}
          </button>
          {picked && (
            <div className={`pc-result ${picked}`}>
              {picked === 'right' ? '🎉 맞았어요!' : '아쉬워요. 주황색이 정답이에요.'}
            </div>
          )}
          <div className="pc-round">{round + 1} / {EYE_ROUNDS}</div>
        </div>
      )}

      {/* 마무리 */}
      {step === 'done' && (
        <div className="pc-panel pc-done">
          <div className="pc-done-stars">
            {'⭐'.repeat(percent >= 90 ? 3 : percent >= 70 ? 2 : percent >= 40 ? 1 : 0) || '🌱'}
          </div>
          <div className="pc-done-title"><b>{info.label}</b> 소리 끝!</div>
          <div className="pc-done-score">{total}개 중 {correct}개 맞았어요</div>
          <div className="pc-done-btns">
            <button className="pc-next-btn" onClick={() => onDone(percent)}>소리 지도로</button>
            <button className="pc-again-btn" onClick={() => { setStep('listen'); setRound(0); setCorrect(0); setPicked(null); gotoBlendWord(0); }}>
              🔁 한 번 더
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
