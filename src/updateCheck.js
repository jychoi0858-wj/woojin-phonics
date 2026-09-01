// ============================================================
// PWA(홈 화면 앱) 업데이트 반영 — index.html이 캐시돼 옛 버전이 뜨는 문제 해결
// 최신 index.html을 캐시 무시하고 받아 현재 로드된 번들 해시와 비교,
// 다르면 쿼리스트링을 바꿔(캐시 우회) 새로고침
// ============================================================

import { logEvent } from './logger';

// 캐시 무시하고 최신 버전으로 강제 새로고침
export function forceUpdate(reason = 'manual') {
  logEvent('update-reload', reason); // 진단 로그에 기록 (새로고침 원인 추적)
  const base = window.location.pathname;
  window.location.replace(base + '?v=' + Date.now());
}

// 사용자가 이미 조작(터치/클릭)했는지 — 조작 중엔 자동 새로고침으로 방해하지 않음
let userInteracted = false;
try {
  const mark = () => { userInteracted = true; };
  window.addEventListener('pointerdown', mark, { once: true, capture: true });
  window.addEventListener('keydown', mark, { once: true, capture: true });
} catch (e) { /* ignore */ }

// 시작 페이지(index.html)의 HTTP 캐시를 최신으로 갱신
// → 다음 실행 때 처음부터 새 버전이 떠서 "열자마자 새로고침"이 반복되지 않음
function refreshStartPageCache() {
  try {
    fetch(window.location.pathname, { cache: 'reload' }).catch(() => {});
    const pub = (process.env.PUBLIC_URL || '');
    if (pub) fetch(pub + '/index.html', { cache: 'reload' }).catch(() => {});
  } catch (e) { /* ignore */ }
}

export async function checkForUpdate() {
  try {
    const url = (process.env.PUBLIC_URL || '') + '/index.html?ts=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/main\.[A-Za-z0-9]+\.js/);
    if (!m) return;
    const loaded = Array.from(document.scripts)
      .map(s => s.src)
      .find(s => /\/static\/js\/main\.[A-Za-z0-9]+\.js/.test(s));
    if (!loaded) return;
    if (!loaded.includes(m[0])) {
      // 구버전 실행 중 → 최신으로 교체
      if (sessionStorage.getItem('woojin-updated-once')) return; // 세션당 1회 (무한 새로고침 방지)
      sessionStorage.setItem('woojin-updated-once', '1');
      refreshStartPageCache(); // 다음 실행 대비 캐시 갱신
      if (userInteracted) { logEvent('update-skip', 'in-use'); return; }
      forceUpdate('auto');
    } else {
      // 이미 최신 → 시작 페이지 캐시만 갱신해 두면 다음 실행부터 새로고침 없음
      refreshStartPageCache();
    }
  } catch (e) { /* 네트워크 실패 시 무시 */ }
}
