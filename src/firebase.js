import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, increment, collection, getDocs, query } from 'firebase/firestore';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider, deleteUser
} from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyCKgtNTmlI73t68N-LCKm97Nseb9peB5zs",
    authDomain: "woojin-phonics.firebaseapp.com",
    projectId: "woojin-phonics",
    storageBucket: "woojin-phonics.firebasestorage.app",
    messagingSenderId: "410270243126",
    appId: "1:410270243126:web:780aac7a6f8b38d2d13b97"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export { db }; // 파닉스 음원 등 다른 모듈에서 사용
const auth = getAuth(app);

// ─── 이메일 변환 (아이디 → 가짜 이메일) ───
const EMAIL_DOMAIN = '@phonics.app';
function toEmail(username) {
  return username.toLowerCase().trim() + EMAIL_DOMAIN;
}

// Firebase Auth는 최소 6자 비밀번호 요구 → 내부적으로 패딩 추가
function padPassword(pw) {
  return pw + '__PH';  // 4자 → 8자로 패딩
}

// ─── 인증 함수 ───
export async function loginUser(username, password) {
  const email = toEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, padPassword(password));
  return cred.user;
}

export async function signupUser(username, password) {
  const email = toEmail(username);
  const cred = await createUserWithEmailAndPassword(auth, email, padPassword(password));
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      // 이메일에서 아이디 추출
      const username = user.email.replace(EMAIL_DOMAIN, '');
      callback({ uid: user.uid, username });
    } else {
      callback(null);
    }
  });
}

// ─── 유저별 Firestore 문서 참조 ───
function userDoc(uid, docName) {
  return doc(db, 'users', uid, 'data', docName);
}

// ─── 데이터 읽기/쓰기 (유저별) ───
// 반환: 데이터 객체 | null(문서 없음) | undefined(로드 실패 → 로컬 캐시 유지해야 함)
export async function loadDataFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'words'));
        return snap.exists() ? snap.data().content : null;
    } catch (e) {
        console.warn('Firestore loadData 실패:', e);
        return undefined; // 네트워크 오류 — 데이터 없음과 구분
    }
}

export async function saveDataToFirestore(uid, data) {
    try {
        await setDoc(userDoc(uid, 'words'), { content: data, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveData 실패:', e);
    }
}

// ─── 로그 읽기/쓰기 (유저별) ───
export async function loadLogsFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'logs'));
        if (snap.exists()) return snap.data().entries || [];
    } catch (e) {
        console.warn('Firestore loadLogs 실패:', e);
    }
    return null;
}

export async function saveLogsToFirestore(uid, logs) {
    try {
        await setDoc(userDoc(uid, 'logs'), { entries: logs, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveLogs 실패:', e);
    }
}

// ─── 실시간 리스너 (유저별) ───
export function onDataChange(uid, callback) {
    return onSnapshot(userDoc(uid, 'words'), (snap) => {
        if (snap.exists()) callback(snap.data().content);
    });
}

export function onLogsChange(uid, callback) {
    return onSnapshot(userDoc(uid, 'logs'), (snap) => {
        if (snap.exists()) callback(snap.data().entries || []);
    });
}

// ─── 문장 데이터 (유저별) ───
// 반환: 데이터 | null(없음) | undefined(로드 실패)
export async function loadSentenceDataFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'sentences'));
        return snap.exists() ? snap.data().content : null;
    } catch (e) {
        console.warn('Firestore loadSentenceData 실패:', e);
        return undefined;
    }
}

export async function saveSentenceDataToFirestore(uid, data) {
    try {
        await setDoc(userDoc(uid, 'sentences'), { content: data, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveSentenceData 실패:', e);
    }
}

export function onSentenceDataChange(uid, callback) {
    return onSnapshot(userDoc(uid, 'sentences'), (snap) => {
        if (snap.exists()) callback(snap.data().content);
    });
}

// ─── 문장 암기 데이터 (유저별) ───
// 반환: 데이터 | null(없음) | undefined(로드 실패)
export async function loadMemorizeDataFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'memorize'));
        return snap.exists() ? snap.data().content : null;
    } catch (e) {
        console.warn('Firestore loadMemorizeData 실패:', e);
        return undefined;
    }
}

export async function saveMemorizeDataToFirestore(uid, data) {
    try {
        await setDoc(userDoc(uid, 'memorize'), { content: data, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveMemorizeData 실패:', e);
    }
}

export function onMemorizeDataChange(uid, callback) {
    return onSnapshot(userDoc(uid, 'memorize'), (snap) => {
        if (snap.exists()) callback(snap.data().content);
    });
}

// ─── 알파벳 짝맞추기 게임 상태 (유저별) ───
export async function saveAlphabetProgressToFirestore(uid, date, completedLetters) {
    try {
        await setDoc(userDoc(uid, 'alphabet_progress'), {
            [date]: completedLetters,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.warn('Firestore saveAlphabetProgress 실패:', e);
    }
}

// ─── Azure 사용량 추적 (공유 — 모든 유저 합산) ───
function getUsageDocRef() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { ref: doc(db, 'shared', `usage-${month}`), month };
}

export async function loadUsageFromFirestore() {
    try {
        const { ref, month } = getUsageDocRef();
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const d = snap.data();
            return { month, speechChars: d.speechChars || 0, visionCalls: d.visionCalls || 0 };
        }
        return { month, speechChars: 0, visionCalls: 0 };
    } catch (e) {
        console.warn('Firestore loadUsage 실패:', e);
        return { month: '', speechChars: 0, visionCalls: 0 };
    }
}

// ─── 앱 공용 설정 (Pixabay 키 등) — shared/config 문서 ───
export async function loadAppConfig() {
    try {
        const snap = await getDoc(doc(db, 'shared', 'config'));
        return snap.exists() ? snap.data() : {};
    } catch (e) {
        console.warn('Firestore loadAppConfig 실패:', e);
        return {};
    }
}

export async function saveAppConfig(patch) {
    await setDoc(doc(db, 'shared', 'config'), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

// ─── AI 번역 호출 수 (하루 한도 표시용) ───
// 여러 기기·계정이 같은 키를 공유하므로 공용 문서에 날짜별로 누적
export async function addAiTranslateUsage(dayKey) {
    try {
        await setDoc(doc(db, 'shared', 'ai-usage'), { [dayKey]: increment(1) }, { merge: true });
    } catch (e) { console.warn('AI 사용량 기록 실패:', e); }
}

export async function loadAiTranslateUsage(dayKey) {
    try {
        const snap = await getDoc(doc(db, 'shared', 'ai-usage'));
        if (snap.exists()) return snap.data()[dayKey] || 0;
    } catch (e) { console.warn('AI 사용량 조회 실패:', e); }
    return 0;
}

export async function addSpeechUsageFirestore(chars, uid) {
    if (!chars || chars <= 0) return;
    const userId = uid || auth.currentUser?.uid;
    const { ref } = getUsageDocRef();
    // 공유 카운터 (실패해도 계정별 카운터는 별도로 시도)
    try {
        await setDoc(ref, {
            speechChars: increment(chars),
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.error('Firestore addSpeechUsage(공유) 실패:', e);
    }
    // 계정별 카운터 (막대에 표시되는 값)
    if (userId) {
        try {
            const now = new Date();
            const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const userUsageRef = doc(db, 'users', userId, 'usage', month);
            await setDoc(userUsageRef, {
                speechChars: increment(chars),
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            console.error('Firestore addSpeechUsage(계정별) 실패:', e);
        }
    } else {
        console.warn('addSpeechUsage: 로그인 uid 없음 → 계정별 카운트 건너뜀');
    }
}

export async function addVisionUsageFirestore() {
    try {
        const { ref } = getUsageDocRef();
        await setDoc(ref, {
            visionCalls: increment(1),
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.warn('Firestore addVisionUsage 실패:', e);
    }
}

export function onUsageChange(callback) {
    const { ref } = getUsageDocRef();
    return onSnapshot(ref, (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            callback({ speechChars: d.speechChars || 0, visionCalls: d.visionCalls || 0 });
        } else {
            callback({ speechChars: 0, visionCalls: 0 });
        }
    });
}

// ─── 계정별 사용량 추적 ───
export function onUserUsageChange(uid, callback) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const userUsageRef = doc(db, 'users', uid, 'usage', month);
    return onSnapshot(userUsageRef, (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            callback({ speechChars: d.speechChars || 0 });
        } else {
            callback({ speechChars: 0 });
        }
    });
}

export async function getUserTtsLimit(uid) {
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists() && snap.data().ttsLimit) {
            return snap.data().ttsLimit;
        }
        return 100000; // 기본값 10만자
    } catch (e) {
        console.warn('getUserTtsLimit 실패:', e);
        return 100000;
    }
}

export async function setUserTtsLimit(uid, limit) {
    try {
        await setDoc(doc(db, 'users', uid), { ttsLimit: limit }, { merge: true });
    } catch (e) {
        console.warn('setUserTtsLimit 실패:', e);
    }
}

// ─── users/{uid} 상위 문서 생성 (Console에서 보이도록) ───
export async function ensureUserDoc(uid, username, name) {
    try {
        const updates = { username, lastLogin: new Date().toISOString() };
        if (name) updates.name = name; // 이름이 있을 때만 업데이트 (기존 값 보존)
        await setDoc(doc(db, 'users', uid), updates, { merge: true });
    } catch (e) {
        console.warn('ensureUserDoc 실패:', e);
    }
}

// ─── 유저 프로필 (이름 저장 + 아이디 찾기) ───
export async function saveUserProfile(uid, username, name) {
    try {
        // users/{uid} 문서 생성 (Console에서 보이도록)
        await setDoc(doc(db, 'users', uid), {
            username, name: name.trim(), createdAt: new Date().toISOString()
        });
        // 유저별 프로필 저장 (하위 컬렉션)
        await setDoc(doc(db, 'users', uid, 'data', 'profile'), {
            username, name: name.trim(), createdAt: new Date().toISOString()
        });
        // 공유 이름→아이디 매핑 (아이디 찾기용)
        await setDoc(doc(db, 'shared', 'profiles'), {
            [name.trim()]: username
        }, { merge: true });
    } catch (e) {
        console.warn('프로필 저장 실패:', e);
    }
}

export async function loadUserProfile(uid) {
    try {
        const snap = await getDoc(doc(db, 'users', uid, 'data', 'profile'));
        if (snap.exists()) return snap.data();

        // data/profile이 없으면 users/{uid} 상위 문서에서 복구
        const parentSnap = await getDoc(doc(db, 'users', uid));
        if (parentSnap.exists() && parentSnap.data().name) {
            const parent = parentSnap.data();
            const restored = { username: parent.username, name: parent.name, createdAt: parent.createdAt || new Date().toISOString() };
            await setDoc(doc(db, 'users', uid, 'data', 'profile'), restored);
            console.log('[프로필] 상위 문서에서 복구 완료:', restored);
            return restored;
        }
    } catch (e) {
        console.warn('프로필 로드 실패:', e);
    }
    return null;
}

export async function isNameTaken(name) {
    try {
        const snap = await getDoc(doc(db, 'shared', 'profiles'));
        if (snap.exists()) {
            const data = snap.data();
            return !!data[name.trim()];
        }
    } catch (e) {
        console.warn('이름 중복 확인 실패:', e);
    }
    return false;
}

export async function findUsernameByName(name) {
    try {
        const snap = await getDoc(doc(db, 'shared', 'profiles'));
        if (snap.exists()) {
            const data = snap.data();
            const username = data[name.trim()];
            return username || null;
        }
        return null;
    } catch (e) {
        console.error('아이디 찾기 실패:', e);
        throw e; // 에러를 상위로 전달
    }
}

// ─── 유저 간 데이터 병합 (fromUid → toUid) ───
export async function mergeUserData(fromUid, toUid) {
    try {
        console.log('[병합] 시작:', fromUid, '→', toUid);
        const docNames = ['words', 'sentences', 'memorize', 'logs', 'alphabet_progress'];
        for (const name of docNames) {
            const fromSnap = await getDoc(userDoc(fromUid, name));
            if (!fromSnap.exists()) { console.log('[병합]', name, '없음 → 건너뜀'); continue; }
            const fromData = fromSnap.data();

            const toSnap = await getDoc(userDoc(toUid, name));
            if (!toSnap.exists()) {
                // 대상에 없으면 그대로 복사
                await setDoc(userDoc(toUid, name), fromData);
                console.log('[병합]', name, '복사 완료');
            } else if (name === 'logs') {
                // logs는 entries 배열 합치기
                const toData = toSnap.data();
                const merged = [...(toData.entries || []), ...(fromData.entries || [])];
                await setDoc(userDoc(toUid, name), { entries: merged, updatedAt: new Date().toISOString() });
                console.log('[병합]', name, '합침 완료');
            } else if (name === 'words' || name === 'sentences' || name === 'memorize') {
                // content 기반: 월별 데이터 병합
                const toData = toSnap.data();
                const mergedContent = { ...(toData.content || {}) };
                const fromContent = fromData.content || {};
                for (const month of Object.keys(fromContent)) {
                    if (!mergedContent[month]) {
                        mergedContent[month] = fromContent[month];
                    } else {
                        // 같은 월이 양쪽에 있으면 day 합치기
                        const existing = mergedContent[month];
                        const incoming = fromContent[month];
                        const existingIds = new Set(existing.map(d => d.id || d.name));
                        for (const day of incoming) {
                            if (!existingIds.has(day.id || day.name)) {
                                existing.push(day);
                            }
                        }
                    }
                }
                await setDoc(userDoc(toUid, name), { content: mergedContent, updatedAt: new Date().toISOString() });
                console.log('[병합]', name, '병합 완료');
            }
        }
        // 원본 데이터 삭제
        for (const name of docNames) {
            try { await deleteDoc(userDoc(fromUid, name)); } catch(e) {}
        }
        try { await deleteDoc(userDoc(fromUid, 'profile')); } catch(e) {}
        console.log('[병합] 완료! 새로고침 하세요.');
        return true;
    } catch (e) {
        console.error('[병합] 실패:', e);
        return false;
    }
}

// ─── 책 읽기 (books 컬렉션 — 공유) ───
export async function saveBookToFirestore(book) {
    try {
        await setDoc(doc(db, 'books', book.id), { ...book, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Book 저장 실패:', e);
        throw e;
    }
}

export async function loadBooksFromFirestore() {
    try {
        const q = query(collection(db, 'books'));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('Books 로드 실패:', e);
        return [];
    }
}

export async function deleteBookFromFirestore(bookId) {
    try {
        await deleteDoc(doc(db, 'books', bookId));
    } catch (e) {
        console.warn('Book 삭제 실패:', e);
    }
}

export function onBooksChange(callback) {
    const q = query(collection(db, 'books'));
    return onSnapshot(q, (snap) => {
        const books = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(books);
    });
}

// ─── 읽기 진행 (유저별) ───
export async function saveReadingProgressToFirestore(uid, progressData) {
    try {
        await setDoc(userDoc(uid, 'reading_progress'), { content: progressData, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Reading progress 저장 실패:', e);
    }
}

export async function loadReadingProgressFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'reading_progress'));
        if (snap.exists()) return snap.data().content;
    } catch (e) {
        console.warn('Reading progress 로드 실패:', e);
    }
    return {};
}

// ─── 파닉스 학습 (유저별) ───
//   { progress: {소리id: {stars,tries,best}}, words: {소리id: [단어…]} }
export async function savePhonicsToFirestore(uid, payload) {
    try {
        await setDoc(userDoc(uid, 'phonics_learning'), { ...payload, updatedAt: new Date().toISOString() });
        return true;
    } catch (e) {
        console.warn('파닉스 학습 저장 실패:', e);
        return false;
    }
}

export async function loadPhonicsFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'phonics_learning'));
        if (snap.exists()) {
            const d = snap.data();
            return { progress: d.progress || {}, words: d.words || {} };
        }
        return { progress: {}, words: {} };   // 아직 저장된 적 없음
    } catch (e) {
        console.warn('파닉스 학습 로드 실패:', e);
        return null;                          // 실패 — 기기 저장을 덮어쓰지 않게 구분
    }
}

// ─── 세트학습 진도 (유저별) ───
//   { "word-2026-09-lesson1": {idx, stage, at}, ... }
export async function saveSetProgressToFirestore(uid, all) {
    try {
        await setDoc(userDoc(uid, 'set_progress'), { items: all, updatedAt: new Date().toISOString() });
        return true;
    } catch (e) {
        console.warn('세트학습 진도 저장 실패:', e);
        return false;
    }
}

export async function loadSetProgressFromFirestore(uid) {
    try {
        const snap = await getDoc(userDoc(uid, 'set_progress'));
        if (snap.exists()) return snap.data().items || {};
        return {};
    } catch (e) {
        console.warn('세트학습 진도 로드 실패:', e);
        return null;   // 실패 — 기기 저장을 덮어쓰지 않게 구분
    }
}

// ─── 기존 데이터 마이그레이션 (첫 번째 유저에게) ───
export async function migrateOldDataToUser(uid) {
    try {
        console.log('[마이그레이션] 시작, uid:', uid);
        const migratedSnap = await getDoc(doc(db, 'shared', 'migration'));
        if (migratedSnap.exists()) { console.log('[마이그레이션] migration 플래그 있음 → 건너뜀'); return false; }

        const oldDataSnap = await getDoc(doc(db, 'woojin-phonics', 'data'));
        console.log('[마이그레이션] woojin-phonics/data 존재:', oldDataSnap.exists());
        if (!oldDataSnap.exists()) return false;

        console.log('[마이그레이션] 데이터 복사 시작...');
        await setDoc(userDoc(uid, 'words'), oldDataSnap.data());
        console.log('[마이그레이션] words 복사 완료');

        const oldLogsSnap = await getDoc(doc(db, 'woojin-phonics', 'logs'));
        if (oldLogsSnap.exists()) {
            await setDoc(userDoc(uid, 'logs'), oldLogsSnap.data());
        }

        const oldSentencesSnap = await getDoc(doc(db, 'woojin-phonics', 'sentences'));
        if (oldSentencesSnap.exists()) {
            await setDoc(userDoc(uid, 'sentences'), oldSentencesSnap.data());
        }

        const oldMemorizeSnap = await getDoc(doc(db, 'woojin-phonics', 'memorize'));
        if (oldMemorizeSnap.exists()) {
            await setDoc(userDoc(uid, 'memorize'), oldMemorizeSnap.data());
        }

        const oldAlphabetSnap = await getDoc(doc(db, 'woojin-phonics', 'alphabet_progress'));
        if (oldAlphabetSnap.exists()) {
            await setDoc(userDoc(uid, 'alphabet_progress'), oldAlphabetSnap.data());
        }

        await setDoc(doc(db, 'shared', 'migration'), {
            migratedTo: uid,
            migratedAt: new Date().toISOString()
        });
        console.log('기존 데이터 마이그레이션 완료!');
        return true;
    } catch (e) {
        console.warn('마이그레이션 실패:', e);
        return false;
    }
}

// ─── 계정 삭제 v2 (reading_progress 포함) ───
export async function deleteAccount(password) {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인 상태가 아닙니다.');

    const uid = user.uid;
    const email = user.email;
    const username = email.replace(EMAIL_DOMAIN, '');

    const credential = EmailAuthProvider.credential(email, padPassword(password));
    await reauthenticateWithCredential(user, credential);

    const docNames = ['words', 'sentences', 'memorize', 'logs', 'alphabet_progress', 'profile', 'reading_progress'];
    for (const name of docNames) {
        try { await deleteDoc(userDoc(uid, name)); } catch(e) {}
    }
    try { await deleteDoc(doc(db, 'users', uid)); } catch(e) {}

    try {
        const profilesSnap = await getDoc(doc(db, 'shared', 'profiles'));
        if (profilesSnap.exists()) {
            const profiles = profilesSnap.data();
            const updated = { ...profiles };
            for (const [name, uname] of Object.entries(updated)) {
                if (uname === username) { delete updated[name]; break; }
            }
            await setDoc(doc(db, 'shared', 'profiles'), updated);
        }
    } catch(e) { console.warn('프로필 매핑 삭제 실패:', e); }

    await deleteUser(user);
    console.log('[계정삭제] 완료:', username);
}
