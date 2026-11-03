import { ImageResponse } from 'next/og';

/** Vorschaubild, wenn ein Link auf Markterl geteilt wird (WhatsApp, Facebook …) und die Seite kein eigenes Foto hat */
export const alt = 'Markterl – Kleinanzeigen für Österreich';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: 'linear-gradient(135deg, #0f4c3a 0%, #0b2a20 100%)',
        color: '#f6f4ef',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <svg width="112" height="112" viewBox="0 0 32 32">
          <path
            d="M4 9.5A5.5 5.5 0 0 1 9.5 4h9.38a5.5 5.5 0 0 1 3.89 1.61l5.62 5.62a5.5 5.5 0 0 1 0 7.78l-9.38 9.38a5.5 5.5 0 0 1-7.78 0l-5.62-5.62A5.5 5.5 0 0 1 4 18.88Z"
            fill="#f6f4ef"
          />
          <circle cx="11" cy="11" r="2.4" fill="#0f4c3a" />
          <path d="m10.5 22.5 5-7.5 2.6 3.6 1.9-2.4 3.5 5.3Z" fill="#f28c38" />
        </svg>
        <div style={{ display: 'flex', fontSize: 104 }}>
          <span>Markt</span>
          <span style={{ color: '#f28c38', marginLeft: -14 }}>erl</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', fontSize: 68, lineHeight: 1.1 }}>
          Gutes findet man <span style={{ color: '#f28c38', marginLeft: 18 }}>um die Ecke.</span>
        </div>
        <div style={{ display: 'flex', fontSize: 34, color: 'rgba(246,244,239,0.8)' }}>
          Kostenlos inserieren und finden – in ganz Österreich
        </div>
      </div>
    </div>,
    size,
  );
}
