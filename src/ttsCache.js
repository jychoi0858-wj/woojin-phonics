// ============================================================
// TTS 오디오 캐시 (IndexedDB + LRU 자동 정리)
// 같은 텍스트+음성+속도 조합은 한 번만 Azure 호출, 이후 캐시 재생
// ============================================================

const DB_NAME = 'woojin-tts-cache';
const STORE_NAME = 'audio';
const DB_VERSION = 1;
const MAX_ITEMS = 1000; // 최대 캐시 항목 수 (약 50~100MB)
const CLEANUP_BATCH = 200; // 초과 시 한 번에 삭제할 개수

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 캐시에서 오디오 데이터 조회 (히트 시 lastUsed 갱신)
 */
export async function getCachedAudio(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const data = req.result;
        if (data && data.audio) {
          // lastUsed 갱신 (LRU)
          data.lastUsed = Date.now();
          store.put(data, key);
          resolve(data.audio);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * 오디오 데이터를 캐시에 저장 + 초과 시 LRU 정리
 */
export async function setCachedAudio(key, audioData) {
  try {
    const db = await openDB();
    const now = Date.now();

    // 저장
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ audio: audioData, createdAt: now, lastUsed: now }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    // 초과 확인 & 정리 (비동기, 블로킹하지 않음)
    evictIfNeeded(db);
  } catch (e) {
    // 캐시 저장 실패해도 앱은 정상 동작
  }
}

/**
 * MAX_ITEMS 초과 시 가장 오래된(lastUsed 기준) 항목 삭제
 */
async function evictIfNeeded(db) {
  try {
    const count = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });

    if (count <= MAX_ITEMS) return;

    // 모든 키+lastUsed 조회
    const entries = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const items = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          items.push({ key: cursor.key, lastUsed: cursor.value.lastUsed || 0 });
          cursor.continue();
        } else {
          resolve(items);
        }
      };
      cursorReq.onerror = () => resolve([]);
    });

    // lastUsed 오름차순 정렬 → 가장 오래된 것부터 삭제
    entries.sort((a, b) => a.lastUsed - b.lastUsed);
    const toDelete = entries.slice(0, CLEANUP_BATCH);

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const item of toDelete) {
      store.delete(item.key);
    }
  } catch (e) {
    // 정리 실패해도 무시
  }
}

/**
 * 캐시된 오디오를 재생 (iOS 호환 — AudioContext 사용)
 */
let _audioCtx = null;
let _currentSource = null;  // 현재 재생 중인 AudioBufferSourceNode
let _currentFallbackAudio = null;  // 폴백 Audio 엘리먼트

function getAudioContext() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); // 저지연
    _startKeepAlive(_audioCtx); // 무음 루프로 엔진 상시 가동 (절전→깨우기 지연 제거)
  }
  // iOS에서 suspended 상태일 수 있음 → resume
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  return _audioCtx;
}

// 무음 루프: 안드로이드가 오디오 엔진을 재우지 않게 유지 → 매 재생 시 깨우기 지연 없음
function _startKeepAlive(ctx) {
  try {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1초 무음
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
  } catch (e) { /* ignore */ }
}

export function playCachedAudio(audioData) {
  return new Promise(async (resolve) => {
    try {
      const ctx = getAudioContext();
      // Uint8Array → ArrayBuffer 복사 (decodeAudioData가 소유권 가져감)
      const buffer = audioData.buffer.slice(
        audioData.byteOffset,
        audioData.byteOffset + audioData.byteLength
      );
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const source = ctx.createBufferSource();
      _currentSource = source;
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => { _currentSource = null; resolve(); };
      source.start(0);
    } catch (e) {
      // AudioContext 실패 시 Audio 엘리먼트 폴백
      try {
        const blob = new Blob([audioData], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        _currentFallbackAudio = audio;
        audio.onended = () => { _currentFallbackAudio = null; URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { _currentFallbackAudio = null; URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => { _currentFallbackAudio = null; URL.revokeObjectURL(url); resolve(); });
      } catch (e2) {
        resolve();
      }
    }
  });
}

/**
 * 음원 모듈(AudioContext) 완전 초기화
 * 재생이 꼬였을 때 호출 — AudioContext를 닫고 새로 생성
 */
export async function resetAudioModule() {
  // 현재 재생 중지
  stopCachedAudio();
  // AudioContext 닫기
  if (_audioCtx) {
    try { await _audioCtx.close(); } catch (e) { /* ignore */ }
    _audioCtx = null;
  }
  // 브라우저 TTS도 취소
  window.speechSynthesis.cancel();
  // 새 AudioContext 생성 + 무음 재생으로 활성화
  try {
    const ctx = getAudioContext();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) { /* ignore */ }
}

/**
 * 현재 재생 중인 캐시 오디오 즉시 중지
 */
export function stopCachedAudio() {
  if (_currentSource) {
    try { _currentSource.stop(); } catch (e) { /* ignore */ }
    _currentSource = null;
  }
  if (_currentFallbackAudio) {
    try { _currentFallbackAudio.pause(); _currentFallbackAudio.currentTime = 0; } catch (e) { /* ignore */ }
    _currentFallbackAudio = null;
  }
}

/**
 * iOS 오디오 잠금 해제 — 사용자 제스처 시 동기적으로 호출해야 함
 * AudioContext를 생성/resume하고 무음 버퍼를 재생하여 iOS 오디오 잠금 해제
 */
export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    // 무음 버퍼 재생 (iOS에서 오디오 세션 활성화)
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) {
    // ignore
  }
}

/**
 * 캐시 키 생성
 */
export function makeCacheKey(text, voice, rate, ipa) {
  if (ipa) {
    return `ipa|${voice}|${rate}|${ipa}`;
  }
  return `txt|${voice}|${rate}|${text.toLowerCase()}`;
}

/**
 * 캐시 통계 조회
 */
export async function getCacheStats() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve({ count: req.result });
      req.onerror = () => resolve({ count: 0 });
    });
  } catch (e) {
    return { count: 0 };
  }
}

/**
 * 캐시 전체 삭제
 */
export async function clearCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {
    // ignore
  }
}
