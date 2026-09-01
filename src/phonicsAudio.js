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
  await cacheSet(fileName, b64ToBytes(base64)); // 올린 즉시 캐시에도
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

/** 파닉스 소리 재생. 성공하면 true */
export async function playPhonicsSound(fileName) {
  if (!fileName) return false;
  const bytes = await getBytes(fileName);
  if (!bytes) return false;
  try {
    const c = audioCtx();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audio = await c.decodeAudioData(buf);
    stopPhonicsSound();
    const src = c.createBufferSource();
    src.buffer = audio;
    src.connect(c.destination);
    curSource = src;
    return await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; curSource = null; resolve(v); };
      src.onended = () => finish(true);
      src.start(0);
      // onended가 오지 않는 경우 대비 (버퍼 길이 + 1초)
      setTimeout(() => finish(true), (audio.duration + 1) * 1000);
    });
  } catch (e) { return false; }
}

export function stopPhonicsSound() {
  if (curSource) { try { curSource.stop(); } catch (e) { /* */ } curSource = null; }
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
