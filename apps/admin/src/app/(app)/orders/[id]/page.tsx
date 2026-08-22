'use client';

import {
  Button,
  ConfirmDialog,
  ErrorState,
  Input,
  Label,
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

import {
  FulfillmentStatusBadge,
  OrderPaymentStatusBadge,
  OrderStatusBadge,
} from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import {
  approveOrder,
  cancelOrder,
  completeOrder,
  deliverShipment,
  getOrder,
  listFulfillments,
  refundOrder,
} from '@/lib/api/orders';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRial } from '@/lib/format/money';

type SimpleAction = 'approve' | 'complete' | 'cancel';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [confirmAction, setConfirmAction] = useState<SimpleAction | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const orderQuery = useQuery({
    queryKey: ['admin', 'orders', orderId],
    queryFn: () => getOrder(orderId),
  });
  const fulfillmentsQuery = useQuery({
    queryKey: ['admin', 'orders', orderId, 'fulfillments'],
    queryFn: () => listFulfillments(orderId),
  });

  const simpleActionMutation = useMutation({
    mutationFn: (action: SimpleAction) => {
      if (action === 'approve') return approveOrder(orderId);
      if (action === 'complete') return completeOrder(orderId);
      return cancelOrder(orderId, cancelReason || undefined);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'orders', orderId], updated);
    },
  });

  const refundMutation = useMutation({
    mutationFn: () => refundOrder(orderId, Number(refundAmount), refundReason || undefined),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'orders', orderId], updated);
      setRefundOpen(false);
      setRefundAmount('');
      setRefundReason('');
    },
  });

  const deliverMutation = useMutation({
    mutationFn: (shipmentId: string) => deliverShipment(orderId, shipmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'orders', orderId, 'fulfillments'],
      });
    },
  });

  if (orderQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (orderQuery.isError) {
    return (
      <ErrorState
        message={orderQuery.error instanceof ApiError ? orderQuery.error.message : 'خطای ناشناخته'}
        onRetry={() => void orderQuery.refetch()}
      />
    );
  }
  const order = orderQuery.data;

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-xl font-bold">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <OrderPaymentStatusBadge status={order.paymentStatus} />
      </div>
      <p className="text-muted-foreground mb-6 text-sm">مبلغ کل: {formatRial(order.grandTotal)}</p>

      <section className="mb-6 flex flex-wrap gap-2">
        {hasPermission('order.approve') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmAction('approve');
            }}
          >
            تأیید سفارش
          </Button>
        ) : null}
        {hasPermission('order.complete') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmAction('complete');
            }}
          >
            تکمیل سفارش
          </Button>
        ) : null}
        {hasPermission('order.cancel') ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirmAction('cancel');
            }}
          >
            لغو سفارش
          </Button>
        ) : null}
        {hasPermission('order.refund') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefundOpen(true);
            }}
          >
            استرداد جزئی
          </Button>
        ) : null}
      </section>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-3 font-semibold">اقلام سفارش</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>کالا</TableHead>
              <TableHead>تعداد</TableHead>
              <TableHead>مبلغ کل ردیف</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.nameSnapshot}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{formatRial(item.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="rounded-md border p-4">
        <h2 className="mb-3 font-semibold">ارسال‌ها</h2>
        {fulfillmentsQuery.data && fulfillmentsQuery.data.length > 0 ? (
          <div className="space-y-3">
            {fulfillmentsQuery.data.map((fulfillment) => {
              const shipment = fulfillment.shipment;
              return (
                <div
                  key={fulfillment.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <FulfillmentStatusBadge status={fulfillment.status} />
                    {shipment?.trackingNumber ? (
                      <span className="text-muted-foreground">{shipment.trackingNumber}</span>
                    ) : null}
                  </div>
                  {shipment &&
                  shipment.status !== 'DELIVERED' &&
                  hasPermission('order.shipment.deliver') ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        deliverMutation.mutate(shipment.id);
                      }}
                      disabled={deliverMutation.isPending}
                    >
                      ثبت تحویل
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">هنوز ارسالی ثبت نشده است.</p>
        )}
      </section>

      {confirmAction ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={
            confirmAction === 'approve'
              ? 'تأیید سفارش'
              : confirmAction === 'complete'
                ? 'تکمیل سفارش'
                : 'لغو سفارش'
          }
          destructive={confirmAction === 'cancel'}
          onConfirm={async () => {
            await simpleActionMutation.mutateAsync(confirmAction);
          }}
        >
          {confirmAction === 'cancel' ? (
            <div>
              <Label htmlFor="cancelReason">دلیل لغو (اختیاری)</Label>
              <Input
                id="cancelReason"
                value={cancelReason}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                }}
              />
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        title="استرداد جزئی وجه"
        description="مبلغ به ریال وارد شود."
        confirmLabel="ثبت استرداد"
        onConfirm={async () => {
          await refundMutation.mutateAsync();
        }}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="refundAmount">مبلغ (ریال)</Label>
            <Input
              id="refundAmount"
              type="number"
              min={1}
              value={refundAmount}
              onChange={(event) => {
                setRefundAmount(event.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="refundReason">دلیل (اختیاری)</Label>
            <Input
              id="refundReason"
              value={refundReason}
              onChange={(event) => {
                setRefundReason(event.target.value);
              }}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
