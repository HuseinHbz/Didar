# Customer & prescription API (CP-019)

Endpoint reference for `services/api/src/modules/customer`. Follows
[`README.md`](./README.md)'s conventions (`/api/v1` base path, whitelist
validation). For the generated, always-in-sync spec, run the service and
open `/api/v1/docs`. Full rationale:
[`docs/adr/ADR-019-customer-domain-prescription.md`](../adr/ADR-019-customer-domain-prescription.md).
Auth model: [`docs/security/customer-security.md`](../security/customer-security.md).

## Auth: self-service vs. reviewer, split by prefix

- **`me/*`** — authenticated-only, no `@RequirePermission` decorator
  (same shape `me/sessions` already establishes). `CurrentUserId` derives
  the caller's identity from the verified JWT; every use case resolves
  `customerId` server-side and enforces ownership itself. There is no
  client-supplied `customerId` anywhere on these routes.
- **`admin/prescriptions/*`** — gated by
  `@RequirePermission('customer.prescription.review')`. No ownership
  check: a reviewer may act on any customer's prescription by design.
  Never reachable from an ordinary customer token.

## Profile & addresses (`me/*`)

| Method | Path                     | Auth | Notes                                                                                   |
| ------ | ------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| GET    | `/me/profile`            | Self | The caller's own `Customer` row — `nationalId` deliberately excluded from this surface   |
| PATCH  | `/me/profile`            | Self | Update `firstName`/`lastName`/`birthDate`/`gender`                                       |
| GET    | `/me/addresses`          | Self | List the caller's own addresses (soft-deleted excluded)                                  |
| POST   | `/me/addresses`          | Self | Create an address — first one is always default regardless of the `isDefault` flag sent  |
| PATCH  | `/me/addresses/:id`      | Self | Update label/recipient/phone/province/city/lines/postal code — never `isDefault` directly |
| POST   | `/me/addresses/:id/default` | Self | Atomically make this address the sole default                                        |
| DELETE | `/me/addresses/:id`      | Self | Soft-delete — if it was default, promotes the next-most-recently-created remaining one   |

## Prescriptions — customer-facing (`me/prescriptions`)

| Method | Path                                | Auth | Notes                                                                                     |
| ------ | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| GET    | `/me/prescriptions`                 | Self | Every version of every lineage the caller owns                                              |
| GET    | `/me/prescriptions/:id`             | Self | One version — 404 if it exists but belongs to another customer (never a distinguishable 403) |
| POST   | `/me/prescriptions`                 | Self | Creates version 1 of a new lineage, `status: DRAFT`                                         |
| POST   | `/me/prescriptions/:id/submit`      | Self | `DRAFT -> SUBMITTED`. Re-submitting an already-`SUBMITTED` id is a no-op, not an error       |
| POST   | `/me/prescriptions/:id/new-version` | Self | Creates a new `DRAFT` version superseding an `APPROVED` predecessor the caller owns — 409 if the predecessor isn't `APPROVED` |

Request/response bodies use **float diopters/mm** (`sph`/`cyl`/`axis`/
`add`/`pd`); the API converts to/from the persisted integer centi-unit
representation (`diopterToCenti`/`centiToDiopter`,
`@iecp/validation`) — a client never sends or receives the ×100 form.
Every response includes `clinicalApprovalStatus: 'PENDING'` — see the
ADR's §7; this reflects the validation bounds' own review status, not the
per-prescription workflow `status` field.

## Prescriptions — reviewer (`admin/prescriptions`)

| Method | Path                                   | Permission                        | Notes                                                                 |
| ------ | --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/admin/prescriptions/:id/start-review` | `customer.prescription.review`     | `SUBMITTED -> UNDER_REVIEW`                                            |
| POST   | `/admin/prescriptions/:id/approve`      | `customer.prescription.review`     | `UNDER_REVIEW -> APPROVED` — supersedes the predecessor in the same lineage, if any, in the same transaction |
| POST   | `/admin/prescriptions/:id/reject`       | `customer.prescription.review`     | `UNDER_REVIEW -> REJECTED`, requires a `reason`                        |

The `prescription_reviewer` role (seed: `+989120000018`, ADR-019 §4's
"Optometry Domain Specialist" reviewer role) is granted exactly this one
permission — never folded into `admin`'s blanket grant, the same
dedicated-role treatment `returns_manager`/`returns_clerk` get for
`return`/`credit_note`.

## Error shape

Every domain error from this module goes through
`CustomerDomainExceptionFilter` — a real HTTP status, never an accidental
500:

| Error                                | Status | Meaning                                                            |
| ------------------------------------- | ------ | -------------------------------------------------------------------- |
| `CustomerNotFoundError`               | 404    | No `Customer` row for the caller's `userId`                          |
| `AddressNotFoundError` / `...OwnershipError` | 404 | Missing or not-yours address id — same shape either way        |
| `PrescriptionNotFoundError` / `...OwnershipError` | 404 | Missing or not-yours prescription id — same shape either way |
| `InvalidPrescriptionTransitionError`  | 409    | A real illegal state-machine move                                    |
| `PrescriptionVersionConflictError`    | 409    | Lost the `prescriptions_one_approved_per_root` race to a concurrent approval |
| `PrescriptionNotApprovedError`        | 409    | `new-version` attempted from a non-`APPROVED` predecessor             |
| `InvalidPrescriptionMeasurementError` | 400    | An eye measurement outside `PRESCRIPTION_BOUNDS`                      |
