import React, { useState, useRef, useEffect, useMemo } from 'react';
import { STAGES, SOUND_INFO, aloneNote, chunkNote } from './phonicsData';
import { soundFile, wordsForSound, wordsWithoutSound, marksForSound, splitGraphemes, wordHasSound, checkWordForSound } from './phonics';
import { customWordsOf, addCustomWord, removeCustomWord } from './phonicsWords';
import { pushPhonics, subscribePhonicsSync } from './phonicsSync';
import PronunceCheck from './PronunceCheck';
import { playPhonicsSound, stopPhonicsSound, preloadPhonicsSounds, playPhonicsSequence, phonicsDuration } from './phonicsAudio';
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

  // 계정 동기화가 끝나면 화면을 다시 그림
  useEffect(() => subscribePhonicsSync(() => setProg(loadProgress())), []);

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
          pushPhonics();                 // 계정에 저장
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
// 연습 단어 추가 팝업
//   등록된 단어와 기본 예시에서 골라 넣거나, 직접 타이핑해서 넣는다.
// ============================================================
function AddWordModal({ soundId, info, allWords = [], myWords = [], speak, onChange, onClose }) {
  const [q, setQ] = useState('');
  const [saying, setSaying] = useState('');
  const typed = q.toLowerCase().trim().replace(/[^a-z' -]/g, '');

  // 고를 수 있는 후보 — 등록된 단어 + 이 소리의 기본 예시 (이미 넣은 건 제외)
  const candidates = useMemo(() => {
    const seen = new Set(myWords);
    const out = [];
    for (const w of [...allWords, ...(info.words || [])]) {
      const n = (w || '').toLowerCase().trim();
      if (!n || n.length < 2 || seen.has(n)) continue;
      if (!wordHasSound(n, soundId)) continue;   // 이 소리가 없는 단어는 후보에서 뺌
      seen.add(n);
      out.push(n);
    }
    return out;
  }, [allWords, info.words, myWords, soundId]);

  const shown = useMemo(() => {
    if (!typed) return candidates.slice(0, 24);
    return candidates.filter(w => w.includes(typed)).slice(0, 24);
  }, [candidates, typed]);

  // 입력한 단어를 이 소리 연습에 쓸 수 있는지 (쓸 수 없으면 이유를 알려 줌)
  const isNew = typed.length >= 1 && !myWords.includes(typed) && !shown.includes(typed);
  const check = isNew && typed.length >= 1 ? checkWordForSound(typed, soundId, info.label) : null;

  const add = (w) => { onChange(addCustomWord(soundId, w)); setQ(''); pushPhonics(); };
  const drop = (w) => { onChange(removeCustomWord(soundId, w)); pushPhonics(); };
  const preview = async (w) => {
    if (!speak || saying) return;
    setSaying(w);
    try { await speak(w); } catch (e) { /* ignore */ }
    setSaying('');
  };

  return (
    <div className="pc-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-add-modal">
        <div className="pc-add-head">
          <span>➕ <b>{info.label}</b> 소리 연습 단어</span>
          <button className="pc-close" onClick={onClose}>✕</button>
        </div>

        <input
          className="pc-add-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="영어 단어를 입력해 찾거나 새로 넣어요"
          autoFocus
        />

        {check && (
          check.ok ? (
            <button className="pc-add-typed" onClick={() => add(typed)}>
              ➕ <b>{typed}</b> 넣기
              <em className="pc-add-chunks">
                소리 조각: {check.chunks.map(c => c.silent ? `${c.text}(묵음)` : c.text).join(' · ')}
              </em>
            </button>
          ) : (
            <div className="pc-add-typed warn cannot">
              <span>⚠️ <b>{typed}</b> 는 넣을 수 없어요</span>
              <em>{check.text}</em>
            </div>
          )
        )}

        {myWords.length > 0 && (
          <>
            <div className="pc-add-label">내가 넣은 단어</div>
            <div className="pc-add-list">
              {myWords.map(w => (
                <span className="pc-add-chip mine" key={w}>
                  <button className="pc-chip-say" onClick={() => preview(w)} disabled={!!saying}>
                    {saying === w ? '🔊' : '🔉'}
                  </button>
                  {w}
                  <button className="pc-chip-del" onClick={() => drop(w)}>✕</button>
                </span>
              ))}
            </div>
          </>
        )}

        <div className="pc-add-label">
          {typed ? `"${typed}" 로 찾은 단어` : '등록된 단어와 기본 예시에서 고르기'}
        </div>
        <div className="pc-add-list">
          {shown.length === 0 ? (
            <span className="pc-add-empty">찾은 단어가 없어요. 위에 직접 입력해 보세요.</span>
          ) : shown.map(w => (
            <button className="pc-add-chip" key={w} onClick={() => add(w)}>+ {w}</button>
          ))}
        </div>

        <button className="pc-next-btn" onClick={onClose}>다 넣었어요</button>
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

  // 직접 추가한 단어 (부모가 넣은 것 — 가장 먼저 씀)
  const [myWords, setMyWords] = useState(() => customWordsOf(soundId));
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { setMyWords(customWordsOf(soundId)); }, [soundId]);

  // 이 소리가 든 단어 (직접 추가 → 아이가 배운 단어 → 기본 예시)
  const targets = useMemo(
    () => wordsForSound(soundId, [...myWords, ...allWords], info.words, 8),
    [soundId, myWords, allWords, info.words]
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

  // 천천히 → 조금 빠르게 → 붙여서
  //   마지막 패스는 앞 소리가 끝나기 전에 다음 조각을 시작해 실제로 이어 읽는 소리에 가깝게 만든다.
  const BLEND_GAPS = [900, 420, 60];    // 조각 소리가 끝난 뒤 쉬는 시간(ms)
  const FAST_HOLD = 0.36;               // 마지막 패스: 조각 하나에 쓰는 최대 시간(초)
  const SILENT_HOLD = 0.28;             // 묵음 글자를 보여 주는 시간(초)
  const runBlend = async () => {
    if (busy || !blendChunks.length) return;
    const t = begin('blend');
    setShowMic(false);
    // 먼저 조각 음원을 모두 준비 (내려받기·디코딩 때문에 첫 소리가 밀리지 않게)
    await preloadPhonicsSounds(blendChunks.map(ch => soundFile(ch.sound)));
    if (abortRef.current) { end(t); return; }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // 조각마다 실제 음원 길이를 알아 둔다 (길이가 300~900ms로 제각각이라 고정 간격은 어긋남)
    const durs = blendChunks.map(ch => phonicsDuration(soundFile(ch.sound)) || SILENT_HOLD);
    if (blendChunks.some(ch => ch.sound && !phonicsDuration(soundFile(ch.sound)))) setNoFile(true);

    for (let pass = 0; pass < BLEND_GAPS.length; pass++) {
      if (abortRef.current) break;
      setBlendPass(pass);
      const fast = pass === BLEND_GAPS.length - 1;   // 마지막은 붙여 읽기
      const gapSec = BLEND_GAPS[pass] / 1000;

      const items = blendChunks.map((ch, i) => ({
        file: soundFile(ch.sound),
        // 앞 두 패스: 소리를 끝까지 들려주고 쉼 / 마지막: 소리가 끝나기 전에 다음 조각으로
        hold: ch.sound
          ? (fast ? Math.min(durs[i], FAST_HOLD) + gapSec : durs[i] + gapSec)
          : SILENT_HOLD + gapSec,
      }));

      // 소리와 강조를 같은 오디오 클럭에 함께 예약 → 싱크가 어긋나지 않음
      await playPhonicsSequence(items, (i) => setBlendActive(i));
      if (abortRef.current) break;
      setBlendActive(-1);
      // 마지막 패스 뒤에는 거의 쉬지 않는다 — 조각 소리에서 단어로 바로 이어지게
      await sleep(fast ? 60 : 300);
    }
    if (!abortRef.current) {
      setBlendPass(3);                       // 조각이 하나로 합쳐짐
      await new Promise(r => setTimeout(r, 110));
      if (speak && !abortRef.current) await speak(blendWord);
    }
    end(t);
  };

  // 조각마다 알아 둘 점 (설명할 게 있는 조각만)
  const blendNotes = useMemo(() => {
    return blendChunks
      .map((ch, i) => ({ i, text: chunkNote(ch, i, blendChunks) }))
      .filter(n => n.text);
  }, [blendChunks]);

  // 조각 하나만 눌러서 소리 듣기
  const playChunk = async (ch, ci) => {
    if (busy) { stopAll(); return; }
    const t = begin('chunk' + ci);
    setBlendActive(ci);
    if (ch.sound) {
      const ok = await playPhonicsSound(soundFile(ch.sound), () => setBlendActive(ci));
      if (!ok) setNoFile(true);
    } else {
      await new Promise(r => setTimeout(r, 400));   // 묵음 조각
    }
    if (!abortRef.current) await new Promise(r => setTimeout(r, 150));
    setBlendActive(-1);
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

          <div className="pc-sub">
            이 소리가 들어간 단어예요
            <button className="pc-add-word" onClick={() => { stopAll(); setShowAdd(true); }}>➕ 단어 추가</button>
          </div>
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

          {showAdd && (
            <AddWordModal
              soundId={soundId}
              info={info}
              allWords={allWords}
              myWords={myWords}
              speak={speak}
              onChange={setMyWords}
              onClose={() => setShowAdd(false)}
            />
          )}
        </div>
      )}

      {/* ② 블렌딩 — 조각 소리를 이어 붙여 단어로 */}
      {step === 'blend' && blendWord && (
        <div className="pc-panel">
          <div className="pc-q">소리를 이어 붙이면 단어가 돼요</div>
          <div className="pc-q-hint">조각이 하나씩 소리 나고, 점점 빨라지다 한 단어가 돼요. 조각을 눌러 하나씩 들어 볼 수도 있어요.</div>

          <div className={`pc-blend pass${blendPass < 0 ? 0 : blendPass}`}>
            {blendChunks.map((ch, ci) => (
              <button
                key={ci}
                className={`pc-chunk ${ch.silent ? 'silent' : ''} ${blendActive === ci ? 'active' : ''} ${ch.sound === soundId ? 'target' : ''}`}
                onClick={() => playChunk(ch, ci)}
                disabled={!!busy && busy !== 'chunk' + ci}
                title="눌러서 이 조각 소리만 듣기"
              >
                {ch.text}
              </button>
            ))}
          </div>
          {blendPass === 3 && <div className="pc-blend-word">{blendWord}</div>}

          {/* 조각마다 알아 둘 점 — 묵음, 겹자음, 혼자 낼 때 다른 소리 등 */}
          {blendNotes.length > 0 && (
            <div className="pc-chunk-notes">
              {blendNotes.map(n => (
                <div className={`pc-chunk-note ${blendActive === n.i ? 'on' : ''}`} key={n.i}>
                  <span className={`pc-note-chunk ${blendChunks[n.i].silent ? 'silent' : ''}`}>
                    {blendChunks[n.i].text}
                  </span>
                  <span className="pc-note-text">{n.text}</span>
                </div>
              ))}
            </div>
          )}

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
