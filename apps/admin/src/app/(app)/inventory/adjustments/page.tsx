'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Pagination,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@iecp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '@/lib/api/errors';
import {
  createAdjustment,
  listAdjustments,
  listWarehouses,
  type CreateAdjustmentInput,
} from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

const adjustmentSchema = z.object({
  locationId: z.uuid('شناسه معتبر نیست'),
  productSkuId: z.uuid('شناسه معتبر نیست'),
  adjustmentType: z.enum(['POSITIVE', 'NEGATIVE']),
  quantity: z.coerce.number().int().positive('باید عدد مثبت باشد'),
  reason: z.string().min(3, 'دلیل باید حداقل ۳ کاراکتر باشد'),
});
/** `quantity`'s coercion makes the form's raw input type (`z.input`,
 * before parsing — a string from the `<input type="number">`) differ
 * from its submitted output type (`z.output` — a real `number`) —
 * `useForm`'s third generic carries that distinction through to
 * `handleSubmit`, matching react-hook-form + zod's own documented
 * pattern for coerced fields. */
type AdjustmentFormInput = z.input<typeof adjustmentSchema>;
type AdjustmentFormValues = z.output<typeof adjustmentSchema>;

export default function AdjustmentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const pagination = useCursorPagination();

  const warehousesQuery = useQuery({
    queryKey: ['admin', 'inventory', 'warehouses'],
    queryFn: listWarehouses,
  });

  const adjustmentsQuery = useQuery({
    queryKey: ['admin', 'inventory', 'adjustments', warehouseId, pagination.cursor],
    queryFn: () => listAdjustments(warehouseId, { cursor: pagination.cursor, limit: 20 }),
    enabled: warehouseId !== '',
  });

  const form = useForm<AdjustmentFormInput, unknown, AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { adjustmentType: 'POSITIVE' },
  });

  const createMutation = useMutation({
    mutationFn: (values: AdjustmentFormValues) => {
      const input: CreateAdjustmentInput = { ...values, warehouseId };
      return createAdjustment(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'inventory', 'adjustments', warehouseId],
      });
      setCreateOpen(false);
      form.reset({ adjustmentType: 'POSITIVE' });
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">تعدیل موجودی</h1>
        {hasPermission('inventory.adjust') && warehouseId ? (
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            تعدیل جدید
          </Button>
        ) : null}
      </div>

      <div className="mb-4 max-w-xs">
        <Label htmlFor="warehouse">انبار</Label>
        <Select
          id="warehouse"
          value={warehouseId}
          onChange={(event) => {
            setWarehouseId(event.target.value);
            pagination.reset();
          }}
        >
          <option value="">انتخاب انبار...</option>
          {warehousesQuery.data?.items.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </div>

      {warehouseId === '' ? (
        <EmptyState
          title="یک انبار انتخاب کنید"
          description="برای مشاهده سابقه تعدیل‌ها، ابتدا انبار را انتخاب کنید."
        />
      ) : adjustmentsQuery.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : adjustmentsQuery.isError ? (
        <ErrorState
          message={
            adjustmentsQuery.error instanceof ApiError
              ? adjustmentsQuery.error.message
              : 'خطای ناشناخته'
          }
          onRetry={() => void adjustmentsQuery.refetch()}
        />
      ) : adjustmentsQuery.data.items.length === 0 ? (
        <EmptyState title="تعدیلی ثبت نشده است" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نوع</TableHead>
                <TableHead>تعداد</TableHead>
                <TableHead>دلیل</TableHead>
                <TableHead>تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustmentsQuery.data.items.map((adjustment) => (
                <TableRow key={adjustment.id}>
                  <TableCell>
                    <Badge tone={adjustment.adjustmentType === 'POSITIVE' ? 'success' : 'danger'}>
                      {adjustment.adjustmentType === 'POSITIVE' ? 'افزایش' : 'کاهش'}
                    </Badge>
                  </TableCell>
                  <TableCell>{adjustment.quantity}</TableCell>
                  <TableCell>{adjustment.reason}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(adjustment.createdAt).toLocaleDateString('fa-IR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            hasPrevious={pagination.hasPrevious}
            hasNext={adjustmentsQuery.data.nextCursor !== null}
            onPrevious={pagination.goToPrevious}
            onNext={() => {
              pagination.goToNext(adjustmentsQuery.data.nextCursor);
            }}
            disabled={adjustmentsQuery.isFetching}
          />
        </>
      )}

      <ConfirmDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="ثبت تعدیل موجودی جدید"
        confirmLabel="ثبت"
        onConfirm={async () => {
          await form.handleSubmit((values) => createMutation.mutateAsync(values))();
        }}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="locationId">شناسه مکان</Label>
            <Input id="locationId" {...form.register('locationId')} />
            {form.formState.errors.locationId ? (
              <p className="text-destructive mt-1 text-xs">
                {form.formState.errors.locationId.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="productSkuId">شناسه SKU</Label>
            <Input id="productSkuId" {...form.register('productSkuId')} />
            {form.formState.errors.productSkuId ? (
              <p className="text-destructive mt-1 text-xs">
                {form.formState.errors.productSkuId.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="adjustmentType">نوع</Label>
            <Select id="adjustmentType" {...form.register('adjustmentType')}>
              <option value="POSITIVE">افزایش</option>
              <option value="NEGATIVE">کاهش</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="quantity">تعداد</Label>
            <Input id="quantity" type="number" min={1} {...form.register('quantity')} />
            {form.formState.errors.quantity ? (
              <p className="text-destructive mt-1 text-xs">
                {form.formState.errors.quantity.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="reason">دلیل</Label>
            <Input id="reason" {...form.register('reason')} />
            {form.formState.errors.reason ? (
              <p className="text-destructive mt-1 text-xs">
                {form.formState.errors.reason.message}
              </p>
            ) : null}
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
