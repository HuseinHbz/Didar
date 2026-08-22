'use client';

import { ORDER_STATUSES, type OrderStatus } from '@iecp/types';
import {
  EmptyState,
  ErrorState,
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
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { OrderStatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import { listOrders } from '@/lib/api/orders';
import { formatRial } from '@/lib/format/money';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

export default function OrdersListPage() {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['admin', 'orders', status, pagination.cursor],
    queryFn: () =>
      listOrders({ status: status || undefined, cursor: pagination.cursor, limit: 20 }),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">سفارش‌ها</h1>
      <div className="mb-4 max-w-48">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as OrderStatus | '');
            pagination.reset();
          }}
        >
          <option value="">همه وضعیت‌ها</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'خطای ناشناخته'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="سفارشی یافت نشد" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره سفارش</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>مبلغ کل</TableHead>
                <TableHead>تاریخ ثبت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                      {order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>{formatRial(order.grandTotal)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(order.placedAt).toLocaleDateString('fa-IR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            hasPrevious={pagination.hasPrevious}
            hasNext={query.data.nextCursor !== null}
            onPrevious={pagination.goToPrevious}
            onNext={() => {
              pagination.goToNext(query.data.nextCursor);
            }}
            disabled={query.isFetching}
          />
        </>
      )}
    </div>
  );
}
