import React from 'react';

const WINDOW = 36; // only the trailing chars animate

export default function StreamingText({ text }) {
  if (!text) return null;
  const split = Math.max(0, text.length - WINDOW);
  const head = text.slice(0, split);
  const tail = text.slice(split);
  return (
    <span className="stream-text">
      {head}
      {tail.split('').map((ch, i) => (
        <span key={split + i} className="reveal-char"
          style={{ animationDelay: `${Math.min(i, WINDOW) * 4}ms` }}>{ch}</span>
      ))}
    </span>
  );
}
