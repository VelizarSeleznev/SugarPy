import React from 'react';

export type Suggestion = {
  id: string;
  title: string;
  signature?: string;
};

type Props = {
  items: Suggestion[];
  activeIndex: number;
  onSelect: (item: Suggestion) => void;
  position: { top: number; left: number } | null;
};

export function SuggestDropdown({ items, activeIndex, onSelect, position }: Props) {
  if (!position || items.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        background: '#fff',
        border: '1px solid #e4ddd0',
        borderRadius: 8,
        boxShadow: '0 12px 24px rgba(0,0,0,0.08)',
        padding: 6,
        zIndex: 50,
        minWidth: 200
      }}
    >
      {items.map((item, idx) => (
        <div
          key={item.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            background: idx === activeIndex ? '#f6f1e9' : 'transparent',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div>
          {item.signature ? (
            <div style={{ fontSize: 12, color: '#6c6a64' }}>{item.signature}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
