import type { Metadata } from 'next';

import { Providers } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'دیدار — فروشگاه اینترنتی عینک',
    template: '%s — دیدار',
  },
  description: 'پلتفرم تجارت عینک ایرانی — عینک طبی، آفتابی و لنز.',
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
