import { Button } from '@iecp/ui';

export default function AdminDashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold">پنل مدیریت</h1>
      <p className="text-muted-foreground max-w-xl">
        اسکلت اولیه. ناوبری کامل ادمین (Commerce / Inventory / Stores / CRM / CMS / Marketing /
        Finance / Analytics / System) طبق{' '}
        <code className="bg-muted rounded px-1 py-0.5 text-sm">docs/product/blueprint.md</code> بخش
        ۵۲ ساخته می‌شود — همراه با RBAC دقیق (بخش ۵۳) پیش از اینکه هر صفحه واقعی بشود.
      </p>
      <Button variant="outline">ورود</Button>
    </main>
  );
}
