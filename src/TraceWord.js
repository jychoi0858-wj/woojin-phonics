import React, { useRef, useEffect, useState, useCallback } from 'react';
import './WordActivities.css';
import { stopCachedAudio } from './ttsCache';

// 따라쓰기 (트레이싱) — 8세용
// 흐린 정답 글자 위를 따라 그리면 "따라간 정도(%)"로 판정 (글씨체 인식 X → 아동 글씨에 관대)
// 긴 단어는 한 줄 크기를 유지하기 위해 넓은 팝업(전체화면)으로 자동 확대
// props: word(필수), speak(선택), onComplete(선택)
export default function TraceWord({ word, speak, onComplete }) {
  const target = (word || '').toLowerCase().trim();
  const [expanded, setExpanded] = useState(false);

  // 캔버스 해상도: 인라인 640, 팝업 1120 — 비율(640:260) 고정 → 확대해도 획 모양 유지
  const W = expanded ? 1120 : 640;
  const H = Math.round(W * 260 / 640); // 위아래 높이를 줄여 아래 버튼이 잘 보이게
  const scale = W / 640; // 선 굵기도 캔버스에 비례 → 일치률 일관

  const canvasRef = useRef(null);
  const inkRef = useRef(null);   // 오프스크린: 사용자 획만 (판정용)
  const maskRef = useRef(null);  // 정답 글자 픽셀 마스크
  const measureRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);
  const strokesRef = useRef([]); // 획 벡터 저장 (0~1 정규화) → 확대/축소해도 유지
  const undoStackRef = useRef([]); // 되돌리기 이력 (획 추가·지우기 전 상태 스냅샷)
  const [score, setScore] = useState(null);

  // 변경 직전 상태를 이력에 저장
  const pushHistory = () => {
    const snap = strokesRef.current.map(s => ({ pts: s.pts.map(p => ({ ...p })) }));
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 40) undoStackRef.current.shift();
  };

  const getMeasureCtx = () => {
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d');
    return measureRef.current;
  };

  // 캔버스에 비례하는 폰트 크기 (고정 상한 없음 → 인라인/팝업이 균일 확대되어 배경 글자가 동일)
  const computeFontSize = useCallback(() => {
    const ctx = getMeasureCtx();
    const maxW = W * 0.9;
    let size = Math.floor(H * 0.82);
    for (; size > 20; size -= 2) {
      ctx.font = `900 ${size}px Nunito, sans-serif`;
      if ((ctx.measureText(target).width || 0) <= maxW) break;
    }
    return size;
  }, [W, H, target]);

  const drawTextTo = useCallback((ctx, fillStyle) => {
    const size = computeFontSize();
    ctx.font = `900 ${size}px Nunito, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fillStyle;
    ctx.fillText(target, W / 2, H / 2);
  }, [computeFontSize, target, W, H]);

  const drawGuide = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    drawTextTo(ctx, 'rgba(60,70,90,0.16)');
  }, [drawTextTo, W, H]);

  const buildMask = useCallback(() => {
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const ctx = m.getContext('2d');
    drawTextTo(ctx, '#000');
    maskRef.current = ctx.getImageData(0, 0, W, H).data;
  }, [drawTextTo, W, H]);

  // 단어 바뀌면 팝업 닫고 획 초기화
  useEffect(() => { setExpanded(false); strokesRef.current = []; undoStackRef.current = []; setScore(null); speakingRef.current = false; }, [target]);

  // 저장된 획을 현재 캔버스 크기에 맞춰 다시 그리기 (확대/축소 전환 시 유지)
  const replayStrokes = useCallback((visCtx, inkCtx) => {
    strokesRef.current.forEach(st => {
      const pts = st.pts || [];
      if (pts.length === 1) {
        const p = pts[0];
        if (visCtx) { visCtx.fillStyle = '#3a7bd5'; visCtx.beginPath(); visCtx.arc(p.x * W, p.y * H, 9 * scale, 0, Math.PI * 2); visCtx.fill(); }
        if (inkCtx) { inkCtx.fillStyle = '#000'; inkCtx.beginPath(); inkCtx.arc(p.x * W, p.y * H, 16 * scale, 0, Math.PI * 2); inkCtx.fill(); }
        return;
      }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const seg = (ctx, color, lw) => {
          ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke();
        };
        if (visCtx) seg(visCtx, '#3a7bd5', 18 * scale);
        if (inkCtx) seg(inkCtx, '#000', 32 * scale);
      }
    });
  }, [W, H]);

  // 정답 시 발음 3번 재생 후 완료 콜백
  const speakingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);     // 재생 중 (자동 포함)
  const [manualPlay, setManualPlay] = useState(false); // 사용자가 누른 재생 → 멈춤 버튼 표시

  // 다 썼을 때 자동 재생 3회 (자동이므로 멈춤 버튼 없음)
  const speakThriceThen = async (cb) => {
    if (speakingRef.current) return; // 이미 재생 중이면 새로 시작 안 함 (겹침 방지)
    speakingRef.current = true; setSpeaking(true);
    if (speak) {
      for (let i = 0; i < 3; i++) {
        try { await speak(target); } catch (e) { /* ignore */ }
        if (i < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
    speakingRef.current = false; setSpeaking(false);
    if (cb) cb();
  };

  // 듣기 버튼 (수동) — 재생 중에는 멈춤 버튼으로 바뀜
  const listenOnce = async () => {
    if (speakingRef.current || !speak) return;
    speakingRef.current = true; setSpeaking(true); setManualPlay(true);
    try { await speak(target); } catch (e) { /* ignore */ }
    speakingRef.current = false; setSpeaking(false); setManualPlay(false);
  };
  const stopListen = () => {
    try { stopCachedAudio(); } catch (e) { /* */ }
    try { window.speechSynthesis.cancel(); } catch (e) { /* */ }
    speakingRef.current = false; setSpeaking(false); setManualPlay(false);
  };

  // 캔버스 초기화 (단어/확대 상태 바뀔 때) — 기존 획은 유지해서 다시 그림
  useEffect(() => {
    const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
    inkRef.current = ink;
    const redraw = () => {
      drawGuide();
      buildMask();
      replayStrokes(canvasRef.current && canvasRef.current.getContext('2d'), inkRef.current.getContext('2d'));
    };
    redraw();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(redraw);
    }
  }, [target, expanded, W, H, drawGuide, buildMask, replayStrokes]);

  const pos = (e) => {
    const c = canvasRef.current; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };

  const start = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    const p = pos(e);
    lastRef.current = p;
    pushHistory(); // 이 획을 긋기 전 상태 저장
    strokesRef.current.push({ pts: [{ x: p.x / W, y: p.y / H }] }); // 새 획 시작 (정규화 저장)
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e); const last = lastRef.current;
    const stroke = (ctx, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    };
    stroke(canvasRef.current.getContext('2d'), '#3a7bd5', 18 * scale);
    stroke(inkRef.current.getContext('2d'), '#000', 32 * scale);
    const cur = strokesRef.current[strokesRef.current.length - 1];
    if (cur) cur.pts.push({ x: p.x / W, y: p.y / H });
    lastRef.current = p;
  };
  const end = () => { drawingRef.current = false; lastRef.current = null; };

  const redrawAll = () => {
    drawGuide(); // 배경 글자 다시
    const ink = inkRef.current.getContext('2d');
    ink.clearRect(0, 0, W, H);
    replayStrokes(canvasRef.current && canvasRef.current.getContext('2d'), ink);
  };

  const clearAll = () => {
    if (strokesRef.current.length) pushHistory(); // 지우기 전 상태 저장 → 되돌리기로 복구 가능
    strokesRef.current = [];
    drawGuide();
    inkRef.current.getContext('2d').clearRect(0, 0, W, H);
    setScore(null);
  };

  // 되돌리기: 마지막 변경(획 추가·지우기) 취소
  const undo = () => {
    if (undoStackRef.current.length === 0) return;
    strokesRef.current = undoStackRef.current.pop();
    setScore(null);
    redrawAll();
  };

  const grade = () => {
    const mask = maskRef.current; if (!mask) return;
    const ink = inkRef.current.getContext('2d').getImageData(0, 0, W, H).data;
    let total = 0, covered = 0;
    for (let i = 3; i < mask.length; i += 12) {
      if (mask[i] > 40) { total++; if (ink[i] > 10) covered++; }
    }
    const pct = total ? Math.round((covered / total) * 100) : 0;
    setScore(pct);
    if (pct >= 55) {
      speakThriceThen(onComplete); // 발음 3번 후 자동 넘김
    }
  };

  const canvasEl = (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="wa-canvas"
      style={expanded ? { maxWidth: '100%' } : undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
    />
  );

  const scoreEl = score !== null && (
    <div className={`wa-trace-score ${score >= 55 ? 'pass' : 'low'}`}>
      {score >= 55 ? `⭐ 잘 따라 썼어요! (${score}%)` : `조금 더 따라가 볼까요? (${score}%)`}
    </div>
  );

  const actions = (
    <div className="wa-actions">
      <button className="wa-btn wa-hint" onClick={grade}>✅ 다 썼어요</button>
      <button className="wa-btn wa-reset" onClick={undo}>↩ 되돌리기</button>
      <button className="wa-btn wa-reset" onClick={clearAll}>↺ 지우기</button>
      {speak && (
        manualPlay
          ? <button className="wa-btn wa-reset" onClick={stopListen}>⏹️ 멈춤</button>
          : <button className="wa-btn wa-listen" onClick={listenOnce} disabled={speaking}>
              {speaking ? '🔊 재생 중...' : '🔊 듣기'}
            </button>
      )}
    </div>
  );

  if (expanded) {
    return (
      <div className="trace-expand-overlay">
        <div className="trace-expand-modal">
          <button className="trace-expand-close" onClick={() => setExpanded(false)}>✕ 닫기</button>
          <div className="wa-trace-hint">흐린 글자 위를 손가락이나 펜으로 따라 그려보세요 ✏️</div>
          {canvasEl}
          {scoreEl}
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className="wa-card">
      <div className="wa-trace-hinttop">
        <span className="wa-trace-hint">흐린 글자 위를 손가락이나 펜으로 따라 그려보세요 ✏️</span>
        <button className="wa-trace-big" onClick={() => setExpanded(true)}>🔍 크게 보기</button>
      </div>
      {canvasEl}
      {scoreEl}
      {actions}
    </div>
  );
}
