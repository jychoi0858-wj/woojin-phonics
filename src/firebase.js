import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

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

// Firestore 문서 참조
const DATA_DOC = doc(db, 'woojin-phonics', 'data');
const LOGS_DOC = doc(db, 'woojin-phonics', 'logs');

// ─── 데이터 읽기/쓰기 ───
export async function loadDataFromFirestore() {
    try {
        const snap = await getDoc(DATA_DOC);
        if (snap.exists()) return snap.data().content;
    } catch (e) {
        console.warn('Firestore loadData 실패:', e);
    }
    return null;
}

export async function saveDataToFirestore(data) {
    try {
        await setDoc(DATA_DOC, { content: data, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveData 실패:', e);
    }
}

// ─── 로그 읽기/쓰기 ───
export async function loadLogsFromFirestore() {
    try {
        const snap = await getDoc(LOGS_DOC);
        if (snap.exists()) return snap.data().entries || [];
    } catch (e) {
        console.warn('Firestore loadLogs 실패:', e);
    }
    return null;
}

export async function saveLogsToFirestore(logs) {
    try {
        await setDoc(LOGS_DOC, { entries: logs, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.warn('Firestore saveLogs 실패:', e);
    }
}

// ─── 실시간 리스너 ───
export function onDataChange(callback) {
    return onSnapshot(DATA_DOC, (snap) => {
        if (snap.exists()) callback(snap.data().content);
    });
}

export function onLogsChange(callback) {
    return onSnapshot(LOGS_DOC, (snap) => {
        if (snap.exists()) callback(snap.data().entries || []);
    });
}
