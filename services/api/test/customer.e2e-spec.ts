import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface OtpRequestResponseBody {
  expiresAt: string;
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string; refreshToken: string };
}
interface AddressBody {
  id: string;
  isDefault: boolean;
  province: string;
  city: string;
}
interface PrescriptionBody {
  id: string;
  rootId: string;
  version: number;
  previousVersionId: string | null;
  status: string;
  statusCode?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

const validEyeInput = { sph: -1.5, cyl: -0.5, axis: 90, add: 1, pd: 62 };

/**
 * CP-019 e2e coverage (docs/adr/ADR-019-customer-domain-prescription.md) —
 * real controllers, real DTO validation, real RBAC guards, real
 * ownership checks, real Postgres constraints, end to end. Domain unit
 * tests (`prescription-state-machine.spec.ts`,
 * `eye-measurement-validator.spec.ts`, `prescription.entity.spec.ts`)
 * cover the pure logic this suite doesn't re-derive.
 */
describe('Customer domain & prescription (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let reviewerToken: string;

  const loginByPhone = async (phone: string): Promise<string> => {
    const requestRes = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    const code = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
    if (code === null) throw new Error('devOnlyCode was null');
    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code })
      .expect(200);
    const verified = body<LoginResponseBody>(verifyRes);
    if (!verified.tokens) throw new Error('expected tokens on an AUTHENTICATED response');
    return verified.tokens.accessToken;
  };

  /** A fresh customer per test (not the shared seed fixture) — avoids
   * cross-test interference on address/prescription lists, same reason
   * `return.e2e-spec.ts`'s own `provisionCustomer()` exists. */
  const provisionCustomer = async (suffix: string): Promise<string> => {
    // `iranMobileSchema` (`@iecp/validation`) requires exactly 10 digits
    // after `+98`, starting with 9 — `912019` (6 digits) + a zero-padded
    // 4-digit suffix gets there, and stays clear of both the seed's
    // fixed `+98912000XXXX` block and `return.e2e-spec.ts`'s own
    // `+989120099XXX` block.
    const phone = `+98912019${suffix.padStart(4, '0')}`;
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, isActive: true, phoneVerifiedAt: new Date() },
    });
    // `update` resets to the same canonical values `create` uses — a
    // prior run's PATCH /me/profile test otherwise leaves this customer
    // permanently mutated, so a later run's own "starts as 'E2E'"
    // assertion would only ever pass on a database's first-ever run.
    const customer = await prisma.customer.upsert({
      where: { userId: user.id },
      update: { firstName: 'E2E', lastName: 'Prescription Customer' },
      create: { userId: user.id, firstName: 'E2E', lastName: 'Prescription Customer' },
    });
    // `upsert` reuses the same customer across repeated runs of this
    // suite against a database that isn't reset between runs (unlike a
    // real CI run, which always starts from a fresh one) — clear any
    // addresses/prescriptions a prior run left behind so this really is
    // the "fresh customer per test" the comment above promises, not just
    // on a database's first-ever run.
    await prisma.customerAddress.deleteMany({ where: { customerId: customer.id } });
    await prisma.prescription.deleteMany({ where: { customerId: customer.id } });
    return loginByPhone(phone);
  };

  const createApprovedPrescription = async (customerToken: string): Promise<string> => {
    const created = body<PrescriptionBody>(
      await request(server)
        .post('/me/prescriptions')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rightEye: validEyeInput, leftEye: validEyeInput })
        .expect(201),
    );
    await request(server)
      .post(`/me/prescriptions/${created.id}/submit`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/prescriptions/${created.id}/start-review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/prescriptions/${created.id}/approve`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(201);
    return created.id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;

    reviewerToken = await loginByPhone('+989120000018');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Customer profile', () => {
    it('GET/PATCH /me/profile — returns and updates the caller\'s own profile only', async () => {
      const token = await provisionCustomer('01');
      const before = await request(server).get('/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
      expect(body<{ firstName: string }>(before).firstName).toBe('E2E');

      const updated = await request(server)
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Updated' })
        .expect(200);
      expect(body<{ firstName: string }>(updated).firstName).toBe('Updated');
    });

    it('rejects an unauthenticated request', async () => {
      await request(server).get('/me/profile').expect(401);
    });
  });

  describe('Address management', () => {
    it('1. create customer/address — first address is always default regardless of the flag', async () => {
      const token = await provisionCustomer('02');
      const created = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({
            recipientName: 'Sara Ahmadi',
            phone: '+989120000002',
            province: 'Tehran',
            city: 'Tehran',
            addressLine1: 'Valiasr St, No. 1',
            isDefault: false,
          })
          .expect(201),
      );
      expect(created.isDefault).toBe(true);
    });

    it('2. update address', async () => {
      const token = await provisionCustomer('03');
      const created = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({ recipientName: 'A', phone: '+989120000003', province: 'Tehran', city: 'Tehran', addressLine1: 'X' })
          .expect(201),
      );
      const updated = body<{ city: string }>(
        await request(server)
          .patch(`/me/addresses/${created.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ city: 'Karaj' })
          .expect(200),
      );
      expect(updated.city).toBe('Karaj');
    });

    it('3. set default address — second address does not steal default until asked', async () => {
      const token = await provisionCustomer('04');
      const first = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({ recipientName: 'A', phone: '+989120000004', province: 'Tehran', city: 'Tehran', addressLine1: 'X' })
          .expect(201),
      );
      const second = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({ recipientName: 'B', phone: '+989120000004', province: 'Fars', city: 'Shiraz', addressLine1: 'Y' })
          .expect(201),
      );
      expect(first.isDefault).toBe(true);
      expect(second.isDefault).toBe(false);

      const promoted = body<AddressBody>(
        await request(server)
          .post(`/me/addresses/${second.id}/default`)
          .set('Authorization', `Bearer ${token}`)
          .expect(201),
      );
      expect(promoted.isDefault).toBe(true);

      const list = body<AddressBody[]>(
        await request(server).get('/me/addresses').set('Authorization', `Bearer ${token}`).expect(200),
      );
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
      expect(list.find((a) => a.id === first.id)?.isDefault).toBe(false);
    });

    it('4. remove default address — promotes the next remaining address', async () => {
      const token = await provisionCustomer('05');
      const first = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({ recipientName: 'A', phone: '+989120000005', province: 'Tehran', city: 'Tehran', addressLine1: 'X' })
          .expect(201),
      );
      await request(server)
        .post('/me/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({ recipientName: 'B', phone: '+989120000005', province: 'Fars', city: 'Shiraz', addressLine1: 'Y' })
        .expect(201);

      await request(server).delete(`/me/addresses/${first.id}`).set('Authorization', `Bearer ${token}`).expect(204);

      const list = body<AddressBody[]>(
        await request(server).get('/me/addresses').set('Authorization', `Bearer ${token}`).expect(200),
      );
      expect(list).toHaveLength(1);
      expect(list[0]?.isDefault).toBe(true);
    });

    it('8. unauthorized access — a customer cannot read/update/delete another customer\'s address', async () => {
      const ownerToken = await provisionCustomer('06');
      const strangerToken = await provisionCustomer('07');
      const owned = body<AddressBody>(
        await request(server)
          .post('/me/addresses')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ recipientName: 'Owner', phone: '+989120000006', province: 'Tehran', city: 'Tehran', addressLine1: 'X' })
          .expect(201),
      );

      await request(server)
        .patch(`/me/addresses/${owned.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ city: 'Karaj' })
        .expect(404);
      await request(server)
        .delete(`/me/addresses/${owned.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      await request(server)
        .post(`/me/addresses/${owned.id}/default`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });

  describe('Prescription lifecycle', () => {
    it('5-7. create -> retrieve -> submit', async () => {
      const token = await provisionCustomer('10');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput, notes: 'first pair' })
          .expect(201),
      );
      expect(created.status).toBe('DRAFT');
      expect(created.version).toBe(1);
      expect(created.rootId).toBe(created.id);

      const fetched = body<PrescriptionBody>(
        await request(server)
          .get(`/me/prescriptions/${created.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
      expect(fetched.id).toBe(created.id);

      const submitted = body<PrescriptionBody>(
        await request(server)
          .post(`/me/prescriptions/${created.id}/submit`)
          .set('Authorization', `Bearer ${token}`)
          .expect(201),
      );
      expect(submitted.status).toBe('SUBMITTED');
    });

    it('rejects an out-of-bounds measurement with 400, not 500', async () => {
      const token = await provisionCustomer('11');
      await request(server)
        .post('/me/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({ rightEye: { sph: 999 }, leftEye: validEyeInput })
        .expect(400);
    });

    it('treats re-submitting an already-SUBMITTED prescription as a no-op, not an error', async () => {
      // Same convention every state machine in this repo follows
      // (`PrescriptionStateMachine.isNoOp`) — a same-status call is not
      // a real transition attempt.
      const token = await provisionCustomer('12');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      await request(server)
        .post(`/me/prescriptions/${created.id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(server)
        .post(`/me/prescriptions/${created.id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    });

    it('rejects a genuinely illegal transition (reviewing a DRAFT prescription, skipping submit) with 409, not 500', async () => {
      const token = await provisionCustomer('21');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      await request(server)
        .post(`/admin/prescriptions/${created.id}/start-review`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .expect(409);
    });

    it('8. unauthorized access — a customer cannot read or submit another customer\'s prescription', async () => {
      const ownerToken = await provisionCustomer('13');
      const strangerToken = await provisionCustomer('14');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      await request(server)
        .get(`/me/prescriptions/${created.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      await request(server)
        .post(`/me/prescriptions/${created.id}/submit`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });

    it('9. reviewer access — an ordinary customer cannot reach the review endpoints (403)', async () => {
      const token = await provisionCustomer('15');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      await request(server)
        .post(`/admin/prescriptions/${created.id}/start-review`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('10. approve — full submit -> start-review -> approve path', async () => {
      const token = await provisionCustomer('16');
      const prescriptionId = await createApprovedPrescription(token);
      const approved = body<PrescriptionBody>(
        await request(server)
          .get(`/me/prescriptions/${prescriptionId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
      expect(approved.status).toBe('APPROVED');
    });

    it('11. reject — submit -> start-review -> reject, with a reason recorded', async () => {
      const token = await provisionCustomer('17');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      await request(server)
        .post(`/me/prescriptions/${created.id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(server)
        .post(`/admin/prescriptions/${created.id}/start-review`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .expect(201);
      const rejected = body<PrescriptionBody & { rejectionReason: string }>(
        await request(server)
          .post(`/admin/prescriptions/${created.id}/reject`)
          .set('Authorization', `Bearer ${reviewerToken}`)
          .send({ reason: 'Axis inconsistent with CYL' })
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Axis inconsistent with CYL');
    });

    it('12-13. create new version — approves the new version, supersedes the old, old version stays immutable', async () => {
      const token = await provisionCustomer('18');
      const v1Id = await createApprovedPrescription(token);

      const v2 = body<PrescriptionBody>(
        await request(server)
          .post(`/me/prescriptions/${v1Id}/new-version`)
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: { ...validEyeInput, sph: -2 }, leftEye: validEyeInput })
          .expect(201),
      );
      expect(v2.status).toBe('DRAFT');
      expect(v2.version).toBe(2);
      expect(v2.previousVersionId).toBe(v1Id);

      await request(server).post(`/me/prescriptions/${v2.id}/submit`).set('Authorization', `Bearer ${token}`).expect(201);
      await request(server)
        .post(`/admin/prescriptions/${v2.id}/start-review`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/prescriptions/${v2.id}/approve`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .expect(201);

      const v1After = body<PrescriptionBody>(
        await request(server).get(`/me/prescriptions/${v1Id}`).set('Authorization', `Bearer ${token}`).expect(200),
      );
      expect(v1After.status).toBe('SUPERSEDED');

      // Immutable: no route exists to edit an already-superseded/approved
      // version's measurements — the only legal next step is another
      // new-version call, which is exactly what just happened.
      await request(server)
        .post(`/me/prescriptions/${v1Id}/new-version`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rightEye: validEyeInput, leftEye: validEyeInput })
        .expect(409); // PrescriptionNotApprovedError — v1 is SUPERSEDED, not APPROVED
    });

    it('14. concurrent approval in the same lineage — exactly one wins, the other gets a real 409, never a 500', async () => {
      const token = await provisionCustomer('19');
      const v1Id = await createApprovedPrescription(token);

      // Two independent new DRAFT versions from the same APPROVED
      // predecessor — both legal to create (createNewVersion has no
      // uniqueness constraint of its own), but only one can ever reach
      // APPROVED for this root, per `prescriptions_one_approved_per_root`.
      const [vA, vB] = await Promise.all([
        request(server)
          .post(`/me/prescriptions/${v1Id}/new-version`)
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: { ...validEyeInput, sph: -2 }, leftEye: validEyeInput })
          .expect(201)
          .then((res) => body<PrescriptionBody>(res)),
        request(server)
          .post(`/me/prescriptions/${v1Id}/new-version`)
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: { ...validEyeInput, sph: -2.25 }, leftEye: validEyeInput })
          .expect(201)
          .then((res) => body<PrescriptionBody>(res)),
      ]);

      for (const v of [vA, vB]) {
        await request(server).post(`/me/prescriptions/${v.id}/submit`).set('Authorization', `Bearer ${token}`).expect(201);
        await request(server)
          .post(`/admin/prescriptions/${v.id}/start-review`)
          .set('Authorization', `Bearer ${reviewerToken}`)
          .expect(201);
      }

      const results = await Promise.allSettled([
        request(server).post(`/admin/prescriptions/${vA.id}/approve`).set('Authorization', `Bearer ${reviewerToken}`),
        request(server).post(`/admin/prescriptions/${vB.id}/approve`).set('Authorization', `Bearer ${reviewerToken}`),
      ]);
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : -1)).sort();
      expect(statuses).toEqual([201, 409]);

      const list = body<PrescriptionBody[]>(
        await request(server)
          .get('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
      const approvedForRoot = list.filter((p) => p.rootId === v1Id && p.status === 'APPROVED');
      expect(approvedForRoot).toHaveLength(1); // never two — the DB constraint, not app-layer luck
    });

    it('15. audit record exists for a meaningful action', async () => {
      const token = await provisionCustomer('20');
      const created = body<PrescriptionBody>(
        await request(server)
          .post('/me/prescriptions')
          .set('Authorization', `Bearer ${token}`)
          .send({ rightEye: validEyeInput, leftEye: validEyeInput })
          .expect(201),
      );
      const auditRow = await prisma.auditLog.findFirst({
        where: { entityType: 'Prescription', entityId: created.id, action: 'PRESCRIPTION_CREATED' },
      });
      expect(auditRow).not.toBeNull();
    });
  });
});
