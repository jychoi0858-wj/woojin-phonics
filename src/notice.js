// ============================================================
// 앱 공용 안내 배너 — 어느 화면에서든 호출하면 상단에 메시지 표시
//   showNotice('음성 서버에 연결하지 못했어요.')
// 같은 메시지가 연달아 뜨지 않도록 짧게 묶고, 일정 시간 뒤 자동으로 사라짐
// ============================================================
let listeners = [];
let lastMsg = '';
let lastAt = 0;
let hideTimer = null;

export function subscribeNotice(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(f => f !== fn); };
}

export function showNotice(msg, ms = 6000) {
  const now = Date.now();
  if (!msg) return;
  if (msg === lastMsg && now - lastAt < 4000) return; // 연속 중복 억제
  lastMsg = msg; lastAt = now;
  listeners.forEach(f => { try { f(msg); } catch (e) { /* */ } });
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    listeners.forEach(f => { try { f(''); } catch (e) { /* */ } });
    lastMsg = '';
  }, ms);
}

export function clearNotice() {
  if (hideTimer) clearTimeout(hideTimer);
  lastMsg = '';
  listeners.forEach(f => { try { f(''); } catch (e) { /* */ } });
}

// 자주 쓰는 문구
export const VOICE_MSG = {
  limit: '이번 달 음성 사용량을 다 썼어요. 설정에서 사용량을 확인해 주세요.',
  network: '음성 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  fail: '음성을 만들지 못했어요. 잠시 후 다시 눌러 주세요.',
};
