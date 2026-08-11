import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) reports database status', async () => {
    // Requires a reachable DATABASE_URL — see README.md "Running tests".
    // A down database still yields a well-formed 503, not a crash, which is the
    // behavior this test is actually pinning.
    // `INestApplication.getHttpServer()` is typed `any` in Nest itself; cast to
    // what it actually is at runtime (a Node HTTP server) instead of letting the
    // `any` flow into supertest's `request()` unchecked.
    const response = await request(app.getHttpServer() as Server).get('/health');

    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');
  });
});
