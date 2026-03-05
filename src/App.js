import React, { useState, useCallback, useEffect, useRef } from 'react';
import './App.css';

// 🔑 Unsplash API Access Key (여기에 본인의 Access Key를 넣어주세요)
const UNSPLASH_ACCESS_KEY = 'lUEkIzFvUdSi5HFripV7x1DcCdqy_rirUOB8MHVb2_M';

// 빌드 시간 (빌드 시 .env.local에서 고정)
const BUILD_TIME = process.env.REACT_APP_BUILD_TIME || 'dev';

// localStorage key
const STORAGE_KEY = 'woojin-phonics-data-v2';

// 현재 년/월
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;

// 기본 데이터: { "YYYY-MM": [ {id, name, words} ] }
const toKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

const DEFAULT_DATA = {
  [toKey(CUR_YEAR, CUR_MONTH)]: [
    { id: Date.now(), name: 'Day 1', words: ['apple', 'ant', 'arm'] },
    { id: Date.now() + 1, name: 'Day 2', words: ['bear', 'ball', 'bus'] },
  ]
};

// localStorage 헬퍼
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;  // v2 구조
      }
    }
    // v1 배열 데이터 마이그레이션
    const oldRaw = localStorage.getItem('woojin-phonics-days');
    if (oldRaw) {
      const oldParsed = JSON.parse(oldRaw);
      if (Array.isArray(oldParsed) && oldParsed.length > 0) {
        const key = toKey(CUR_YEAR, CUR_MONTH);
        const migrated = { [key]: oldParsed.map((d, i) => d.id ? d : { ...d, id: Date.now() + i }) };
        return migrated;
      }
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_DATA;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// 학습 로그: [{ timestamp, yearMonth, dayName, word }]
const LOG_KEY = 'woojin-phonics-logs';

function loadLogs() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return [];
}

function saveLogs(logs) {
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}
// 메인 App 컴포넌트
// ======================================================
function App() {
  // 화면 전환: 'learning' | 'admin' | 'log'
  const [screen, setScreen] = useState('learning');

  // 학습 로그
  const [logs, setLogs] = useState(() => loadLogs());

  // 전체 데이터: { "YYYY-MM": [ {id, name, words} ] }
  const [data, setData] = useState(() => loadData());

  // 년/월 선택
  const [selectedYear, setSelectedYear] = useState(CUR_YEAR);
  const [selectedMonth, setSelectedMonth] = useState(CUR_MONTH);

  // 학습 상태
  const [selectedDayIndex, setSelectedDayIndex] = useState(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [displayWord, setDisplayWord] = useState('');

  const audioRef = useRef(new Audio());
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const resumeResolveRef = useRef(null);

  // 현재 선택된 년/월의 키와 Day 목록
  const currentKey = toKey(selectedYear, selectedMonth);
  const days = data[currentKey] || [];

  // 데이터 변경 시 저장
  useEffect(() => {
    saveData(data);
  }, [data]);

  // 년/월 변경 시 Day 선택 초기화
  const handleYearChange = (y) => { setSelectedYear(y); setSelectedDayIndex(-1); };
  const handleMonthChange = (m) => { setSelectedMonth(m); setSelectedDayIndex(-1); };

  // 데이터에 존재하는 년도 목록 (현재 년도 포함)
  const availableYears = [...new Set([
    CUR_YEAR,
    ...Object.keys(data).map(k => parseInt(k.split('-')[0]))
  ])].sort();

  // ─── TTS 관련 ───
  const getFemaleVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    let voice = voices.find(v => v.name === 'Google US English');
    if (!voice) voice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
    if (!voice) voice = voices.find(v => v.name.includes('Zira') || v.name.includes('Samantha'));
    return voice;
  };

  const wakeUpEngine = () => {
    const synth = window.speechSynthesis;
    const ut = new SpeechSynthesisUtterance('');
    synth.speak(ut);
    audioRef.current.play().catch(() => { });
  };

  const speakAndWait = (text) => {
    return new Promise((resolve) => {
      if (abortRef.current) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.7;
      const voice = getFemaleVoice();
      if (voice) utterance.voice = voice;
      const forceNext = setTimeout(resolve, 3000);
      utterance.onend = () => { clearTimeout(forceNext); resolve(); };
      utterance.onerror = () => { clearTimeout(forceNext); resolve(); };
      synth.speak(utterance);
    });
  };

  // ─── 오디오 재생 ───
  const playAudio = useCallback((letter) => new Promise((res) => {
    if (abortRef.current) { res(); return; }
    const fileName = `${letter.toLowerCase()}_phonics.mp3`;
    const audioPath = process.env.PUBLIC_URL + `/audio/${fileName}`;
    const audio = audioRef.current;
    audio.src = audioPath;
    audio.volume = 1.0;
    audio.load();
    const checkNoiseCut = () => {
      if (audio.duration - audio.currentTime < 0.15) {
        audio.volume = 0;
        audio.removeEventListener('timeupdate', checkNoiseCut);
      }
    };
    audio.addEventListener('timeupdate', checkNoiseCut);
    audio.onended = res;
    audio.onerror = res;
    audio.play().catch(res);
  }), []);

  // ─── 이미지 프리로드 헬퍼 (실제 로드 확인 후 URL 반환) ───
  const preloadImage = useCallback((url, timeoutMs = 6000) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
      img.src = url;
    });
  }, []);

  // ─── 이미지 검색 (Unsplash API) ───
  const fetchImage = useCallback(async (word) => {
    const query = word.toLowerCase().trim();
    setImageLoading(true);
    setImageUrl('');

    if (!UNSPLASH_ACCESS_KEY) {
      setImageLoading(false);
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
        {
          signal: controller.signal,
          headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
        }
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const imgUrl = data.results[0].urls.regular;
          await preloadImage(imgUrl);
          setImageUrl(imgUrl);
          setImageLoading(false);
          return;
        }
      }
    } catch { /* Unsplash 실패 */ }

    setImageUrl('');
    setImageLoading(false);
  }, [preloadImage]);

  // ─── 일시정지 대기 헬퍼 ───
  const waitForResume = () => {
    if (!pauseRef.current) return Promise.resolve();
    return new Promise(resolve => { resumeResolveRef.current = resolve; });
  };

  // ─── 단일 단어 학습 사이클 ───
  const learnOneWord = async (word) => {
    const cleanWord = word.toLowerCase().trim();
    const firstLetter = cleanWord[0];

    setDisplayWord(cleanWord);
    fetchImage(cleanWord);

    if (/[a-z]/.test(firstLetter)) {
      // 알파벳 이름 3회
      setCurrentStep('alphabet');
      for (let i = 0; i < 3; i++) {
        if (abortRef.current) return;
        await waitForResume();
        await speakAndWait(firstLetter);
        await new Promise(r => setTimeout(r, 800));
      }

      // 파닉스 음가 3회
      setCurrentStep('phonics');
      for (let i = 0; i < 3; i++) {
        if (abortRef.current) return;
        await waitForResume();
        await playAudio(firstLetter);
        await new Promise(r => setTimeout(r, 800));
      }

      // 단어 전체 3회
      setCurrentStep('word');
      for (let i = 0; i < 3; i++) {
        if (abortRef.current) return;
        await waitForResume();
        await speakAndWait(word);
        await new Promise(r => setTimeout(r, 900));
      }
    }
  };

  // ─── 학습 완료 마킹 + 로그 기록 ───
  const markWordLearned = (dayIdx, wordIdx) => {
    const dayData = days[dayIdx];
    const word = dayData?.words[wordIdx];
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) => {
          if (i !== dayIdx) return d;
          const learned = d.learnedWords ? [...d.learnedWords] : [];
          if (!learned.includes(wordIdx)) learned.push(wordIdx);
          return { ...d, learnedWords: learned };
        })
      };
    });
    // 로그 기록
    if (word) {
      const logEntry = {
        timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        yearMonth: currentKey,
        dayName: dayData.name,
        word: word
      };
      setLogs(prev => {
        const updated = [...prev, logEntry];
        saveLogs(updated);
        return updated;
      });
    }
  };

  // ─── 학습 시작 (선택된 Day의 모든 단어 순차 학습) ───
  const startLearning = async () => {
    if (isPlaying || selectedDayIndex < 0) return;
    const dayData = days[selectedDayIndex];
    if (!dayData || dayData.words.length === 0) return;

    setIsPlaying(true);
    setIsPaused(false);
    abortRef.current = false;
    pauseRef.current = false;
    wakeUpEngine();

    for (let i = 0; i < dayData.words.length; i++) {
      if (abortRef.current) break;
      setCurrentWordIndex(i);
      await learnOneWord(dayData.words[i]);
      // 학습 완료 마킹 (중단된 게 아니면)
      if (!abortRef.current) {
        markWordLearned(selectedDayIndex, i);
      }
      // 단어 사이 짧은 대기
      if (i < dayData.words.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    setCurrentStep('');
    setIsPlaying(false);
  };

  // ─── 학습 중지 ───
  const stopLearning = () => {
    abortRef.current = true;
    pauseRef.current = false;
    if (resumeResolveRef.current) { resumeResolveRef.current(); resumeResolveRef.current = null; }
    window.speechSynthesis.cancel();
    const audio = audioRef.current;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentStep('');
  };

  // ─── 일시정지 / 재개 ───
  const pauseLearning = () => {
    pauseRef.current = true;
    setIsPaused(true);
    window.speechSynthesis.pause();
    audioRef.current.pause();
  };

  const resumeLearning = () => {
    pauseRef.current = false;
    setIsPaused(false);
    window.speechSynthesis.resume();
    audioRef.current.play().catch(() => { });
    if (resumeResolveRef.current) { resumeResolveRef.current(); resumeResolveRef.current = null; }
  };

  // ─── 목소리 로딩 ───
  useEffect(() => {
    const load = () => window.speechSynthesis.getVoices();
    load();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  // Day 선택 핸들러
  const handleDaySelect = (idx) => {
    if (isPlaying) return;
    setSelectedDayIndex(idx);
    setCurrentWordIndex(0);
    setDisplayWord('');
    setImageUrl('');
    setCurrentStep('');
  };

  // ─── 관리자 기능 ───
  const addDay = () => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return { ...prev, [currentKey]: [...arr, { id: Date.now(), name: `Day ${arr.length + 1}`, words: [] }] };
    });
  };

  const removeDay = (idx) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      const updated = arr.filter((_, i) => i !== idx);
      return { ...prev, [currentKey]: updated };
    });
    if (selectedDayIndex === idx) {
      setSelectedDayIndex(-1);
    } else if (selectedDayIndex > idx) {
      setSelectedDayIndex(prev => prev - 1);
    }
  };

  const addWordToDay = (dayIdx, word) => {
    if (!word.trim()) return;
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, words: [...d.words, word.trim().toLowerCase()] } : d
        )
      };
    });
  };

  const removeWordFromDay = (dayIdx, wordIdx) => {
    setData(prev => {
      const arr = prev[currentKey] || [];
      return {
        ...prev, [currentKey]: arr.map((d, i) =>
          i === dayIdx ? { ...d, words: d.words.filter((_, wi) => wi !== wordIdx) } : d
        )
      };
    });
  };

  // ─── 렌더링 ───
  const selectedDay = selectedDayIndex >= 0 ? days[selectedDayIndex] : null;
  const totalWords = selectedDay ? selectedDay.words.length : 0;

  return (
    <div className="app-container">
      {/* ===== Header ===== */}
      <header className="app-header">
        <div className="app-title">
          <span className="emoji">🍎</span>
          우진이 파닉스 선생님
        </div>
        <div className="header-btns">
          {screen === 'learning' ? (
            <>
              <button className="header-btn admin" onClick={() => setScreen('admin')}>
                📋 단어 관리
              </button>
              <button className="header-btn log" onClick={() => setScreen('log')}>
                📊 로그
              </button>
            </>
          ) : (
            <button className="header-btn home" onClick={() => setScreen('learning')}>
              🏠 학습으로
            </button>
          )}
        </div>
      </header>

      {/* ===== Learning Screen ===== */}
      {screen === 'learning' && (
        <main className="learning-main">
          {/* Left panel: image + word */}
          <section className="learning-left">
            <div className="image-area">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={displayWord}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    setImageUrl('');
                  }}
                />
              ) : (
                <div className="image-placeholder">
                  {imageLoading ? (
                    <>
                      <span className="placeholder-emoji loading-spin">🔍</span>
                      이미지를 찾고 있어요...
                    </>
                  ) : (
                    <>
                      <span className="placeholder-emoji">📖</span>
                      {displayWord ? '이미지를 찾지 못했어요 😢' : '단어를 선택하고 학습을 시작해봐!'}
                    </>
                  )}
                </div>
              )}
            </div>

            {displayWord && (
              <div className="word-display">
                <span className="first-letter wiggle">{displayWord[0]}</span>
                <span className="rest-letters">{displayWord.substring(1)}</span>
              </div>
            )}
          </section>

          {/* Right panel: controls */}
          <aside className="learning-right">
            {/* Year / Month / Day Selector */}
            <div className="day-selector">
              <div className="section-title">📅 년/월 선택</div>
              {/* Year selector */}
              <div className="ym-row">
                <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)} disabled={isPlaying}>◀</button>
                <span className="ym-label">{selectedYear}년</span>
                <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)} disabled={isPlaying}>▶</button>
              </div>
              {/* Month selector */}
              <div className="month-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                  <button
                    key={m}
                    className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
                    onClick={() => handleMonthChange(m)}
                    disabled={isPlaying}
                  >
                    {m}월
                  </button>
                ))}
              </div>
              {/* Day buttons */}
              <div className="section-title" style={{ marginTop: 8 }}>📚 Day 선택</div>
              <div className="day-buttons">
                {days.map((day, i) => {
                  const learnedCount = (day.learnedWords || []).length;
                  const isCompleted = day.words.length > 0 && learnedCount >= day.words.length;
                  return (
                    <button
                      key={day.id || i}
                      className={`day-btn ${selectedDayIndex === i ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                      onClick={() => handleDaySelect(i)}
                      disabled={isPlaying}
                    >
                      {isCompleted && '✅ '}{day.name}
                      {day.words.length > 0 && <span className="day-progress">{learnedCount}/{day.words.length}</span>}
                    </button>
                  );
                })}
              </div>
              {days.length === 0 && (
                <div style={{ color: 'var(--color-text-light)', marginTop: 8, fontFamily: 'var(--font-kr)', fontSize: '0.9rem' }}>
                  이 달에는 아직 Day가 없어요!
                </div>
              )}
            </div>

            {selectedDay ? (
              <>
                {/* Word Info */}
                <div className="word-info-card">
                  <div className="current-word-label">📝 현재 학습 단어</div>
                  <div className="current-word-text">
                    {isPlaying ? selectedDay.words[currentWordIndex] : (selectedDay.words[0] || '(없음)')}
                    {isPlaying && (selectedDay.learnedWords || []).includes(currentWordIndex) && ' ✅'}
                  </div>
                  <div className="word-counter">
                    {selectedDay.words.length}개 단어 · {(selectedDay.learnedWords || []).length}개 학습 완료
                  </div>

                  {/* Progress */}
                  {isPlaying && totalWords > 0 && (
                    <div className="progress-container">
                      <div className="progress-bar-bg">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${((currentWordIndex + 1) / totalWords) * 100}%` }}
                        />
                      </div>
                      <div className="progress-text">
                        {currentWordIndex + 1} / {totalWords}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step Indicator */}
                {isPlaying && (
                  <div className="step-indicator">
                    <div className="step-label">🔊 학습 단계</div>
                    <div className="steps">
                      <div className={`step ${currentStep === 'alphabet' ? 'active' : currentStep === 'phonics' || currentStep === 'word' ? 'done' : ''}`}>
                        알파벳
                      </div>
                      <div className={`step ${currentStep === 'phonics' ? 'active' : currentStep === 'word' ? 'done' : ''}`}>
                        파닉스
                      </div>
                      <div className={`step ${currentStep === 'word' ? 'active' : ''}`}>
                        단어
                      </div>
                    </div>
                  </div>
                )}

                {/* Start / Pause / Stop Buttons */}
                <div className="start-btn-container">
                  {isPlaying ? (
                    <div className="btn-row">
                      <button
                        className={`start-btn ${isPaused ? 'resume' : 'pause'}`}
                        onClick={isPaused ? resumeLearning : pauseLearning}
                      >
                        <span className="btn-emoji">{isPaused ? '▶️' : '⏸️'}</span>
                        {isPaused ? '계속하기' : '일시정지'}
                      </button>
                      <button
                        className="start-btn stop"
                        onClick={stopLearning}
                      >
                        <span className="btn-emoji">⏹️</span>
                        멈추기
                      </button>
                    </div>
                  ) : (
                    <button
                      className="start-btn ready"
                      onClick={startLearning}
                      disabled={selectedDay.words.length === 0}
                    >
                      <span className="btn-emoji">▶️</span>
                      학습 시작!
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="no-day-message">
                <span className="msg-emoji">👆</span>
                <span className="msg-text">위에서 Day를 선택해 주세요!</span>
              </div>
            )}
          </aside>
        </main>
      )
      }

      {/* ===== Admin Screen ===== */}
      {
        screen === 'admin' && (
          <AdminPage
            days={days}
            addDay={addDay}
            removeDay={removeDay}
            addWordToDay={addWordToDay}
            removeWordFromDay={removeWordFromDay}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
            handleYearChange={handleYearChange}
            handleMonthChange={handleMonthChange}
            isPlaying={isPlaying}
          />
        )}

      {/* ===== Log Screen ===== */}
      {screen === 'log' && (
        <LogPage
          logs={logs}
          setLogs={setLogs}
          data={data}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          handleYearChange={handleYearChange}
          handleMonthChange={handleMonthChange}
        />
      )}

      {/* ===== Footer - Build Info ===== */}
      <div className="build-footer">
        마지막 빌드: {BUILD_TIME}
      </div>
    </div >
  );
}

// ======================================================
// 관리자 페이지 컴포넌트
// ======================================================
function AdminPage({ days, addDay, removeDay, addWordToDay, removeWordFromDay, selectedYear, selectedMonth, handleYearChange, handleMonthChange }) {
  return (
    <div className="admin-container">
      {/* Year / Month selector */}
      <div className="day-selector" style={{ marginBottom: 8 }}>
        <div className="section-title">📅 년/월 선택</div>
        <div className="ym-row">
          <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)}>◀</button>
          <span className="ym-label">{selectedYear}년</span>
          <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)}>▶</button>
        </div>
        <div className="month-buttons">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
            <button
              key={m}
              className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
              onClick={() => handleMonthChange(m)}
            >
              {m}월
            </button>
          ))}
        </div>
      </div>

      <div className="admin-top-bar">
        <button className="add-day-btn" onClick={addDay}>
          ➕ Day 추가 ({selectedYear}년 {selectedMonth}월)
        </button>
      </div>

      {days.length === 0 && (
        <div className="no-day-message">
          <span className="msg-emoji">📝</span>
          <span className="msg-text">{selectedYear}년 {selectedMonth}월에 Day가 없어요. 위 버튼으로 추가해 주세요!</span>
        </div>
      )}

      {days.map((day, dayIdx) => (
        <DayCard
          key={day.id || dayIdx}
          day={day}
          dayIdx={dayIdx}
          removeDay={removeDay}
          addWordToDay={addWordToDay}
          removeWordFromDay={removeWordFromDay}
        />
      ))}
    </div>
  );
}

// ======================================================
// Day 카드 컴포넌트
// ======================================================
function DayCard({ day, dayIdx, removeDay, addWordToDay, removeWordFromDay }) {
  const [newWord, setNewWord] = useState('');
  const inputRef = useRef(null);

  const handleAdd = () => {
    if (newWord.trim()) {
      addWordToDay(dayIdx, newWord);
      setNewWord('');
    }
    // 추가 후 입력 필드에 포커스
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <div className="day-card">
      <div className="day-card-header">
        <div className="day-card-title">
          📅 {day.name}
          {day.words.length > 0 && (
            <span className="day-card-progress">
              ({(day.learnedWords || []).length}/{day.words.length}
              {(day.learnedWords || []).length >= day.words.length ? ' ✅' : ''})
            </span>
          )}
        </div>
        <button className="delete-day-btn" onClick={() => removeDay(dayIdx)}>
          🗑️ 삭제
        </button>
      </div>

      <div className="word-tags">
        {day.words.length === 0 && (
          <div className="empty-words">아직 단어가 없어요. 아래에서 추가해 주세요!</div>
        )}
        {day.words.map((word, wordIdx) => {
          const isLearned = (day.learnedWords || []).includes(wordIdx);
          return (
            <div className={`word-tag ${isLearned ? 'learned' : ''}`} key={wordIdx}>
              {isLearned && '✅ '}{word}
              <button
                className="remove-word"
                onClick={() => removeWordFromDay(dayIdx, wordIdx)}
                title="삭제"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="add-word-row">
        <input
          ref={inputRef}
          className="add-word-input"
          type="text"
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="단어 입력..."
        />
        <button className="add-word-btn" onClick={handleAdd}>
          추가
        </button>
      </div>
    </div>
  );
}

// ======================================================
// 로그 페이지 컴포넌트
// ======================================================
function LogPage({ logs, setLogs, data, selectedYear, selectedMonth, handleYearChange, handleMonthChange }) {
  const [filterDay, setFilterDay] = useState('all');

  const currentKey = toKey(selectedYear, selectedMonth);
  const monthDays = data[currentKey] || [];

  // 필터링된 로그
  const filteredLogs = logs.filter(log => {
    if (log.yearMonth !== currentKey) return false;
    if (filterDay !== 'all' && log.dayName !== filterDay) return false;
    return true;
  }).reverse(); // 최신순

  const clearLogs = () => {
    if (window.confirm('이 달의 로그를 모두 삭제하시겠습니까?')) {
      const remaining = logs.filter(log => log.yearMonth !== currentKey);
      setLogs(remaining);
      saveLogs(remaining);
    }
  };

  return (
    <div className="admin-container">
      {/* Year/Month selector */}
      <div className="day-selector" style={{ marginBottom: 8 }}>
        <div className="section-title">📅 년/월 선택</div>
        <div className="ym-row">
          <button className="ym-arrow" onClick={() => handleYearChange(selectedYear - 1)}>◀</button>
          <span className="ym-label">{selectedYear}년</span>
          <button className="ym-arrow" onClick={() => handleYearChange(selectedYear + 1)}>▶</button>
        </div>
        <div className="month-buttons">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
            <button
              key={m}
              className={`month-btn ${selectedMonth === m ? 'active' : ''}`}
              onClick={() => { handleMonthChange(m); setFilterDay('all'); }}
            >
              {m}월
            </button>
          ))}
        </div>
      </div>

      {/* Day filter */}
      <div className="day-selector" style={{ marginBottom: 8 }}>
        <div className="section-title">📚 Day 필터</div>
        <div className="day-buttons">
          <button
            className={`day-btn ${filterDay === 'all' ? 'active' : ''}`}
            onClick={() => setFilterDay('all')}
          >
            전체
          </button>
          {monthDays.map((day, i) => (
            <button
              key={day.id || i}
              className={`day-btn ${filterDay === day.name ? 'active' : ''}`}
              onClick={() => setFilterDay(day.name)}
            >
              {day.name}
            </button>
          ))}
        </div>
      </div>

      {/* Log controls */}
      <div className="admin-top-bar">
        <span style={{ fontFamily: 'var(--font-kr)', fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
          📊 {filteredLogs.length}개 로그
        </span>
        {filteredLogs.length > 0 && (
          <button className="delete-day-btn" onClick={clearLogs}>
            🗑️ 이 달 로그 삭제
          </button>
        )}
      </div>

      {/* Log entries */}
      {filteredLogs.length === 0 ? (
        <div className="no-day-message">
          <span className="msg-emoji">📭</span>
          <span className="msg-text">학습 로그가 없습니다.</span>
        </div>
      ) : (
        <div className="log-list">
          {filteredLogs.map((log, i) => (
            <div className="log-entry" key={i}>
              <span className="log-word">📗 {log.word}</span>
              <span className="log-day">{log.dayName}</span>
              <span className="log-time">{log.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;