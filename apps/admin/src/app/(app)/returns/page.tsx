'use client';

import { RETURN_STATUSES, type ReturnStatus } from '@iecp/types';
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

import { ReturnStatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api/errors';
import { listReturns } from '@/lib/api/returns';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

export default function ReturnsListPage() {
  const [status, setStatus] = useState<ReturnStatus | ''>('');
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['admin', 'returns', status, pagination.cursor],
    queryFn: () =>
      listReturns({ status: status || undefined, cursor: pagination.cursor, limit: 20 }),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">بازگشت‌ها</h1>
      <div className="mb-4 max-w-48">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ReturnStatus | '');
            pagination.reset();
          }}
        >
          <option value="">همه وضعیت‌ها</option>
          {RETURN_STATUSES.map((value) => (
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
        <EmptyState title="بازگشتی یافت نشد" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره بازگشت</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>دلیل</TableHead>
                <TableHead>تاریخ درخواست</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/returns/${item.id}`} className="font-medium hover:underline">
                      {item.returnNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ReturnStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>{item.reason}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(item.requestedAt).toLocaleDateString('fa-IR')}
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
