import React, { useState, useMemo, useRef } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { addSpeechUsageFirestore } from './firebase';
import { getCachedAudio, setCachedAudio, playCachedAudio, makeCacheKey, unlockAudio } from './ttsCache';
import BackgroundPlay from './BackgroundPlay';
import { showNotice, VOICE_MSG } from './notice';
import { sortLessons } from './lessonSort';

// ─── TTS 헬퍼 (캐시 지원) ───
async function speakAzure(text, azureKey, azureRegion, azureVoice, rate, ttsLimitReached = false) {
  const cacheKey = makeCacheKey(text, azureVoice, rate);

  // 캐시 확인
  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    await playCachedAudio(cached);
    return;
  }

  // TTS 제한 체크 (캐시 미스일 때만)
  if (ttsLimitReached) {
    console.warn('TTS 제한 초과');
    showNotice(VOICE_MSG.limit); // 조용히 무음이 되지 않게 안내
    return;
  }

  // 캐시 미스 — Azure 호출 (null = 직접 재생 안 함, AudioContext로 재생)
  addSpeechUsageFirestore(text.length);
  return new Promise((resolve) => {
    const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
    sc.speechSynthesisVoiceName = azureVoice;
    const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${azureVoice}"><prosody rate="${rate}">${text}</prosody></voice>
    </speak>`;
    synthesizer.speakSsmlAsync(ssml,
      (result) => {
        synthesizer.close();
        if (result.audioData && result.audioData.byteLength > 0) {
          const audioArr = new Uint8Array(result.audioData);
          setCachedAudio(cacheKey, audioArr);
          playCachedAudio(audioArr).then(() => setTimeout(resolve, 150));
        } else {
          setTimeout(resolve, 150);
        }
      },
      () => { synthesizer.close(); setTimeout(resolve, 150); }
    );
  });
}

function speakBrowser(text, rate) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = 'en-US';
    // rate 문자열 → 숫자 변환 (예: '-30%' → 0.7)
    const pct = parseInt(rate) || 0;
    ut.rate = 1 + pct / 100;
    const timeout = setTimeout(resolve, 8000);
    ut.onend = () => { clearTimeout(timeout); resolve(); };
    ut.onerror = () => { clearTimeout(timeout); resolve(); };
    synth.speak(ut);
  });
}

// AI에게 줄 베이스 프롬프트 — 어떤 요청이든 정해진 JSON 형식으로만 출력하도록 지시 (범용)
const AI_SENTENCE_PROMPT = `[요청]: (여기에 원하는 내용을 자유롭게 적으세요)

위 요청에 맞는 영어 문장을 만들고, 각 문장에 한국어 뜻을 함께 넣어 주세요.

⚠️ 반드시 아래 JSON 형식 그대로만 출력하세요. 코드블록, 설명, 인사말 등 다른 텍스트는 절대 넣지 마세요.

{
  "sentences": [
    { "text": "English sentence", "meaning": "한국어 뜻" }
  ]
}`;

// ============================================================
export default function SentenceMemorize({
  memorizeData, setMemorizeData,
  selectedYear, selectedMonth,
  handleYearChange, handleMonthChange,
  azureKey, azureRegion, azureVerified, azureVoice,
  ttsLimitReached = false,
  lessonSortKey = 'name', lessonSortOrder = 'asc'
}) {
  const currentKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const days = useMemo(() => memorizeData[currentKey] || [], [memorizeData, currentKey]);

  const [selectedDayIndex, setSelectedDayIndex] = useState(-1);
  const [selectedSentenceIdx, setSelectedSentenceIdx] = useState(-1);
  const [speed, setSpeed] = useState('-30%');
  const [repeatCount, setRepeatCount] = useState(3);
  const [repeatGap, setRepeatGap] = useState(2); // 반복 간격(초)
  const [playingIdx, setPlayingIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState(null); // 'single' | 'all'
  const abortRef = useRef(false);

  // 팝업
  const [showManage, setShowManage] = useState(false);
  const [showBgPlay, setShowBgPlay] = useState(false);
  const [newSentence, setNewSentence] = useState('');

  const selectedDay = days[selectedDayIndex] || null;
  const rawSentences = selectedDay?.sentences || [];
  // 호환성: 문자열이면 객체로 변환 {text, meaning}
  const sentences = rawSentences.map(s => typeof s === 'string' ? { text: s, meaning: '' } : s);
  const [showMeaning, setShowMeaning] = useState(false);

  // ─── TTS ───
  const speak = (text) => {
    if (azureVerified && azureKey && azureRegion) {
      return speakAzure(text, azureKey, azureRegion, azureVoice, speed, ttsLimitReached);
    }
    return speakBrowser(text, speed);
  };

  // ─── Lesson 선택 ───
  const handleDaySelect = (idx) => {
    abortRef.current = true;
    setIsPlaying(false);
    setPlayingIdx(-1);
    setPlayMode(null);
    setSelectedDayIndex(idx);
    setSelectedSentenceIdx(-1);
  };

  // ─── 개별 버튼으로 재생 ───
  const playSingleByIdx = async (idx) => {
    if (isPlaying) return;
    setSelectedSentenceIdx(idx);
    setIsPlaying(true);
    setPlayMode('single');
    abortRef.current = false;
    const text = sentences[idx].text;
    for (let i = 0; i < repeatCount; i++) {
      if (abortRef.current) break;
      setPlayingIdx(idx);
      await speak(text);
      if (i < repeatCount - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, repeatGap * 1000));
      }
    }
    setPlayingIdx(-1);
    setIsPlaying(false);
    setPlayMode(null);
  };

  // ─── 선택한 문장 재생 (반복 + 간격) ───
  const playSingle = async () => {
    unlockAudio();
    if (isPlaying || selectedSentenceIdx < 0) return;
    setIsPlaying(true);
    setPlayMode('single');
    abortRef.current = false;
    const text = sentences[selectedSentenceIdx].text;

    for (let i = 0; i < repeatCount; i++) {
      if (abortRef.current) break;
      setPlayingIdx(selectedSentenceIdx);
      await speak(text);
      if (i < repeatCount - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, repeatGap * 1000));
      }
    }
    setPlayingIdx(-1);
    setIsPlaying(false);
    setPlayMode(null);
  };

  // ─── 전체 순서 재생 (반복 + 간격) ───
  const playAll = async () => {
    unlockAudio();
    if (isPlaying) return;
    setIsPlaying(true);
    setPlayMode('all');
    abortRef.current = false;

    for (let s = 0; s < sentences.length; s++) {
      if (abortRef.current) break;
      setSelectedSentenceIdx(s);
      for (let i = 0; i < repeatCount; i++) {
        if (abortRef.current) break;
        setPlayingIdx(s);
        await speak(sentences[s].text);
        if (i < repeatCount - 1 && !abortRef.current) {
          await new Promise(r => setTimeout(r, repeatGap * 1000));
        }
      }
      if (s < sentences.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, repeatGap * 1000 + 500));
      }
    }
    setPlayingIdx(-1);
    setIsPlaying(false);
    setPlayMode(null);
  };

  const stopPlaying = () => {
    abortRef.current = true;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setPlayingIdx(-1);
    setPlayMode(null);
  };

  // ─── 데이터 관리 ───
  const updateData = (updater) => {
    setMemorizeData(prev => {
      const arr = prev[currentKey] || [];
      const updated = { ...prev, [currentKey]: updater(arr) };
      return updated;
    });
  };

  const addDay = () => {
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    updateData(arr => [...arr, { id: Date.now(), name: `Lesson ${arr.length + 1}`, date: today, sentences: [] }]);
  };

  const removeDay = (idx) => {
    updateData(arr => arr.filter((_, i) => i !== idx));
    if (selectedDayIndex === idx) setSelectedDayIndex(-1);
  };

  const updateDayDate = (idx, dateStr) => {
    updateData(arr => arr.map((d, i) => i === idx ? { ...d, date: dateStr || '' } : d));
  };

  const updateDayName = (idx, name) => {
    updateData(arr => arr.map((d, i) => i === idx ? { ...d, name: (name || '').trim() || d.name } : d));
  };

  const addSentenceToDay = (dayIdx, text, meaning) => {
    updateData(arr => arr.map((d, i) =>
      i === dayIdx ? { ...d, sentences: [...(d.sentences || []), { text: text.trim(), meaning: (meaning || '').trim() }] } : d
    ));
  };

  const removeSentenceFromDay = (dayIdx, sIdx) => {
    updateData(arr => arr.map((d, i) =>
      i === dayIdx ? { ...d, sentences: (d.sentences || []).filter((_, si) => si !== sIdx) } : d
    ));
  };

  const addSentence = () => {
    if (!newSentence.trim()) return;
    updateData(arr => arr.map((d, i) =>
      i === selectedDayIndex ? { ...d, sentences: [...(d.sentences || []), newSentence.trim()] } : d
    ));
    setNewSentence('');
  };

  const removeSentence = (sIdx) => {
    updateData(arr => arr.map((d, i) =>
      i === selectedDayIndex ? { ...d, sentences: (d.sentences || []).filter((_, si) => si !== sIdx) } : d
    ));
  };

  return (
    <main className="learning-main">
      {/* ===== 좌측: 문장 재생 영역 ===== */}
      <section className="learning-left sm-content">
        {selectedDay && sentences.length > 0 ? (
          <>
            {/* 설정 바 */}
            <div className="sm-settings-bar">
              <div className="sm-setting-group">
                <span className="sm-setting-label">속도:</span>
                {[
                  { label: '느리게', value: '-40%' },
                  { label: '조금 느리게', value: '-30%' },
                  { label: '보통', value: '-20%' },
                ].map(opt => (
                  <label key={opt.value} className="sm-radio">
                    <input type="radio" name="memSpeed" value={opt.value}
                      checked={speed === opt.value} onChange={() => setSpeed(opt.value)} disabled={isPlaying} />
                    <span className="sm-radio-text">{opt.label}</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">반복:</span>
                {[1, 2, 3, 4, 5].map(n => (
                  <label key={n} className="sm-radio">
                    <input type="radio" name="memRepeat" value={n}
                      checked={repeatCount === n} onChange={() => setRepeatCount(n)} disabled={isPlaying} />
                    <span className="sm-radio-text">{n}번</span>
                  </label>
                ))}
              </div>
              <div className="sm-setting-group">
                <span className="sm-setting-label">간격:</span>
                {[1, 2, 3].map(sec => (
                  <label key={sec} className="sm-radio">
                    <input type="radio" name="memGap" value={sec}
                      checked={repeatGap === sec} onChange={() => setRepeatGap(sec)} disabled={isPlaying} />
                    <span className="sm-radio-text">{sec}초</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 헤더: 뜻 보기 + 전체 듣기 */}
            <div className="sm-list-header">
              <button className="sm-meaning-toggle" onClick={() => setShowMeaning(!showMeaning)}>
                {showMeaning ? '🙈 뜻 숨기기' : '👀 뜻 보기'}
              </button>
              {isPlaying && playMode === 'all' ? (
                <button className="sm-action-btn stop" onClick={stopPlaying}>⏹️ 전체 중지</button>
              ) : (
                <button className="sm-action-btn play" onClick={playAll} disabled={isPlaying}>
                  ▶️ 전체 순서대로 듣기
                </button>
              )}
            </div>

            {/* 문장 리스트 — 클릭으로 선택 */}
            <div className="sm-sentence-list">
              {sentences.map((s, idx) => (
                <div
                  key={idx}
                  className={`sm-sentence-item ${selectedSentenceIdx === idx ? 'selected' : ''} ${playingIdx === idx ? 'playing' : ''}`}
                  onClick={() => { if (!isPlaying) setSelectedSentenceIdx(idx); }}
                >
                  <span className="sm-sentence-num">{idx + 1}</span>
                  <div className="sm-sentence-body">
                    <span className="sm-sentence-text">{s.text}</span>
                    {showMeaning && s.meaning && (
                      <span className="sm-sentence-meaning">{s.meaning}</span>
                    )}
                  </div>
                  {/* 개별 재생/중지 토글 */}
                  {isPlaying && playingIdx === idx ? (
                    <button className="sm-play-btn stop" onClick={(e) => { e.stopPropagation(); stopPlaying(); }}>
                      ⏹️
                    </button>
                  ) : (
                    <button className="sm-play-btn"
                      onClick={(e) => { e.stopPropagation(); setSelectedSentenceIdx(idx); setTimeout(playSingleByIdx, 0, idx); }}
                      disabled={isPlaying}>
                      ▶️
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 선택된 문장 컨트롤 */}
            {selectedSentenceIdx >= 0 && (
              <div className="sm-selected-controls">
                <div className="sm-selected-label">
                  선택: <strong>{sentences[selectedSentenceIdx]?.text}</strong>
                </div>
                {isPlaying && playMode === 'single' ? (
                  <button className="sm-action-btn stop" onClick={stopPlaying}>⏹️ 중지</button>
                ) : (
                  <button className="sm-action-btn play" onClick={playSingle} disabled={isPlaying}>
                    ▶️ 선택 문장 듣기
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="image-area">
            <div className="image-placeholder">
              <span className="placeholder-emoji">📖</span>
              {selectedDay ? '이 Lesson에 문장이 없어요. 문장 관리에서 추가해 주세요!' : '문장을 선택하고 암기를 시작해봐!'}
            </div>
          </div>
        )}
      </section>

      {/* ===== 우측: Lesson 선택 ===== */}
      <aside className="learning-right">
        <div className="day-selector">
          <div className="section-title">📅 년/월 선택</div>
          <div className="ym-row">
            <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)}>◀</button>
            <span className="ym-label">{selectedYear}년</span>
            <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)}>▶</button>
          </div>
          <div className="month-buttons">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
              <button key={m} className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
                onClick={() => handleMonthChange(m)}>{m}월</button>
            ))}
          </div>
          <div className="section-title" style={{ marginTop: 8 }}>📚 Lesson 선택</div>
          <div className="day-buttons">
            {[...days].map((_, _i, arr) => {
              const i = arr.length - 1 - _i;
              const day = days[i];
              return (
                <button key={day.id || i}
                  className={`day-btn ${selectedDayIndex === i ? 'active' : ''}`}
                  onClick={() => handleDaySelect(i)}>
                  {day.name}{day.date ? ` (${day.date})` : ''}
                  {day.sentences && day.sentences.length > 0 && (
                    <span className="day-progress">{day.sentences.length}문장</span>
                  )}
                </button>
              );
            })}
          </div>
          {days.length === 0 && (
            <div style={{ color: 'var(--color-text-light)', marginTop: 8, fontFamily: 'var(--font-kr)', fontSize: '0.9rem' }}>
              이 달에는 아직 Lesson이 없어요.
            </div>
          )}
        </div>

        {selectedDayIndex < 0 && (
          <div className="no-day-message">
            <span className="msg-emoji">👆</span>
            <span className="msg-text">위에서 Lesson을 선택해 주세요!</span>
          </div>
        )}

        <button className="sm-bgplay-open-btn" onClick={() => setShowBgPlay(true)}>
          🎧 백그라운드 재생
        </button>
        <button className="sm-manage-open-btn" onClick={() => setShowManage(true)}>
          📋 문장 관리
        </button>
      </aside>

      {/* ===== 백그라운드 재생 팝업 ===== */}
      <BackgroundPlay
        open={showBgPlay}
        onClose={() => setShowBgPlay(false)}
        days={days}
        azureKey={azureKey}
        azureRegion={azureRegion}
        azureVoice={azureVoice}
        azureVerified={azureVerified}
        ttsLimitReached={ttsLimitReached}
      />

      {/* ===== 문장 등록 팝업 ===== */}
      {showManage && (
        <div className="modal-overlay modal-fullish" onClick={(e) => { if (e.target === e.currentTarget) setShowManage(false); }}>
          <div className="sentence-admin-popup">
            <div className="sentence-admin-popup-header">
              <h2 className="modal-title">📋 문장 관리</h2>
              <button className="sentence-admin-close" onClick={() => setShowManage(false)}>✕</button>
            </div>
            <div className="sentence-admin-popup-body">
              <div className="admin-container">
                <div className="day-selector" style={{ marginBottom: 8 }}>
                  <div className="section-title">📅 년/월 선택</div>
                  <div className="ym-row">
                    <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)}>◀</button>
                    <span className="ym-label">{selectedYear}년</span>
                    <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)}>▶</button>
                  </div>
                  <div className="month-buttons">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                      <button key={m} className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
                        onClick={() => handleMonthChange(m)}>{m}월</button>
                    ))}
                  </div>
                </div>

                <div className="admin-top-bar">
                  <button className="add-day-btn" onClick={addDay}>
                    ➕ Lesson 추가 ({selectedYear}년 {selectedMonth}월)
                  </button>
                </div>

                {days.length === 0 && (
                  <div className="no-day-message">
                    <span className="msg-emoji">📝</span>
                    <span className="msg-text">Lesson이 없어요. 위 버튼으로 추가해 주세요!</span>
                  </div>
                )}

                {sortLessons(days, lessonSortKey, lessonSortOrder).map(({ d: day, i: dayIdx }) => {
                  const daySentences = day.sentences || [];
                  return (
                    <MemorizeDayCard
                      key={day.id || dayIdx}
                      day={day}
                      dayIdx={dayIdx}
                      sentences={daySentences}
                      removeDay={removeDay}
                      addSentence={(text, meaning) => addSentenceToDay(dayIdx, text, meaning)}
                      removeSentence={(sIdx) => removeSentenceFromDay(dayIdx, sIdx)}
                      updateDayDate={updateDayDate}
                      updateDayName={updateDayName}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Lesson 카드 (팝업 내부용)
function MemorizeDayCard({ day, dayIdx, sentences, removeDay, addSentence, removeSentence, updateDayDate, updateDayName }) {
  const [newText, setNewText] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(day.name);
  const saveName = () => { if (updateDayName) updateDayName(dayIdx, nameDraft); setEditingName(false); };
  const [deleteSentenceConfirm, setDeleteSentenceConfirm] = useState(-1);
  const [deleteLessonConfirm, setDeleteLessonConfirm] = useState(false);
  const inputRef = useRef(null);
  const dateRef = useRef(null);

  // JSON 일괄 등록
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonMsg, setJsonMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_SENTENCE_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setJsonMsg('복사에 실패했어요. 직접 선택해서 복사해 주세요.');
    }
  };

  const handleJsonAdd = () => {
    setJsonMsg('');
    let data;
    try {
      // 코드블록(```json ... ```)이 섞여 와도 JSON 부분만 추출
      const m = jsonText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      data = JSON.parse(m ? m[0] : jsonText);
    } catch (e) {
      setJsonMsg('JSON 형식이 올바르지 않아요. 다시 확인해 주세요.');
      return;
    }
    const arr = Array.isArray(data) ? data : (Array.isArray(data.sentences) ? data.sentences : null);
    if (!arr) { setJsonMsg('"sentences" 배열을 찾을 수 없어요.'); return; }
    let count = 0;
    arr.forEach((item) => {
      if (typeof item === 'string') {
        if (item.trim()) { addSentence(item, ''); count++; }
      } else if (item && typeof item.text === 'string' && item.text.trim()) {
        addSentence(item.text, item.meaning || '');
        count++;
      }
    });
    if (count > 0) {
      setJsonText('');
      setJsonMsg(`✅ ${count}개 문장을 추가했어요!`);
      setCollapsed(false);
    } else {
      setJsonMsg('추가할 문장이 없어요.');
    }
  };

  // 호환성: 문자열이면 객체로 변환
  const normalized = sentences.map(s => typeof s === 'string' ? { text: s, meaning: '' } : s);

  const handleAdd = () => {
    if (newText.trim()) {
      addSentence(newText, newMeaning);
      setNewText('');
      setNewMeaning('');
      setCollapsed(false);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openDatePicker = (e) => {
    e.stopPropagation();
    dateRef.current?.showPicker?.();
    dateRef.current?.focus();
  };

  return (
    <div className="day-card">
      <div className="day-card-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer', position: 'relative' }}>
        <div className="day-card-title">
          <span className="day-card-toggle">{collapsed ? '▶' : '▼'}</span>
          {editingName ? (
            <input
              className="day-name-input"
              value={nameDraft}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveName(); else if (e.key === 'Escape') { setNameDraft(day.name); setEditingName(false); } }}
              onBlur={saveName}
            />
          ) : (
            <>
              <span className="day-name-plain">📅 {day.name}</span>
              <button className="day-name-edit-btn" onClick={(e) => { e.stopPropagation(); setNameDraft(day.name); setEditingName(true); }} title="이름 수정">✏️</button>
            </>
          )}
          {day.date ? (
            <span className="day-card-date" onClick={openDatePicker} title="클릭하여 날짜 수정">
              ({day.date}) <span className="day-date-edit-icon">✏️</span>
            </span>
          ) : (
            <span className="day-card-date day-card-date-empty" onClick={openDatePicker} title="날짜 추가">
              <span className="day-date-edit-icon">📅+</span>
            </span>
          )}
          {normalized.length > 0 && (
            <span className="day-card-progress">({normalized.length}문장)</span>
          )}
        </div>
        <input
          ref={dateRef}
          type="date"
          className="day-date-input-hidden"
          value={day.date || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); updateDayDate(dayIdx, e.target.value); }}
        />
        <button className="delete-day-btn" onClick={(e) => { e.stopPropagation(); setDeleteLessonConfirm(true); }}>🗑️ 삭제</button>
      </div>

      {!collapsed && <><div className="sentence-tags">
        {normalized.length === 0 && (
          <div className="empty-words">아직 문장이 없어요. 아래에서 추가해 주세요!</div>
        )}
        {normalized.map((s, sIdx) => (
          <div className="sentence-tag" key={sIdx}>
            <span className="sentence-number">{sIdx + 1}.</span>
            <div className="sentence-tag-body">
              <span className="sentence-text-admin">{s.text}</span>
              {s.meaning && <span className="sentence-meaning-admin">{s.meaning}</span>}
            </div>
            <button className="remove-word" onClick={() => setDeleteSentenceConfirm(sIdx)} title="삭제">✕</button>
          </div>
        ))}
      </div>

      <div className="sm-add-form">
        <input
          ref={inputRef}
          className="add-word-input"
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newText.trim()) inputRef.current?.nextElementSibling?.focus(); }}
          placeholder="영어 문장 입력..."
        />
        <input
          className="add-word-input"
          type="text"
          value={newMeaning}
          onChange={(e) => setNewMeaning(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="뜻 입력 (선택사항)..."
        />
        <button className="add-word-btn" onClick={handleAdd}>추가</button>
      </div>

      {/* JSON 일괄 등록 */}
      <div className="sm-json-section">
        <button className="sm-json-toggle" onClick={() => { setShowJson(!showJson); setJsonMsg(''); }}>
          {showJson ? '▼' : '▶'} {'{ }'} JSON으로 한번에 추가
        </button>
        {showJson && (
          <div className="sm-json-panel">
            <div className="sm-json-help">
              AI에게 문장을 만들어 달라고 한 뒤, 받은 JSON을 붙여넣으세요. 형식:
              <code>{'{"sentences":[{"text":"English","meaning":"한국어 뜻"}]}'}</code>
            </div>
            <button className="sm-json-copy" onClick={copyPrompt}>
              {copied ? '✅ 복사됨!' : '📋 AI 프롬프트 복사'}
            </button>
            <textarea
              className="sm-json-textarea"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={'AI가 준 JSON을 여기에 붙여넣으세요...\n{\n  "sentences": [\n    { "text": "Hello!", "meaning": "안녕!" }\n  ]\n}'}
              rows={6}
            />
            {jsonMsg && <div className="sm-json-msg">{jsonMsg}</div>}
            <button className="sm-json-add" onClick={handleJsonAdd} disabled={!jsonText.trim()}>
              JSON 문장 추가
            </button>
          </div>
        )}
      </div>
      </>}

      {/* 문장 삭제 확인 팝업 */}
      {deleteSentenceConfirm >= 0 && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteSentenceConfirm(-1)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 문장을 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">"{normalized[deleteSentenceConfirm]?.text || normalized[deleteSentenceConfirm]}"</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteSentenceConfirm(-1)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeSentence(deleteSentenceConfirm); setDeleteSentenceConfirm(-1); }}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Lesson 삭제 확인 팝업 */}
      {deleteLessonConfirm && (
        <div className="sentence-delete-overlay" onClick={() => setDeleteLessonConfirm(false)}>
          <div className="sentence-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="sentence-delete-msg">
              <span className="sentence-delete-icon">⚠️</span>
              <p>이 Lesson을 정말 삭제할까요?</p>
              <p className="sentence-delete-preview">📅 {day.name} ({normalized.length}문장)</p>
            </div>
            <div className="sentence-delete-btns">
              <button className="sentence-delete-cancel" onClick={() => setDeleteLessonConfirm(false)}>취소</button>
              <button className="sentence-delete-confirm" onClick={() => { removeDay(dayIdx); setDeleteLessonConfirm(false); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
