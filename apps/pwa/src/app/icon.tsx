import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Generated icon — placeholder until the real brand mark exists (see packages/ui/README.md).
export default function Icon() {
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
        fontSize: 16,
        fontWeight: 700,
        borderRadius: 6,
      }}
    >
      D
    </div>,
    { ...size },
  );
}
