import React, { useState, useEffect, useMemo, useRef } from 'react';
import './SongModal.css';

// YouTube IFrame Player API 1회 로드 (자막 크기 제어용)
function loadYT() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) { /* */ } resolve(window.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
}

// 검색어 추천에서 제외할 기능어
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'he', 'she', 'it', 'its', 'they', 'we', 'you', 'i', 'his', 'her', 'their', 'my', 'your', 'our', 'this', 'that', 'these', 'those', 'get', 'gets', 'got', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'for', 'with', 'from', 'up', 'down', 'out', 'into', 'as', 'so', 'then', 'them', 'there', 'here', 'what', 'who', 'when', 'where', 'why', 'how', 'not', 'no', 'yes', 'all', 'some', 'too', 'very', 'just', 'now', 'him', 'me', 'us']);

// 레슨 문장들에서 추천 검색어(핵심 단어) 추출
function buildSuggestions(sentences) {
  const freq = new Map();
  (sentences || []).forEach(s => {
    const text = typeof s === 'string' ? s : (s?.text || '');
    (text.toLowerCase().match(/[a-z]+/g) || []).forEach(w => {
      if (w.length >= 3 && !STOPWORDS.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    });
  });
  const words = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  // 핵심 단어 + 일반 파닉스/노래 추천
  return [...words, 'phonics song', 'sight words song'];
}

// 레슨 노래 (유튜브) — 부모가 검색·승인해서 레슨에 저장, 학습 중 임베드 재생
// props:
//   open, onClose
//   youtubeKey        YouTube Data API v3 키 (없으면 검색 불가, 저장된 노래는 재생 가능)
//   songs             [{ id, title }]  저장된 노래
//   onAddSong(song)   부모가 후보 선택 → 저장
//   onRemoveSong(id)
//   defaultQuery      기본 검색어 (레슨 이름/주제)
const MAX_SECONDS = 360; // 6분

// ISO8601(PT#M#S) → 초
function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// 신뢰하는 키즈/영어교육 채널 (이 안에서만 검색하면 키즈 콘텐츠만 나옴)
const KIDS_CHANNELS = [
  { id: 'UCLsooMJoIpl_7ux2jvdPB-Q', name: 'Super Simple Songs' },
  { id: 'UCGwA4GjY4nGMIYvaJiA0EGA', name: 'English Singsing' },
  { id: 'UCe1VpF4wS_kdcjyTRSXBcnQ', name: 'The Singing Walrus' },
  { id: 'UCbCmjCuTUZos6Inko4u57UQ', name: 'Cocomelon' },
  { id: 'UCcdwLMPsaU2ezNSJU1nFoBQ', name: 'Pinkfong Baby Shark' },
];

export default function SongModal({ open, onClose, youtubeKey, songs = [], onAddSong, onRemoveSong, defaultQuery = '', sentences = [] }) {
  const suggestions = useMemo(() => buildSuggestions(sentences), [sentences]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('kids'); // 'kids'(키즈채널 전체) | channelId | 'all'(일반 안전검색)
  const [results, setResults] = useState(null); // null=검색전, []=결과없음
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [ccSize, setCcSize] = useState(() => {
    const v = parseInt(localStorage.getItem('woojin-cc-size'));
    return isNaN(v) ? 2 : v; // 기본 '크게'
  });

  const [ccStatus, setCcStatus] = useState('unknown'); // 'unknown' | 'available' | 'none'

  const playerRef = useRef(null);
  const hostRef = useRef(null);
  const ccSizeRef = useRef(ccSize);
  ccSizeRef.current = ccSize;

  // 자막 켜기 + 크기 적용 (레거시 옵션)
  const applyCaptions = (p) => {
    try { p.loadModule('captions'); } catch (e) { /* */ }
    try { p.setOption('captions', 'fontSize', ccSizeRef.current); } catch (e) { /* */ }
    try { p.setOption('cc', 'fontSize', ccSizeRef.current); } catch (e) { /* */ }
  };

  // 이 영상에 자막이 있는지 확인
  const checkCaptions = (p) => {
    try {
      const tl = p.getOption('captions', 'tracklist') || p.getOption('cc', 'tracklist') || [];
      setCcStatus(tl && tl.length ? 'available' : 'none');
    } catch (e) { setCcStatus('unknown'); }
  };

  // 플레이어 생성/영상 교체
  useEffect(() => {
    if (!open || !playingId) return;
    let cancelled = false;
    setCcStatus('unknown');
    loadYT().then((YT) => {
      if (cancelled || !hostRef.current) return;
      if (playerRef.current && playerRef.current.loadVideoById) {
        playerRef.current.loadVideoById(playingId);
        return;
      }
      const el = document.createElement('div');
      hostRef.current.innerHTML = '';
      hostRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        videoId: playingId,
        width: '100%', height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 1, cc_lang_pref: 'en', hl: 'en' },
        events: {
          onReady: (e) => { try { e.target.setVolume(75); } catch (_) { /* */ } applyCaptions(e.target); },
          onStateChange: (e) => {
            if (e.data === 1) { // 재생 중
              try { e.target.setVolume(75); } catch (_) { /* */ }
              applyCaptions(e.target);
              setTimeout(() => { try { checkCaptions(e.target); } catch (_) { /* */ } }, 1500);
            }
          },
        },
      });
    });
    return () => { cancelled = true; };
  }, [open, playingId]);

  // 자막 크기 변경 시 적용 + 저장
  useEffect(() => {
    localStorage.setItem('woojin-cc-size', String(ccSize));
    if (playerRef.current) applyCaptions(playerRef.current);
  }, [ccSize]);

  // 닫힐 때/언마운트 시 플레이어 정리
  useEffect(() => {
    if (!open && playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) { /* */ }
      playerRef.current = null;
    }
  }, [open]);
  useEffect(() => () => {
    if (playerRef.current) { try { playerRef.current.destroy(); } catch (e) { /* */ } playerRef.current = null; }
  }, []);

  useEffect(() => {
    if (open) {
      // 레슨명이 "Lesson N"이면 검색어로 무의미 → 비워둠
      const dq = /^lesson\s*\d/i.test(defaultQuery || '') ? '' : (defaultQuery || '');
      setQuery(dq);
      setResults(null);
      setError('');
      setPlayingId(songs[0]?.id || null);
      setShowSearch(songs.length === 0); // 저장된 노래 없으면 검색부터
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 단일 검색 요청 (채널 지정 가능)
  const fetchSearch = async (q, channelId, max) => {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video`
      + `&safeSearch=strict&videoEmbeddable=true&maxResults=${max}&relevanceLanguage=en`
      + (channelId ? `&channelId=${channelId}` : '')
      + `&q=${encodeURIComponent(q)}&key=${encodeURIComponent(youtubeKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return (data.items || [])
      .filter(it => it.id && it.id.videoId)
      .map(it => ({
        id: it.id.videoId,
        title: it.snippet?.title || '',
        channel: it.snippet?.channelTitle || '',
        thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
      }));
  };

  // 영상 길이 조회 (한 번에 최대 50개, 1 quota)
  const fetchDurations = async (ids) => {
    const map = {};
    if (!ids.length) return map;
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${encodeURIComponent(youtubeKey)}`;
      const res = await fetch(url);
      if (!res.ok) return map;
      const data = await res.json();
      (data.items || []).forEach(it => { map[it.id] = parseDuration(it.contentDetails?.duration); });
    } catch (e) { /* 실패 시 필터 없이 통과 */ }
    return map;
  };

  const search = async (term) => {
    const q = (term !== undefined ? term : query).trim();
    if (!q) return;
    if (!youtubeKey) { setError('설정에서 YouTube API 키를 먼저 입력해주세요.'); return; }
    setLoading(true); setError(''); setResults(null);
    try {
      let items = [];
      if (scope === 'kids') {
        // 키즈 채널들에서 병렬 검색 후 합치기
        const arrs = await Promise.all(KIDS_CHANNELS.map(c => fetchSearch(q, c.id, 5).catch(() => [])));
        const seen = new Set();
        arrs.flat().forEach(it => { if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } });
      } else if (scope === 'all') {
        items = await fetchSearch(q, '', 12);
      } else {
        items = await fetchSearch(q, scope, 12); // scope = 특정 channelId
      }
      // 길이 필터: 6분 이하만 (길이 조회 실패 시 통과)
      const durMap = await fetchDurations(items.map(it => it.id).slice(0, 50));
      items = items
        .map(it => ({ ...it, dur: durMap[it.id] || 0 }))
        .filter(it => it.dur === 0 || it.dur <= MAX_SECONDS);
      setResults(items);
    } catch (e) {
      setError(e.message === '403' ? 'API 할당량 초과 또는 키 오류예요.' : '검색 중 오류가 발생했어요.');
    }
    setLoading(false);
  };

  if (!open) return null;

  const isSaved = (id) => songs.some(s => s.id === id);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="song-modal">
        <div className="song-header">
          <h2 className="modal-title">🎵 레슨 노래</h2>
          <button className="song-close" onClick={onClose}>✕</button>
        </div>

        {/* 재생 플레이어 (IFrame API — 자막 크기 제어) */}
        {playingId && (
          <>
            <div className="song-player"><div ref={hostRef} className="song-player-host" /></div>
            <div className="song-cc-row">
              <span className="song-cc-label">자막 크기:</span>
              {[{ l: '작게', v: -1 }, { l: '보통', v: 0 }, { l: '크게', v: 2 }, { l: '아주 크게', v: 3 }].map(o => (
                <button key={o.v} className={`song-cc-btn ${ccSize === o.v ? 'active' : ''}`} onClick={() => setCcSize(o.v)}>{o.l}</button>
              ))}
              {ccStatus === 'available' && <span className="song-cc-ok">✅ 영어 자막</span>}
              {ccStatus === 'none' && <span className="song-cc-warn">⚠️ 이 영상엔 자막이 없어요</span>}
            </div>
          </>
        )}

        {/* 저장된 노래 목록 */}
        <div className="song-section-title">이 레슨의 노래 ({songs.length})</div>
        {songs.length === 0 ? (
          <div className="song-empty">아직 저장된 노래가 없어요. 아래에서 찾아 추가해 주세요!</div>
        ) : (
          <div className="song-saved-list">
            {songs.map(s => (
              <div className={`song-saved-item ${playingId === s.id ? 'active' : ''}`} key={s.id}>
                <button className="song-play-btn" onClick={() => setPlayingId(s.id)} title="재생">▶</button>
                <span className="song-saved-title" onClick={() => setPlayingId(s.id)}>{s.title || s.id}</span>
                <button className="song-remove-btn" onClick={() => onRemoveSong && onRemoveSong(s.id)} title="삭제">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 노래 찾기 (부모) */}
        <button className="song-search-toggle" onClick={() => setShowSearch(!showSearch)}>
          {showSearch ? '▼' : '▶'} 🔍 노래 찾기 (부모용)
        </button>
        {showSearch && (
          <div className="song-search-panel">
            <select className="song-scope-select" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="kids">🧒 키즈 채널 모아보기 (추천)</option>
              {KIDS_CHANNELS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="all">🌐 일반 검색 (안전검색)</option>
            </select>
            <div className="song-search-row">
              <input
                className="song-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                placeholder="주제 단어로 검색 (예: fox, colors, family)"
              />
              <button className="song-search-btn" onClick={() => search()} disabled={loading}>
                {loading ? '검색 중...' : '검색'}
              </button>
            </div>
            <div className="song-search-note">
              {scope === 'all'
                ? '일반 검색은 성인물만 걸러질 뿐 키즈 전용이 아니에요. 되도록 키즈 채널을 쓰세요. (6분 이하만 표시)'
                : '검증된 키즈 채널 안에서만 검색돼요. 주제 단어(예: fox)로 검색하면 잘 나와요. (6분 이하만 표시)'}
            </div>
            {suggestions.length > 0 && (
              <div className="song-suggest">
                <span className="song-suggest-label">추천 검색어:</span>
                {suggestions.map((s, i) => (
                  <button key={i} className="song-suggest-chip" onClick={() => { setQuery(s); search(s); }} disabled={loading}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {error && <div className="song-error">{error}</div>}
            {results && results.length === 0 && <div className="song-empty">검색 결과가 없어요.</div>}
            {results && results.length > 0 && (
              <div className="song-results">
                {results.map(r => (
                  <div className="song-result" key={r.id}>
                    <div className="song-result-thumb" onClick={() => setPlayingId(r.id)}>
                      {r.thumb ? <img src={r.thumb} alt={r.title} /> : <div className="song-thumb-empty">🎬</div>}
                      <span className="song-result-play">▶ 미리보기</span>
                      {r.dur > 0 && <span className="song-result-dur">{fmtDuration(r.dur)}</span>}
                    </div>
                    <div className="song-result-info">
                      <div className="song-result-title">{r.title}</div>
                      <div className="song-result-channel">{r.channel}</div>
                    </div>
                    {isSaved(r.id) ? (
                      <button className="song-add-btn saved" disabled>✓ 추가됨</button>
                    ) : (
                      <button className="song-add-btn" onClick={() => onAddSong && onAddSong({ id: r.id, title: r.title })}>+ 레슨에 추가</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
