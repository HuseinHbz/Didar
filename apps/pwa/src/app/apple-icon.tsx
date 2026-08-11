import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Generated icon — placeholder until the real brand mark exists (see packages/ui/README.md).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#171717',
        color: '#fafafa',
        fontSize: 88,
        fontWeight: 700,
      }}
    >
      D
    </div>,
    { ...size },
  );
}
