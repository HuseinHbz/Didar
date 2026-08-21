'use client';

import { RETURN_ITEM_CONDITIONS, type ReturnItemCondition } from '@iecp/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Input,
  Label,
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
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ReturnStatusBadge, SettlementStatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import {
  approveReturn,
  approveReturnForRefund,
  getReturn,
  getReturnSettlement,
  inspectReturn,
  receiveReturn,
  reconcileReturn,
  refundReturn,
  rejectReturn,
  retrySettlement,
} from '@/lib/api/returns';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRial } from '@/lib/format/money';

type DialogKind = 'reject' | 'receive' | 'inspect' | null;

export default function ReturnDetailPage() {
  const params = useParams<{ id: string }>();
  const returnId = params.id;
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [conditions, setConditions] = useState<Record<string, ReturnItemCondition>>({});
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const returnQuery = useQuery({
    queryKey: ['admin', 'returns', returnId],
    queryFn: () => getReturn(returnId),
  });
  const settlementQuery = useQuery({
    queryKey: ['admin', 'returns', returnId, 'settlement'],
    queryFn: () => getReturnSettlement(returnId),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveReturn(returnId),
    onSuccess: (updated) => queryClient.setQueryData(['admin', 'returns', returnId], updated),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectReturn(returnId, rejectReason),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'returns', returnId], updated);
      setDialog(null);
    },
  });
  const receiveMutation = useMutation({
    mutationFn: () => receiveReturn(returnId, warehouseId, locationId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'returns', returnId], updated);
      setDialog(null);
    },
  });
  const inspectMutation = useMutation({
    mutationFn: () => {
      if (!returnQuery.data) throw new Error('بازگشت هنوز بارگذاری نشده است');
      const items = returnQuery.data.items.map((item) => ({
        returnItemId: item.id,
        condition: conditions[item.id] ?? 'UNOPENED',
        quantity: item.quantity,
      }));
      return inspectReturn(returnId, items);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'returns', returnId], updated);
      setDialog(null);
    },
  });
  const approveForRefundMutation = useMutation({
    mutationFn: () => approveReturnForRefund(returnId),
    onSuccess: (updated) => queryClient.setQueryData(['admin', 'returns', returnId], updated),
  });
  const refundMutation = useMutation({
    mutationFn: () => refundReturn(returnId),
    onSuccess: (updated) => queryClient.setQueryData(['admin', 'returns', returnId], updated),
  });
  const retryMutation = useMutation({
    mutationFn: () => retrySettlement(returnId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'returns', returnId, 'settlement'],
      }),
  });
  const reconcileMutation = useMutation({
    mutationFn: () => reconcileReturn(returnId),
    onSuccess: (result) => {
      setReconcileResult(
        result.findings.length === 0
          ? 'مغایرتی برای این بازگشت یافت نشد.'
          : result.findings.map((finding) => finding.pattern).join('، '),
      );
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'returns', returnId, 'settlement'],
      });
    },
  });

  if (returnQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (returnQuery.isError) {
    return (
      <ErrorState
        message={
          returnQuery.error instanceof ApiError ? returnQuery.error.message : 'خطای ناشناخته'
        }
        onRetry={() => void returnQuery.refetch()}
      />
    );
  }
  const returnRequest = returnQuery.data;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold">{returnRequest.returnNumber}</h1>
        <ReturnStatusBadge status={returnRequest.status} />
      </div>

      <section className="mb-6 flex flex-wrap gap-2">
        {hasPermission('return.approve') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              approveMutation.mutate();
            }}
          >
            تأیید بازگشت
          </Button>
        ) : null}
        {hasPermission('return.reject') ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setDialog('reject');
            }}
          >
            رد بازگشت
          </Button>
        ) : null}
        {hasPermission('return.receive') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog('receive');
            }}
          >
            ثبت دریافت کالا
          </Button>
        ) : null}
        {hasPermission('return.inspect') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog('inspect');
            }}
          >
            ثبت بازرسی
          </Button>
        ) : null}
        {hasPermission('return.refund') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              approveForRefundMutation.mutate();
            }}
          >
            تأیید برای استرداد
          </Button>
        ) : null}
        {hasPermission('return.refund') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refundMutation.mutate();
            }}
          >
            ثبت استرداد
          </Button>
        ) : null}
      </section>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-3 font-semibold">اقلام</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ردیف سفارش</TableHead>
              <TableHead>تعداد</TableHead>
              <TableHead>وضعیت کالا</TableHead>
              <TableHead>مبلغ استرداد</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returnRequest.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.orderItemId}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>
                  {item.condition ? <Badge tone="neutral">{item.condition}</Badge> : '—'}
                </TableCell>
                <TableCell>{formatRial(item.refundAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {hasPermission('return.settlement.read') ? (
        <section className="rounded-md border p-4">
          <h2 className="mb-3 font-semibold">تسویه</h2>
          {settlementQuery.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : settlementQuery.isError ? (
            <ErrorState
              message={
                settlementQuery.error instanceof ApiError
                  ? settlementQuery.error.message
                  : 'خطای ناشناخته'
              }
              onRetry={() => void settlementQuery.refetch()}
            />
          ) : settlementQuery.data === null ? (
            <p className="text-muted-foreground text-sm">
              هنوز تسویه‌ای برای این بازگشت ایجاد نشده است.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <SettlementStatusBadge status={settlementQuery.data.status} />
                <span className="text-muted-foreground">
                  تلاش‌ها: {settlementQuery.data.attempts}
                </span>
              </div>
              {settlementQuery.data.lastError ? (
                <p className="text-destructive">{settlementQuery.data.lastError}</p>
              ) : null}
              <div className="flex gap-2">
                {hasPermission('return.settlement.retry') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      retryMutation.mutate();
                    }}
                    disabled={retryMutation.isPending}
                  >
                    تلاش مجدد
                  </Button>
                ) : null}
                {hasPermission('return.settlement.reconcile') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      reconcileMutation.mutate();
                    }}
                    disabled={reconcileMutation.isPending}
                  >
                    بررسی مغایرت
                  </Button>
                ) : null}
              </div>
              {reconcileResult ? <p className="text-muted-foreground">{reconcileResult}</p> : null}
            </div>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="رد درخواست بازگشت"
        destructive
        onConfirm={async () => {
          await rejectMutation.mutateAsync();
        }}
      >
        <Label htmlFor="rejectReason">دلیل رد</Label>
        <Input
          id="rejectReason"
          value={rejectReason}
          onChange={(event) => {
            setRejectReason(event.target.value);
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'receive'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="ثبت دریافت کالای بازگشتی"
        onConfirm={async () => {
          await receiveMutation.mutateAsync();
        }}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="warehouseId">شناسه انبار</Label>
            <Input
              id="warehouseId"
              value={warehouseId}
              onChange={(event) => {
                setWarehouseId(event.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="locationId">شناسه مکان</Label>
            <Input
              id="locationId"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
              }}
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'inspect'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="ثبت نتیجه بازرسی"
        onConfirm={async () => {
          await inspectMutation.mutateAsync();
        }}
      >
        <div className="space-y-3">
          {returnRequest.items.map((item) => (
            <div key={item.id}>
              <Label htmlFor={`condition-${item.id}`}>وضعیت کالا — {item.id.slice(0, 8)}</Label>
              <Select
                id={`condition-${item.id}`}
                value={conditions[item.id] ?? 'UNOPENED'}
                onChange={(event) => {
                  setConditions((prev) => ({
                    ...prev,
                    [item.id]: event.target.value as ReturnItemCondition,
                  }));
                }}
              >
                {RETURN_ITEM_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </ConfirmDialog>
    </div>
  );
}
