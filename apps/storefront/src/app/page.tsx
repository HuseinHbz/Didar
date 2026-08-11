import { Button } from '@iecp/ui';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold">دیدار</h1>
      <p className="text-muted-foreground max-w-xl">
        این صفحه فقط یک اسکلت اولیه است. فروشگاه واقعی — کاتالوگ، سبد خرید، پرداخت و بقیه‌ی
        قابلیت‌ها — طبق فازهای مستندشده در{' '}
        <code className="bg-muted rounded px-1 py-0.5 text-sm">docs/product/blueprint.md</code>{' '}
        ساخته می‌شود.
      </p>
      <Button>شروع کنید</Button>
    </main>
  );
}
