// ============================================================
// 간단 크래시/오류/메모리 로거
// localStorage에 동기 기록 → 앱이 갑자기 꺼져도(브라우저 종료) 다음 실행 때 확인 가능
// ============================================================
const KEY = 'woojin-logs';
const MAX = 250;

function nowStr() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function memInfo() {
  try {
    const m = performance.memory; // Chrome/Android Chrome 전용(비표준)
    if (m) return `heap ${Math.round(m.usedJSHeapSize / 1048576)}/${Math.round(m.jsHeapSizeLimit / 1048576)}MB`;
  } catch (e) { /* ignore */ }
  return '';
}

export function logEvent(type, msg) {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.push({ t: nowStr(), type, msg: String(msg == null ? '' : msg).slice(0, 500) });
    if (arr.length > MAX) arr.splice(0, arr.length - MAX);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) { /* ignore */ }
}

export function getLogs() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}

export function clearLogs() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function getLogsText() {
  return getLogs().map(l => `[${l.t}] ${l.type}: ${l.msg}`).join('\n');
}

let installed = false;
export function installGlobalLogging() {
  if (installed) return;
  installed = true;

  logEvent('boot', `start | ${navigator.userAgent.slice(0, 130)} | dm ${navigator.deviceMemory || '?'}GB | ${memInfo()}`);

  window.addEventListener('error', (e) => {
    logEvent('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno || ''} | ${memInfo()}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = (r && (r.message || (r.toString && r.toString()))) || r;
    logEvent('reject', `${msg} | ${memInfo()}`);
  });

  document.addEventListener('visibilitychange', () => {
    logEvent('visibility', `${document.visibilityState} | ${memInfo()}`);
  });

  window.addEventListener('pagehide', () => logEvent('pagehide', memInfo()));

  // 메모리 하트비트 (지원 브라우저만) — 꺼지기 직전 추세 확인용
  try {
    setInterval(() => { const m = memInfo(); if (m) logEvent('mem', m); }, 60000);
  } catch (e) { /* ignore */ }
}
