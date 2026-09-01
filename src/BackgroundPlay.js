import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { addSpeechUsageFirestore } from './firebase';
import { getCachedAudio, setCachedAudio, makeCacheKey } from './ttsCache';
import './BackgroundPlay.css';

// 잠금화면·백그라운드 반복 재생
// 핵심: JS 타이머로 곡을 이어붙이지 않고, 선택 문장 + 간격(침묵)을 하나의 WAV로 합쳐
// 단일 <audio> 로 재생(loop) + MediaSession → 화면 잠금/멀티태스킹 중에도 유지됨
//
// props: open, onClose, days(현재 월 레슨[]), azureKey, azureRegion, azureVoice, azureVerified, ttsLimitReached

// 아주 짧은 무음 WAV (사용자 제스처 내에서 audio element 잠금해제용)
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

// Float32 → 16bit PCM WAV Blob
function encodeWav(samples, sampleRate) {
  const len = samples.length;
  const buf = new ArrayBuffer(44 + len * 2);
  const view = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, 'data'); view.setUint32(40, len * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    o += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

// 여러 WAV(Uint8Array) + 문장 사이 간격(침묵) → 하나의 WAV Blob
async function buildPlaylistBlob(clips, gapSec) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buffers = [];
    for (const wav of clips) {
      const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
      // eslint-disable-next-line no-await-in-loop
      const decoded = await ctx.decodeAudioData(ab);
      buffers.push(decoded);
    }
    const sr = ctx.sampleRate;
    const gapLen = Math.round(gapSec * sr);
    let total = 0;
    buffers.forEach(b => { total += b.length + gapLen; });
    const out = new Float32Array(total);
    let off = 0;
    buffers.forEach(b => {
      out.set(b.getChannelData(0), off);
      off += b.length + gapLen; // 간격은 0(무음)으로 둠
    });
    return encodeWav(out, sr);
  } finally {
    try { ctx.close(); } catch (e) { /* ignore */ }
  }
}

const SPEEDS = [
  { label: '아주 느리게', value: '-50%' },
  { label: '느리게', value: '-35%' },
  { label: '조금 느리게', value: '-20%' },
  { label: '보통', value: '+0%' },
  { label: '빠르게', value: '+15%' },
];
const SENT_REPEATS = [1, 2, 3, 5, 10];      // 문장 반복: 각 문장을 N번 재생 후 다음으로
const REPEATS = [1, 2, 3, 5, 10, Infinity]; // 전체 반복: 리스트 전체를 N번
const GAPS = [1, 2, 3];

export default function BackgroundPlay({
  open, onClose, days = [],
  azureKey, azureRegion, azureVoice, azureVerified, ttsLimitReached = false,
}) {
  const azureReady = !!(azureVerified && azureKey && azureRegion);

  // 현재 월의 모든 문장을 평탄화
  const flatList = useMemo(() => {
    const out = [];
    (days || []).forEach((d) => {
      (d.sentences || []).forEach((s) => {
        const text = (typeof s === 'string' ? s : s?.text) || '';
        if (text.trim()) out.push({ lesson: d.name, text: text.trim() });
      });
    });
    return out;
  }, [days]);

  const [checked, setChecked] = useState([]);
  const [speed, setSpeed] = useState('-20%');
  const [sentRepeat, setSentRepeat] = useState(1); // 문장 반복
  const [repeat, setRepeat] = useState(Infinity);  // 전체 반복
  const [gap, setGap] = useState(2);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');

  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const playCountRef = useRef(0);

  // open 시 선택 초기화 (전체 선택)
  useEffect(() => {
    if (open) {
      setChecked(flatList.map(() => true));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flatList.length]);

  // 정지 + 정리
  const stopAll = () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch (e) { /* */ } }
    setPlaying(false); setPaused(false);
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'none'; } catch (e) { /* */ }
    }
  };

  // 컴포넌트 언마운트/닫기 시 정리
  useEffect(() => () => {
    stopAll();
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => { stopAll(); onClose && onClose(); };

  const toggle = (i) => setChecked(prev => prev.map((c, idx) => idx === i ? !c : c));
  const allChecked = checked.length > 0 && checked.every(Boolean);
  const toggleAll = () => setChecked(flatList.map(() => !allChecked));

  // Azure 합성 1문장 (캐시 재사용)
  const synthOne = async (text) => {
    const key = makeCacheKey(text, azureVoice, speed);
    const cached = await getCachedAudio(key);
    if (cached) return cached;
    if (ttsLimitReached) throw new Error('TTS 사용량 한도를 초과했어요.');
    addSpeechUsageFirestore(text.length);
    const wav = await new Promise((resolve, reject) => {
      const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
      sc.speechSynthesisVoiceName = azureVoice;
      const synth = new speechsdk.SpeechSynthesizer(sc, null);
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${azureVoice}"><prosody rate="${speed}">${text}</prosody></voice>
    </speak>`;
      synth.speakSsmlAsync(ssml,
        (result) => {
          synth.close();
          if (result.audioData && result.audioData.byteLength > 0) resolve(new Uint8Array(result.audioData));
          else reject(new Error('음성 합성에 실패했어요.'));
        },
        (err) => { synth.close(); reject(new Error('음성 합성 오류: ' + err)); }
      );
    });
    setCachedAudio(key, wav);
    return wav;
  };

  const setupMediaSession = (audio, chosen) => {
    if (!('mediaSession' in navigator)) return;
    try {
      const lessons = [...new Set(chosen.map(c => c.lesson))].join(', ');
      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `문장 암기 (${chosen.length}문장)`,
        artist: lessons || '펀펀영어',
        album: '펀펀영어',
      });
      navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
      navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
      navigator.mediaSession.setActionHandler('stop', () => { stopAll(); });
    } catch (e) { /* 일부 브라우저 미지원 */ }
  };

  const handlePlay = async () => {
    setError('');
    const chosen = flatList.filter((_, i) => checked[i]);
    if (chosen.length === 0) { setError('재생할 문장을 선택해주세요.'); return; }

    // 사용자 제스처 내에서 audio element 잠금해제 (iOS 대응)
    let audio = audioRef.current;
    if (!audio) { audio = new Audio(); audioRef.current = audio; }
    audio.loop = false;
    try { audio.src = SILENT_WAV; audio.play().then(() => audio.pause()).catch(() => {}); } catch (e) { /* */ }

    setBuilding(true);
    setProgress({ cur: 0, total: chosen.length });
    try {
      const clips = [];
      for (let i = 0; i < chosen.length; i++) {
        setProgress({ cur: i + 1, total: chosen.length });
        // eslint-disable-next-line no-await-in-loop
        clips.push(await synthOne(chosen[i].text));
      }
      // 문장 반복: 각 문장 클립을 sentRepeat번 연속으로 (사이 간격 포함) → 다음 문장
      const expanded = [];
      clips.forEach((c) => { for (let r = 0; r < sentRepeat; r++) expanded.push(c); });
      const blob = await buildPlaylistBlob(expanded, gap);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      // 재생 시작
      audio.src = url;
      audio.loop = (repeat === Infinity);
      playCountRef.current = 0;

      audio.onplay = () => {
        setPlaying(true); setPaused(false);
        if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'playing'; } catch (e) { /* */ } }
      };
      audio.onpause = () => {
        setPaused(true);
        if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'paused'; } catch (e) { /* */ } }
      };
      audio.onended = () => {
        if (repeat === Infinity) return; // loop 가 처리
        playCountRef.current += 1;
        if (playCountRef.current < repeat) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        } else {
          setPlaying(false); setPaused(false);
        }
      };

      setupMediaSession(audio, chosen);
      await audio.play();
    } catch (e) {
      setError(e.message || '재생을 시작할 수 없어요.');
      setPlaying(false);
    } finally {
      setBuilding(false);
    }
  };

  const togglePauseResume = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };

  if (!open) return null;

  const selectedCount = checked.filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="bgp-modal">
        <div className="bgp-header">
          <h2 className="modal-title">🎧 백그라운드 재생</h2>
          <button className="bgp-close" onClick={handleClose}>✕</button>
        </div>

        {!azureReady ? (
          <div className="bgp-notice">백그라운드 재생은 Azure 음성이 필요해요. 설정에서 음성 인증을 먼저 해주세요.</div>
        ) : flatList.length === 0 ? (
          <div className="bgp-notice">이 달에 등록된 문장이 없어요. 문장 관리에서 추가해 주세요!</div>
        ) : (
          <div className="bgp-body">
            <p className="bgp-hint">화면을 잠그거나 다른 앱을 써도 계속 반복 재생돼요. (잠금화면 컨트롤 지원)</p>

            {/* 설정 (다른 화면과 동일한 라디오 디자인) */}
            <div className="sm-settings-bar bgp-settings-bar">
              <div className="sm-setting-group">
                <span className="sm-setting-label">속도:</span>
                {SPEEDS.map(o => (
                  <label key={o.value} className="sm-radio">
                    <input type="radio" name="bgpSpeed" checked={speed === o.value}
                      onChange={() => setSpeed(o.value)} disabled={playing || building} />
                    <span className="sm-radio-text">{o.label}</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">문장 반복:</span>
                {SENT_REPEATS.map(n => (
                  <label key={n} className="sm-radio">
                    <input type="radio" name="bgpSentRepeat" checked={sentRepeat === n}
                      onChange={() => setSentRepeat(n)} disabled={playing || building} />
                    <span className="sm-radio-text">{n}번</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">전체 반복:</span>
                {REPEATS.map(n => (
                  <label key={String(n)} className="sm-radio">
                    <input type="radio" name="bgpRepeat" checked={repeat === n}
                      onChange={() => setRepeat(n)} disabled={playing || building} />
                    <span className="sm-radio-text">{n === Infinity ? '∞ 무한' : `${n}번`}</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">간격:</span>
                {GAPS.map(s => (
                  <label key={s} className="sm-radio">
                    <input type="radio" name="bgpGap" checked={gap === s}
                      onChange={() => setGap(s)} disabled={playing || building} />
                    <span className="sm-radio-text">{s}초</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 문장 선택 */}
            <div className="bgp-list-head">
              <span>재생할 문장 ({selectedCount}/{flatList.length})</span>
              <button className="bgp-selall" onClick={toggleAll} disabled={playing || building}>
                {allChecked ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            <div className="bgp-list">
              {flatList.map((item, i) => (
                <label key={i} className={`bgp-item ${checked[i] ? 'on' : ''}`}>
                  <input type="checkbox" checked={!!checked[i]} onChange={() => toggle(i)} disabled={playing || building} />
                  <span className="bgp-item-text">{item.text}</span>
                  <span className="bgp-item-lesson">{item.lesson}</span>
                </label>
              ))}
            </div>

            {error && <div className="bgp-error">{error}</div>}

            {/* 컨트롤 */}
            <div className="bgp-controls">
              {building ? (
                <button className="bgp-play-btn" disabled>
                  오디오 만드는 중... {progress.cur}/{progress.total}
                </button>
              ) : playing ? (
                <>
                  <button className="bgp-play-btn pause" onClick={togglePauseResume}>
                    {paused ? '▶️ 다시 재생' : '⏸️ 일시정지'}
                  </button>
                  <button className="bgp-play-btn stop" onClick={stopAll}>⏹️ 정지</button>
                </>
              ) : (
                <button className="bgp-play-btn" onClick={handlePlay} disabled={selectedCount === 0}>
                  ▶️ 재생 시작 {repeat === Infinity ? '(무한 반복)' : `(${repeat}번 반복)`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
