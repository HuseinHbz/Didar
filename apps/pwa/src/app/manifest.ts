import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'دیدار — Didar',
    short_name: 'دیدار',
    description: 'پلتفرم تجارت عینک ایرانی — عینک طبی، آفتابی و لنز.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#171717',
    lang: 'fa-IR',
    dir: 'rtl',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
