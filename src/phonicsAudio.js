// ============================================================
// 파닉스 음원 저장·재생
//   저장: Firestore  phonics/{파일명}  { data: base64 }
//   캐시: IndexedDB (한 번 받으면 오프라인에서도 즉시 재생)
//   재생: AudioContext (TTS와 동일한 저지연 경로)
// ============================================================
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const DB_NAME = 'woojin-phonics-audio';
const STORE = 'sounds';
let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(name) {
  try {
    const d = await openDB();
    return await new Promise((resolve) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(name);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

async function cacheSet(name, bytes) {
  try {
    const d = await openDB();
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, name);
  } catch (e) { /* ignore */ }
}

// base64 → Uint8Array
function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ─── 업로드 (설정 화면 도구에서 사용) ───
export async function uploadPhonicsSound(fileName, base64) {
  // Firestore 문서 한도 1MiB — base64는 원본의 약 1.34배
  if (base64.length > 950000) {
    throw new Error(`파일이 너무 커요 (${Math.round(base64.length / 1024)}KB). 700KB 이하 mp3만 올릴 수 있어요.`);
  }
  await setDoc(doc(db, 'phonics', fileName), {
    data: base64,
    updatedAt: new Date().toISOString(),
  });
  const bytes = b64ToBytes(base64);
  await cacheSet(fileName, bytes);   // 올린 즉시 캐시에도
  memCache.set(fileName, bytes);     // "없음"으로 기록돼 있던 것을 덮어씀
  decoded.delete(fileName);          // 다음 재생 때 새로 디코딩
}

// 등록된 음원 파일명 목록
export async function listPhonicsSounds() {
  try {
    const snap = await getDocs(collection(db, 'phonics'));
    return snap.docs.map(d => d.id);
  } catch (e) { return []; }
}

// ─── 재생 ───
const memCache = new Map(); // 파일명 → Uint8Array (세션 메모리)
let ctx = null;
let curSource = null;
let curFinish = null;   // 재생 중인 소리를 끝내는 함수 (멈춤 처리용)

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

async function getBytes(fileName) {
  if (memCache.has(fileName)) return memCache.get(fileName); // null(없음)도 캐시됨
  let bytes = await cacheGet(fileName);        // 1) IndexedDB
  if (!bytes) {
    try {                                       // 2) Firestore
      const snap = await getDoc(doc(db, 'phonics', fileName));
      if (snap.exists() && snap.data().data) {
        bytes = b64ToBytes(snap.data().data);
        cacheSet(fileName, bytes);
      }
    } catch (e) { /* ignore */ }
  }
  memCache.set(fileName, bytes || null); // 없는 음원도 기록 → 매번 네트워크 조회 방지
  return bytes;
}

// 디코딩까지 끝난 오디오 (재생 직전 지연을 없애기 위해 미리 준비)
const decoded = new Map(); // 파일명 → { audio, gain } | null

// 파일마다 녹음 크기가 달라서 그대로 틀면 Azure 음성보다 작게 들린다.
// 가장 큰 진폭을 찾아 일정 크기로 맞춰 준다. (찌그러지지 않게 0.92까지만)
const TARGET_PEAK = 0.92;
function normalizeGain(audio) {
  let peak = 0;
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch);
    const step = data.length > 100000 ? 3 : 1;   // 긴 파일은 띄엄띄엄 (속도)
    for (let i = 0; i < data.length; i += step) {
      const v = data[i] < 0 ? -data[i] : data[i];
      if (v > peak) peak = v;
    }
  }
  if (peak < 0.001) return 1;
  return Math.min(8, TARGET_PEAK / peak);
}

async function getBuffer(fileName) {
  if (decoded.has(fileName)) return decoded.get(fileName);
  const bytes = await getBytes(fileName);
  if (!bytes) { decoded.set(fileName, null); return null; }
  try {
    const c = audioCtx();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audio = await c.decodeAudioData(buf);
    const entry = { audio, gain: normalizeGain(audio) };
    decoded.set(fileName, entry);
    return entry;
  } catch (e) {
    decoded.set(fileName, null);
    return null;
  }
}

/**
 * 쓸 음원을 미리 내려받아 디코딩까지 해 둠
 * (이어 읽기처럼 조각을 연달아 재생할 때 첫 소리가 밀리지 않게)
 */
export async function preloadPhonicsSounds(fileNames = []) {
  const uniq = [...new Set(fileNames.filter(Boolean))];
  await Promise.all(uniq.map(f => getBuffer(f).catch(() => null)));
}

/**
 * 파닉스 소리 재생. 성공하면 true
 * @param fileName 음원 파일명
 * @param onStart  실제로 소리가 나기 시작할 때 호출 (화면 강조를 소리에 맞추기 위함)
 *
 * 끝나는 시점은 onended가 아니라 "버퍼 길이 + 스피커 출력 지연"으로 계산한다.
 * onended는 오디오 그래프 기준이라 블루투스·태블릿에서 실제 소리보다 먼저 온다.
 */
export async function playPhonicsSound(fileName, onStart) {
  if (!fileName) return false;
  const entry = await getBuffer(fileName);
  if (!entry) return false;
  const { audio, gain } = entry;
  try {
    const c = audioCtx();
    stopPhonicsSound();
    const src = c.createBufferSource();
    src.buffer = audio;
    // 녹음마다 다른 음량을 Azure 음성과 비슷한 크기로 맞춤
    const vol = c.createGain();
    vol.gain.value = gain;
    src.connect(vol);
    vol.connect(c.destination);
    curSource = src;

    const lead = 0.02;                                   // 예약 여유
    const latency = c.outputLatency || c.baseLatency || 0; // 스피커까지 걸리는 시간
    const startAt = c.currentTime + lead;
    src.start(startAt);
    if (onStart) setTimeout(onStart, (lead + latency) * 1000); // 소리와 강조를 맞춤

    return await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        curSource = null;
        curFinish = null;
        resolve(true);
      };
      curFinish = finish;                                  // 중간에 멈추면 바로 끝냄
      const endsIn = lead + audio.duration + latency + 0.08; // 여운 조금
      setTimeout(finish, endsIn * 1000);
    });
  } catch (e) { return false; }
}

export function stopPhonicsSound() {
  if (curSource) { try { curSource.stop(); } catch (e) { /* */ } curSource = null; }
  if (curFinish) { const f = curFinish; curFinish = null; f(); } // 대기 중인 재생도 즉시 종료
}

/** 이 소리가 등록되어 있는지 (버튼 표시 여부 판단용) */
export async function hasPhonicsSound(fileName) {
  if (!fileName) return false;
  if (memCache.has(fileName)) return true;
  const c = await cacheGet(fileName);
  if (c) return true;
  try {
    const snap = await getDoc(doc(db, 'phonics', fileName));
    return snap.exists();
  } catch (e) { return false; }
}
