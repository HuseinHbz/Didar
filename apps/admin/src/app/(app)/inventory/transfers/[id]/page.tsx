'use client';

import {
  Button,
  ConfirmDialog,
  ErrorState,
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

import { TransferStatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import {
  approveTransfer,
  dispatchTransfer,
  getTransfer,
  receiveTransfer,
} from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';

type TransferAction = 'approve' | 'dispatch' | 'receive';

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const transferId = params.id;
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [confirmAction, setConfirmAction] = useState<TransferAction | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'inventory', 'transfers', transferId],
    queryFn: () => getTransfer(transferId),
  });

  const mutation = useMutation({
    mutationFn: async (action: TransferAction) => {
      if (!query.data) throw new Error('انتقال هنوز بارگذاری نشده است');
      if (action === 'approve') return approveTransfer(transferId);
      if (action === 'dispatch') return dispatchTransfer(transferId);
      // Receive: default to the full dispatched quantity of every item —
      // ReceiveTransferDto requires at least one real row, never an
      // invented empty payload (see lib/api/inventory.ts's own doc
      // comment on receiveTransfer).
      const items = query.data.items.map((item) => ({
        productSkuId: item.productSkuId,
        receivedQuantity:
          item.dispatchedQuantity ?? item.approvedQuantity ?? item.requestedQuantity,
      }));
      return receiveTransfer(transferId, items);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'inventory', 'transfers', transferId], updated);
    },
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : 'خطای ناشناخته'}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const transfer = query.data;

  const actions: { action: TransferAction; label: string; permission: string }[] = [
    { action: 'approve', label: 'تأیید', permission: 'inventory.transfer.approve' },
    { action: 'dispatch', label: 'ارسال', permission: 'inventory.transfer.dispatch' },
    { action: 'receive', label: 'دریافت کامل', permission: 'inventory.transfer.receive' },
  ];

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">{transfer.referenceNumber}</h1>
        <TransferStatusBadge status={transfer.status} />
      </div>

      <section className="mb-6 flex flex-wrap gap-2">
        {actions
          .filter((item) => hasPermission(item.permission))
          .map((item) => (
            <Button
              key={item.action}
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmAction(item.action);
              }}
            >
              {item.label}
            </Button>
          ))}
      </section>

      <section className="rounded-md border p-4">
        <h2 className="mb-3 font-semibold">اقلام</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>درخواستی</TableHead>
              <TableHead>تأییدشده</TableHead>
              <TableHead>ارسال‌شده</TableHead>
              <TableHead>دریافت‌شده</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfer.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.productSkuId}</TableCell>
                <TableCell>{item.requestedQuantity}</TableCell>
                <TableCell>{item.approvedQuantity ?? '—'}</TableCell>
                <TableCell>{item.dispatchedQuantity ?? '—'}</TableCell>
                <TableCell>{item.receivedQuantity ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {confirmAction ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={actions.find((item) => item.action === confirmAction)?.label ?? ''}
          description="این عملیات بر روی انتقال موجودی اعمال خواهد شد."
          onConfirm={async () => {
            await mutation.mutateAsync(confirmAction);
          }}
        />
      ) : null}
    </div>
  );
}
