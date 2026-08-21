'use client';

import {
  EmptyState,
  ErrorState,
  Pagination,
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

import { TransferStatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import { listTransfers } from '@/lib/api/inventory';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

export default function TransfersListPage() {
  const pagination = useCursorPagination();
  const query = useQuery({
    queryKey: ['admin', 'inventory', 'transfers', pagination.cursor],
    queryFn: () => listTransfers({ cursor: pagination.cursor, limit: 20 }),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">انتقال موجودی</h1>
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'خطای ناشناخته'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="انتقالی ثبت نشده است" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره مرجع</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>تاریخ ایجاد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((transfer) => (
                <TableRow key={transfer.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/transfers/${transfer.id}`}
                      className="font-medium hover:underline"
                    >
                      {transfer.referenceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TransferStatusBadge status={transfer.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(transfer.createdAt).toLocaleDateString('fa-IR')}
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
