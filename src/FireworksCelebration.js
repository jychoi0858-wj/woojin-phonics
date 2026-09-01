import React from 'react';

export default function FireworksCelebration({ size = 120 }) {
  const half = size / 2;
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="fireworks-celebration"
    >
      {/* 중심 폭발 원 */}
      <circle className="fw-center" cx="60" cy="60" r="8" fill="#ff6b6b" />

      {/* 방사형 불꽃 라인들 — 8방향 */}
      <line className="fw-ray fw-r1" x1="60" y1="60" x2="60" y2="14" stroke="#ff6b6b" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r2" x1="60" y1="60" x2="92" y2="27" stroke="#ffd700" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r3" x1="60" y1="60" x2="106" y2="60" stroke="#667eea" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r4" x1="60" y1="60" x2="92" y2="93" stroke="#48c78e" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r5" x1="60" y1="60" x2="60" y2="106" stroke="#ff9f43" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r6" x1="60" y1="60" x2="27" y2="93" stroke="#667eea" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r7" x1="60" y1="60" x2="14" y2="60" stroke="#ff6b6b" strokeWidth="3" strokeLinecap="round" />
      <line className="fw-ray fw-r8" x1="60" y1="60" x2="27" y2="27" stroke="#ffd700" strokeWidth="3" strokeLinecap="round" />

      {/* 끝점 파티클 — 각 방향 끝에 원 */}
      <circle className="fw-dot fw-d1" cx="60" cy="10" r="4" fill="#ff6b6b" />
      <circle className="fw-dot fw-d2" cx="95" cy="25" r="3.5" fill="#ffd700" />
      <circle className="fw-dot fw-d3" cx="110" cy="60" r="3" fill="#667eea" />
      <circle className="fw-dot fw-d4" cx="95" cy="95" r="3.5" fill="#48c78e" />
      <circle className="fw-dot fw-d5" cx="60" cy="110" r="4" fill="#ff9f43" />
      <circle className="fw-dot fw-d6" cx="25" cy="95" r="3" fill="#667eea" />
      <circle className="fw-dot fw-d7" cx="10" cy="60" r="3.5" fill="#ff6b6b" />
      <circle className="fw-dot fw-d8" cx="25" cy="25" r="3" fill="#ffd700" />

      {/* 2차 작은 파티클 — 대각선 사이 */}
      <circle className="fw-spark fw-s1" cx="78" cy="18" r="2.5" fill="#48c78e" />
      <circle className="fw-spark fw-s2" cx="102" cy="42" r="2" fill="#ff6b6b" />
      <circle className="fw-spark fw-s3" cx="102" cy="78" r="2.5" fill="#ffd700" />
      <circle className="fw-spark fw-s4" cx="78" cy="102" r="2" fill="#667eea" />
      <circle className="fw-spark fw-s5" cx="42" cy="102" r="2.5" fill="#ff6b6b" />
      <circle className="fw-spark fw-s6" cx="18" cy="78" r="2" fill="#48c78e" />
      <circle className="fw-spark fw-s7" cx="18" cy="42" r="2.5" fill="#ffd700" />
      <circle className="fw-spark fw-s8" cx="42" cy="18" r="2" fill="#ff9f43" />
    </svg>
  );
}
