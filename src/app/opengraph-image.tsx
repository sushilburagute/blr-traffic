import { ImageResponse } from 'next/og';
export const alt = 'BLR Traffic Sim — Your commute. A thousand moving parts.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#111716',
        color: '#f0f1e9',
        padding: '70px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', fontSize: 30, color: '#a7e7b4' }}>blr / traffic sim</div>
      <div
        style={{ display: 'flex', flexDirection: 'column', fontSize: 80, letterSpacing: '-4px' }}
      >
        <span>Your commute.</span>
        <span style={{ color: '#a7e7b4' }}>A thousand moving parts.</span>
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#acb6b1' }}
      >
        <span>Silk Board → Marathahalli · Bengaluru</span>
        <span>sush.dev</span>
      </div>
    </div>,
    size,
  );
}
