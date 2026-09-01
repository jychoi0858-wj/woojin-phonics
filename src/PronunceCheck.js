import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { isSpeechMatch } from './speechMatch';
import { stopCachedAudio } from './ttsCache';
import './WordActivities.css';

// 단어 발음 평가 (독립 컴포넌트)
// props: word(필수), azureKey, azureRegion, speak(선택), onPass(선택)

// 정답 효과음 (밝은 상승음)
function playSuccessChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.17);
    });
    setTimeout(() => { try { ctx.close(); } catch (e) { /* */ } }, 900);
  } catch (e) { /* ignore */ }
}

// 인식 텍스트 정리: 삽입 단어 제외 + 연속 중복 단어 합치기
function cleanRecognizedText(validWords, fallbackText) {
  let tokens = [];
  if (validWords && validWords.length > 0) {
    tokens = validWords.map(w => w.Word).filter(Boolean);
  } else if (fallbackText) {
    tokens = fallbackText.trim().split(/\s+/);
  }
  const out = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if (!prev || prev.toLowerCase() !== t.toLowerCase()) out.push(t);
  }
  return out.join(' ');
}

export default function PronunceCheck({ word, azureKey, azureRegion, speak, onPass, onSkip, hideWord, bare, onPlaybackStart, onPlaybackEnd }) {
  const target = (word || '').toLowerCase().trim();
  const display = (word || '').trim(); // 원래 대소문자 유지
  const [attempts, setAttempts] = useState(0);
  const [listening, setListening] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [recUrl, setRecUrl] = useState(null);
  const [playingRec, setPlayingRec] = useState(false);
  const [playingTts, setPlayingTts] = useState(false); // 정답 음성 재생 중

  const recognizerRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  // 단어 바뀌면 초기화
  const passedOnceRef = useRef(false); // 통과 기록 1회 제한
  useEffect(() => {
    setResult(null); setFeedback(''); setRecUrl(null); setListening(false); setReady(false); setAttempts(0);
    passedOnceRef.current = false;
    heardRef.current = ''; scoresRef.current = []; finishingRef.current = false;
  }, [target]);

  const streamRef = useRef(null); // 마이크 스트림 (해제 보장용)
  const heardRef = useRef('');        // 연속 인식으로 모은 텍스트
  const scoresRef = useRef([]);       // 발음 점수 (pron 모드)
  const modeRef = useRef('word');     // 시작 시점 판정 모드
  const finishingRef = useRef(false); // 종료 중복 방지
  const safetyTimerRef = useRef(null);// 2분 방치 안전장치

  const cleanup = useCallback(() => {
    setListening(false); setReady(false);
    if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
    if (recognizerRef.current) { try { recognizerRef.current.close(); } catch (e) { /* */ } recognizerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop(); } catch (e) { /* */ } }
    recorderRef.current = null;
    // MediaRecorder가 없거나 실패해도 마이크는 반드시 끔
    if (streamRef.current) { try { streamRef.current.getTracks().forEach(t => t.stop()); } catch (e) { /* */ } streamRef.current = null; }
  }, []);

  // 화면을 벗어나거나 단어가 바뀌면 마이크 정리 (켜진 채 남지 않게)
  useEffect(() => cleanup, [cleanup]);
  useEffect(() => () => cleanup(), [target, cleanup]);

  const start = async () => {
    // 키 미설정 — 아이에게 alert 대신 화면 안내 + 넘어갈 수 있게 시도 횟수 증가
    if (!azureKey || !azureRegion) {
      setFeedback('지금은 읽기 평가를 쓸 수 없어요. 넘어가도 괜찮아요!');
      setAttempts(a => a + 1);
      return;
    }
    setListening(true); setReady(false); setResult(null); setFeedback(''); setRecUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        setRecUrl(URL.createObjectURL(blob));
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* */ }
        if (streamRef.current === stream) streamRef.current = null;
      };
      rec.start();
      recorderRef.current = rec;
    } catch (e) {
      // 녹음 실패해도 평가는 진행하되, 열린 스트림은 반드시 해제
      if (streamRef.current) { try { streamRef.current.getTracks().forEach(t => t.stop()); } catch (e2) { /* */ } streamRef.current = null; }
    }

    try {
      const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      sc.speechRecognitionLanguage = 'en-US';
      sc.setProperty(speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '6000');
      sc.setProperty(speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '3500');
      const mode = localStorage.getItem('woojin-judge-mode') || 'word';
      const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
      const recog = new speechsdk.SpeechRecognizer(sc, audioConfig);
      // 목표 단어를 인식 힌트로 제공 (PhraseList) — 비슷한 발음을 목표 단어로 우선 인식
      try { speechsdk.PhraseListGrammar.fromRecognizer(recog).addPhrase(target); } catch (e) { /* */ }
      // 발음 판정 모드에서만 발음평가 설정 적용
      // (단어 판정에 적용하면 Azure가 res.text를 기준 단어로 맞춰버려 아무 말이나 통과되는 버그)
      if (mode === 'pron') {
        const pc = new speechsdk.PronunciationAssessmentConfig(
          target,
          speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
          speechsdk.PronunciationAssessmentGranularity.Phoneme,
          false
        );
        pc.applyTo(recog);
      }
      recognizerRef.current = recog;
      recog.sessionStarted = () => setTimeout(() => setReady(true), 600); // 초기 잡음 구간(0.6초) 이후에 말하도록

      // ─── 연속 인식: 묵음으로 끊지 않음 — [다 말했어요]를 눌러야 채점 ───
      // (천천히·끊어 말해도 중간에 꺼지지 않게. "퍼~스트"처럼 늘려 말해도 이어붙여 판정)
      heardRef.current = '';
      scoresRef.current = [];
      modeRef.current = mode;

      recog.recognized = (s, e) => {
        if (!e || !e.result || e.result.reason !== speechsdk.ResultReason.RecognizedSpeech) return;
        const t = (e.result.text || '').trim();
        if (t) heardRef.current = (heardRef.current + ' ' + t).trim();
        if (mode === 'pron') {
          try {
            const pr = speechsdk.PronunciationAssessmentResult.fromResult(e.result);
            if (pr && typeof pr.accuracyScore === 'number') scoresRef.current.push(pr.accuracyScore);
          } catch (e2) { /* */ }
        }
      };

      recog.startContinuousRecognitionAsync(
        () => { /* 시작됨 */ },
        (err) => {
          console.error('발음 평가 에러:', err);
          setAttempts(a => a + 1); // 마이크 거부·네트워크 오류에서도 막히지 않게
          setFeedback('마이크를 쓸 수 없어요. 넘어가도 괜찮아요!');
          cleanup();
        }
      );

      // 안전장치: 2분간 방치되면 자동 정리 (마이크가 켜진 채 남지 않게)
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => { if (recognizerRef.current) finish(); }, 120000);
    } catch (e) {
      console.error(e);
      setAttempts(a => a + 1);
      setFeedback('읽기 평가를 시작할 수 없어요. 넘어가도 괜찮아요!');
      cleanup();
    }
  };

  // ─── [다 말했어요] → 인식 종료 + 채점 ───
  const finish = () => {
    if (finishingRef.current) return; // 이중 호출 방지
    finishingRef.current = true;
    if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
    const recog = recognizerRef.current;
    recognizerRef.current = null;
    const mode = modeRef.current;

    const evaluate = () => {
      finishingRef.current = false;
      const cleanText = cleanRecognizedText([], heardRef.current);
      if (!cleanText.trim()) {
        setResult(null);
        setAttempts(a => a + 1); // 실패도 시도로 계산 → 넘어가기 버튼 노출
        setFeedback('목소리를 인식하지 못했어요. 다시 해볼까요?');
        cleanup();
        return;
      }
      let ok, score;
      if (mode === 'pron') {
        const arr = scoresRef.current;
        score = arr.length ? Math.round(Math.max(...arr)) : 0; // 끊어 말해도 최고점 기준
        const threshold = parseInt(localStorage.getItem('woojin-pass-threshold')) || 60;
        ok = score >= threshold;
      } else {
        ok = isSpeechMatch(cleanText, target); // 알맞은 단어를 말했는가 (쪼개진 인식도 병합 판정)
      }
      setResult({ text: cleanText, ok, mode, score });
      if (ok) {
        playSuccessChime(); setFeedback('정답!');
        if (onPass && !passedOnceRef.current) {
          passedOnceRef.current = true;
          onPass({ firstTry: attempts === 0, attempts, score, mode });
        }
      } else { setAttempts(a => a + 1); setFeedback('다시 도전해보세요!'); }
      cleanup();
    };

    if (recog) {
      try {
        recog.stopContinuousRecognitionAsync(
          () => { try { recog.close(); } catch (e) { /* */ } evaluate(); },
          () => { try { recog.close(); } catch (e) { /* */ } evaluate(); }
        );
      } catch (e) { try { recog.close(); } catch (e2) { /* */ } evaluate(); }
    } else {
      evaluate();
    }
  };

  const stopListening = () => { cleanup(); };

  const playRec = () => {
    if (!recUrl || playingTts) return;
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(recUrl); audioRef.current = a;
    setPlayingRec(true);
    if (onPlaybackStart) onPlaybackStart(); // 내 발음 재생 시작 (자동 넘김 일시정지)
    a.onended = () => { setPlayingRec(false); if (onPlaybackEnd) onPlaybackEnd(); };
    a.onerror = () => { setPlayingRec(false); if (onPlaybackEnd) onPlaybackEnd(); };
    // 녹음 시작부 마이크 잡음(스~/치~) 건너뛰기
    a.onloadedmetadata = () => {
      try { if (isFinite(a.duration) && a.duration > 1.0) a.currentTime = 0.6; } catch (e) { /* */ }
    };
    a.play();
  };
  const stopRec = () => {
    if (audioRef.current) { audioRef.current.pause(); setPlayingRec(false); if (onPlaybackEnd) onPlaybackEnd(); }
  };

  // ─── 듣기(정답 음성) 재생 / 멈춤 ───
  const playTts = async () => {
    if (!speak || playingTts) return;
    setPlayingTts(true);
    if (onPlaybackStart) onPlaybackStart(); // 자동 넘김 일시정지
    try { await speak(target); } catch (e) { /* */ }
    setPlayingTts(false);
    if (onPlaybackEnd) onPlaybackEnd();
  };
  const stopTts = () => {
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    setPlayingTts(false);
    if (onPlaybackEnd) onPlaybackEnd();
  };

  return (
    <div className={bare ? 'wa-pron-bare' : 'wa-card'}>
      {!hideWord && <div className="wa-pronounce-word">{display}</div>}

      <div className="wa-actions" style={{ marginBottom: 8 }}>
        {listening ? (
          /* 묵음으로 끊기지 않음 — 다 말하고 직접 눌러야 채점 */
          <button
            className="wa-btn"
            style={{ background: ready ? '#2e9e5b' : '#9e9e9e', color: '#fff', minWidth: 150 }}
            onClick={finish}
            disabled={!ready}
          >
            {ready ? '✅ 다 말했어요' : '⏳ 준비 중...'}
          </button>
        ) : (
          /* 듣는 중에는 말하기 잠금 (재생 소리가 마이크로 들어가지 않게) */
          <button className="wa-btn" style={{ background: playingTts ? '#c9c9c9' : '#ff8a3d', color: '#fff', minWidth: 120 }}
            onClick={start} disabled={playingTts}>
            🎤 말하기
          </button>
        )}
        {speak && (
          playingTts
            ? <button className="wa-btn wa-reset" onClick={stopTts}>⏹️ 멈춤</button>
            : <button className="wa-btn wa-listen" onClick={playTts} disabled={listening}>🔊 듣기</button>
        )}
        {recUrl && !listening && (
          playingRec
            ? <button className="wa-btn wa-reset" onClick={stopRec}>⏹️ 중지</button>
            : <button className="wa-btn wa-reset" onClick={playRec} disabled={playingTts}>🔊 내 발음</button>
        )}
      </div>

      {feedback && (
        <div className="wa-pron-feedback" style={{ color: feedback === '정답!' ? '#2e9e5b' : '#e67e22' }}>
          {feedback}
        </div>
      )}

      {/* 1번만 시도해도 넘어갈 수 있게 (인식이 잘 안 될 때) */}
      {attempts >= 1 && onSkip && (!result || !result.ok) && (
        <button className="wa-btn" style={{ background: '#9e9e9e', color: '#fff', marginTop: 6 }} onClick={onSkip}>
          넘어가기 →
        </button>
      )}

      {result && (
        <div className="wa-pron-result">
          {result.mode === 'pron'
            ? <div className="wa-pron-total" style={{ color: result.ok ? '#2e9e5b' : '#d14848', fontSize: '1.8rem', fontWeight: 800 }}>{result.score}점</div>
            : (result.ok && <div style={{ fontSize: '2.4rem' }}>🌟</div>)}
          {result.text && <div className="wa-pron-recognized">인식된 단어: <strong>{result.text}</strong></div>}
        </div>
      )}
    </div>
  );
}
