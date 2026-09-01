import React from 'react';

export default function QuizIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#667eea" />
      <text
        x="30" y="44"
        textAnchor="middle"
        fontFamily="'Segoe UI', sans-serif"
        fontSize="36"
        fontWeight="700"
        fill="white"
      >Q</text>
      <polygon
        points="52,6 54.5,12 61,12 56,16.5 58,23 52,19 46,23 48,16.5 43,12 49.5,12"
        fill="#ffd700"
      />
      <polygon
        points="12,4 13.2,7.5 17,7.5 14,10 15.2,13.5 12,11 8.8,13.5 10,10 7,7.5 10.8,7.5"
        fill="#ffd700"
        opacity="0.75"
      />
    </svg>
  );
}
