import React from 'react';

export default function LogoIcon({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 배경 */}
      <rect width="160" height="160" rx="32" fill="#FFF8E1"/>
      {/* 칠판 */}
      <rect x="30" y="15" width="100" height="60" rx="14" fill="#FFCC80"/>
      <rect x="36" y="21" width="88" height="48" rx="9" fill="white" opacity="0.45"/>
      {/* ABC 글자 */}
      <text x="55" y="50" fontFamily="Comic Sans MS,Chalkboard SE,cursive" fontSize="22" fontWeight="700" fill="#E65100">A</text>
      <text x="80" y="54" fontFamily="Comic Sans MS,Chalkboard SE,cursive" fontSize="26" fontWeight="700" fill="#D84315">B</text>
      <text x="107" y="50" fontFamily="Comic Sans MS,Chalkboard SE,cursive" fontSize="22" fontWeight="700" fill="#BF360C">C</text>
      {/* 물결선 */}
      <path d="M30 80 Q50 72 60 80 Q70 88 80 80 Q90 72 100 80 Q110 88 130 80" stroke="#FFB74D" strokeWidth="2.5" fill="none"/>
      {/* 곰돌이 */}
      <circle cx="80" cy="118" r="24" fill="#A1887F"/>
      <circle cx="65" cy="104" r="9" fill="#A1887F"/>
      <circle cx="65" cy="104" r="6" fill="#BCAAA4"/>
      <circle cx="95" cy="104" r="9" fill="#A1887F"/>
      <circle cx="95" cy="104" r="6" fill="#BCAAA4"/>
      <circle cx="80" cy="118" r="16" fill="#BCAAA4"/>
      <circle cx="72" cy="113" r="3.5" fill="#3E2723"/>
      <circle cx="88" cy="113" r="3.5" fill="#3E2723"/>
      <circle cx="72" cy="112" r="1.2" fill="white"/>
      <circle cx="88" cy="112" r="1.2" fill="white"/>
      <ellipse cx="80" cy="120" rx="4" ry="3" fill="#3E2723"/>
      <path d="M76 124 Q80 128 84 124" stroke="#3E2723" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      {/* 타이틀 */}
      <text x="80" y="152" textAnchor="middle" fontFamily="Comic Sans MS,Chalkboard SE,cursive" fontSize="11" fontWeight="700" fill="#E65100">Fun Fun English</text>
    </svg>
  );
}
