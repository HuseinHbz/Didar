import type { Metadata } from 'next';

import { Providers } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'پنل مدیریت دیدار',
    template: '%s — پنل مدیریت دیدار',
  },
  description: 'پنل مدیریت پلتفرم تجارت عینک دیدار.',
  robots: { index: false, follow: false },
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
