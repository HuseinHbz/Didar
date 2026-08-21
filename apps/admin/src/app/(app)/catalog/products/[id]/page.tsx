'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Input,
  Label,
  Skeleton,
  Textarea,
} from '@iecp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ProductStatusBadge } from '@/components/status-badge';
import {
  getProduct,
  listSkusByProduct,
  listVariantsByProduct,
  runProductLifecycleAction,
  updateProduct,
  type ProductLifecycleAction,
} from '@/lib/api/catalog';
import { ApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-context';

const editSchema = z.object({
  name: z.string().min(1, 'نام الزامی است'),
  shortDescription: z.string().optional(),
});
type EditFormValues = z.infer<typeof editSchema>;

/** Every button here maps 1:1 onto an already-existing, already-RBAC-
 * gated route (`ProductController`, CP-005) — the backend's own 409 on
 * an illegal lifecycle transition is what actually enforces the state
 * machine; this page only decides which buttons are worth *showing*. */
const LIFECYCLE_ACTIONS: {
  action: ProductLifecycleAction;
  label: string;
  permission: string;
  destructive?: boolean;
}[] = [
  { action: 'submit-for-review', label: 'ارسال برای بررسی', permission: 'catalog.products.update' },
  { action: 'approve', label: 'تأیید', permission: 'catalog.products.approve' },
  {
    action: 'reject',
    label: 'رد و بازگشت به پیش‌نویس',
    permission: 'catalog.products.approve',
    destructive: true,
  },
  { action: 'publish', label: 'انتشار', permission: 'catalog.products.publish' },
  {
    action: 'unpublish',
    label: 'برداشتن از انتشار',
    permission: 'catalog.products.publish',
    destructive: true,
  },
  {
    action: 'archive',
    label: 'بایگانی',
    permission: 'catalog.products.archive',
    destructive: true,
  },
];

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [confirmAction, setConfirmAction] = useState<ProductLifecycleAction | null>(null);

  const productQuery = useQuery({
    queryKey: ['admin', 'catalog', 'products', productId],
    queryFn: () => getProduct(productId),
  });
  const variantsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'products', productId, 'variants'],
    queryFn: () => listVariantsByProduct(productId),
  });
  const skusQuery = useQuery({
    queryKey: ['admin', 'catalog', 'products', productId, 'skus'],
    queryFn: () => listSkusByProduct(productId),
  });

  const editForm = useForm<EditFormValues>({ resolver: zodResolver(editSchema) });
  useEffect(() => {
    if (productQuery.data) {
      editForm.reset({
        name: productQuery.data.name,
        shortDescription: productQuery.data.shortDescription ?? '',
      });
    }
  }, [productQuery.data, editForm]);

  const updateMutation = useMutation({
    mutationFn: (values: EditFormValues) =>
      updateProduct(productId, {
        name: values.name,
        shortDescription: values.shortDescription === '' ? null : values.shortDescription,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'catalog', 'products', productId], updated);
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (action: ProductLifecycleAction) => runProductLifecycleAction(productId, action),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'catalog', 'products', productId], updated);
    },
  });

  if (productQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (productQuery.isError) {
    return (
      <ErrorState
        message={
          productQuery.error instanceof ApiError ? productQuery.error.message : 'خطای ناشناخته'
        }
        onRetry={() => void productQuery.refetch()}
      />
    );
  }
  const product = productQuery.data;

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">{product.name}</h1>
        <ProductStatusBadge status={product.status} />
      </div>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-3 font-semibold">اطلاعات پایه</h2>
        <form
          onSubmit={(event) =>
            void editForm.handleSubmit((values) => {
              updateMutation.mutate(values);
            })(event)
          }
          className="space-y-3"
        >
          <div>
            <Label htmlFor="name">نام</Label>
            <Input
              id="name"
              {...editForm.register('name')}
              disabled={!hasPermission('catalog.products.update')}
            />
          </div>
          <div>
            <Label htmlFor="shortDescription">توضیح کوتاه</Label>
            <Textarea
              id="shortDescription"
              {...editForm.register('shortDescription')}
              disabled={!hasPermission('catalog.products.update')}
            />
          </div>
          {hasPermission('catalog.products.update') ? (
            <Button type="submit" disabled={updateMutation.isPending}>
              ذخیره تغییرات
            </Button>
          ) : null}
          {updateMutation.isError ? (
            <p className="text-destructive text-sm" role="alert">
              {updateMutation.error instanceof ApiError
                ? updateMutation.error.message
                : 'خطا در ذخیره'}
            </p>
          ) : null}
        </form>
      </section>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-3 font-semibold">عملیات چرخه انتشار</h2>
        <div className="flex flex-wrap gap-2">
          {LIFECYCLE_ACTIONS.filter((item) => hasPermission(item.permission)).map((item) => (
            <Button
              key={item.action}
              variant={item.destructive ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => {
                setConfirmAction(item.action);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-3 font-semibold">تنوع‌ها (Variants)</h2>
        {variantsQuery.data && variantsQuery.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {variantsQuery.data.map((variant) => (
              <li key={variant.id}>
                {[variant.label, variant.color, variant.size].filter(Boolean).join(' / ') ||
                  variant.id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">تنوعی ثبت نشده است.</p>
        )}
      </section>

      <section className="rounded-md border p-4">
        <h2 className="mb-3 font-semibold">SKU ها</h2>
        {skusQuery.data && skusQuery.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {skusQuery.data.map((sku) => (
              <li key={sku.id} className="flex items-center gap-2">
                <span>{sku.skuCode}</span>
                <Badge tone={sku.status === 'ACTIVE' ? 'success' : 'neutral'}>{sku.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">SKU ای ثبت نشده است.</p>
        )}
      </section>

      {confirmAction ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={LIFECYCLE_ACTIONS.find((item) => item.action === confirmAction)?.label ?? ''}
          description="این عملیات بر روی محصول اعمال خواهد شد."
          destructive={LIFECYCLE_ACTIONS.find((item) => item.action === confirmAction)?.destructive}
          onConfirm={async () => {
            await lifecycleMutation.mutateAsync(confirmAction);
          }}
        />
      ) : null}
    </div>
  );
}
