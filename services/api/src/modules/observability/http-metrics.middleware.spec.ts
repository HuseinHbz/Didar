import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';

import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { metricsRegistry } from './metrics.registry';

function fakeReqRes(overrides: { method: string; route?: string; statusCode: number }) {
  const req = {
    method: overrides.method,
    route: overrides.route ? { path: overrides.route } : undefined,
  } as unknown as Request;
  const res = new EventEmitter() as unknown as Response;
  Object.defineProperty(res, 'statusCode', { value: overrides.statusCode, writable: true });
  return { req, res: res as Response & EventEmitter };
}

describe('HttpMetricsMiddleware', () => {
  it('records a duration observation labeled by method/route/status_code on response finish', async () => {
    const middleware = new HttpMetricsMiddleware();
    const { req, res } = fakeReqRes({
      method: 'GET',
      route: '/catalog/products/:id',
      statusCode: 200,
    });
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');

    const output = await metricsRegistry.metrics();
    expect(output).toContain(
      'iecp_http_request_duration_seconds_count{method="GET",route="/catalog/products/:id",status_code="200"} 1',
    );
  });

  it('falls back to "unmatched" when the request never reached a route handler', async () => {
    const middleware = new HttpMetricsMiddleware();
    const { req, res } = fakeReqRes({ method: 'GET', statusCode: 404 });
    const next = jest.fn();

    middleware.use(req, res, next);
    res.emit('finish');

    const output = await metricsRegistry.metrics();
    expect(output).toContain(
      'iecp_http_request_duration_seconds_count{method="GET",route="unmatched",status_code="404"} 1',
    );
  });
});
