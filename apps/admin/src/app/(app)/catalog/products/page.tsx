'use client';

import { PRODUCT_LIFECYCLE_STATUSES, type ProductLifecycleStatus } from '@iecp/types';
import {
  EmptyState,
  ErrorState,
  Input,
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

import { ProductStatusBadge } from '@/components/status-badge';
import { listProducts } from '@/lib/api/catalog';
import { ApiError } from '@/lib/api/errors';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

const STATUS_LABELS: Record<ProductLifecycleStatus, string> = {
  DRAFT: 'پیش‌نویس',
  IN_REVIEW: 'در حال بررسی',
  APPROVED: 'تأییدشده',
  PUBLISHED: 'منتشرشده',
  UNPUBLISHED: 'برداشته‌شده از انتشار',
  ARCHIVED: 'بایگانی‌شده',
};

export default function ProductsListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductLifecycleStatus | ''>('');
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['admin', 'catalog', 'products', { search, status, cursor: pagination.cursor }],
    queryFn: () =>
      listProducts({
        search: search || undefined,
        status: status || undefined,
        cursor: pagination.cursor,
        limit: 20,
      }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">محصولات</h1>
      </div>
      <div className="mb-4 flex gap-3">
        <Input
          placeholder="جستجو بر اساس نام..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            pagination.reset();
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ProductLifecycleStatus | '');
            pagination.reset();
          }}
          className="max-w-48"
        >
          <option value="">همه وضعیت‌ها</option>
          {PRODUCT_LIFECYCLE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'خطای ناشناخته'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="محصولی یافت نشد" description="فیلتر جستجو را تغییر دهید." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>تاریخ ایجاد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link
                      href={`/catalog/products/${product.id}`}
                      className="font-medium hover:underline"
                    >
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(product.createdAt).toLocaleDateString('fa-IR')}
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
