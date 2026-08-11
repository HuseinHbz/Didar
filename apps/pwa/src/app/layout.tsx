import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'دیدار',
    template: '%s — دیدار',
  },
  description: 'پلتفرم تجارت عینک ایرانی — عینک طبی، آفتابی و لنز.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'دیدار',
  },
};

export const viewport: Viewport = {
  themeColor: '#171717',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
