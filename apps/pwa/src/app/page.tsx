import { Button } from '@iecp/ui';

export default function PwaHomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-bold">دیدار</h1>
      <p className="text-muted-foreground text-sm">
        نسخه‌ی نصب‌شدنی (PWA) — Add to Home Screen، کش آفلاین برای محتوای عمومی، و
        همان Backend مشترک با storefront. جزئیات در README همین اپ.
      </p>
      <Button size="lg">شروع کنید</Button>
    </main>
  );
}
