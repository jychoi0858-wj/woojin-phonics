import { useEffect, useRef } from 'react';

// ============================================================
// 안드로이드/브라우저 뒤로가기를 "한 단계 뒤로"로 처리
//   - 앱이 뜨면 history에 더미 항목을 하나 쌓아 두고 대기
//   - 뒤로가기(popstate) → 가장 나중에 등록된 핸들러부터 실행
//   - true를 반환한 핸들러에서 멈춤(한 번에 한 단계만 닫힘)
//   - 아무도 처리하지 않으면 실제로 앱을 빠져나감
// 여러 컴포넌트가 동시에 써도 안전하도록 전역 스택 하나로 관리
// ============================================================

const handlers = []; // 나중에 등록된 것이 더 안쪽 화면
let installed = false;

const HISTORY_STATE = { woojinBack: true };

function pushGuard() {
  try {
    if (!window.history.state || !window.history.state.woojinBack) {
      window.history.pushState(HISTORY_STATE, '');
    }
  } catch (e) { /* ignore */ }
}

function onPop() {
  let handled = false;
  // 안쪽 화면(마지막 등록)부터 확인
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      if (handlers[i] && handlers[i]()) { handled = true; break; }
    } catch (e) { /* 한 핸들러가 실패해도 계속 */ }
  }
  if (handled) {
    pushGuard(); // 아직 앱 안 — 다음 뒤로가기를 위해 다시 대기
  } else {
    try { window.history.back(); } catch (e) { /* ignore */ } // 실제 종료/이탈
  }
}

function install() {
  if (installed) return;
  installed = true;
  pushGuard();
  window.addEventListener('popstate', onPop);
}

export default function useBackHandler(handler) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    install();
    const fn = () => ref.current && ref.current();
    handlers.push(fn);
    return () => {
      const i = handlers.indexOf(fn);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}
