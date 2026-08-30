# Incident response (CP-029)

Closes the "Incident Response" line item from blueprint PHASE 14 and half
of `gap-priority-matrix.md`'s P1-5 ("no alerting, no runbook"). This
document is the process; [`runbook.md`](runbook.md) is the "what to
actually do" reference it points to.

## Severity levels

| Severity | Definition                                                                             | Example                                                                                                                                                                   | Response target                                        |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| SEV1     | Customer-facing outage or data-integrity risk. Orders/payments cannot complete.        | `services/api` down; `HighErrorRate` firing above 50%; a payment double-charge                                                                                            | Immediate — page, do not wait for a scheduled check-in |
| SEV2     | Degraded but not down. A subset of functionality is broken; workaround may exist.      | `QueueBacklog`/`QueueFailureSpike` firing (notifications delayed, not lost — see the "no silent job loss" guarantee in `redis-failure-runbook.md`); `SlowRequests` firing | Within the current business day                        |
| SEV3     | Real but non-urgent. No customer impact yet, but left alone it could become SEV1/SEV2. | `ServiceDown` firing for a background worker with a healthy queue depth; a single failed alert that self-resolved                                                         | Next business day                                      |
| SEV4     | Informational. No action required beyond acknowledgment.                               | A transient scrape gap; a known, already-documented environmental limitation (e.g. this sandbox's blocked outbound egress)                                                | Log and move on                                        |

## Response process

1. **Acknowledge.** Confirm you are looking at the alert, so it doesn't
   also page someone else redundantly (if a paging system with
   acknowledgment is in use — this repo does not prescribe or configure
   one; see `infrastructure/monitoring/README.md`'s own "if a real
   deployment target exists" section for why).
2. **Classify severity** using the table above. When in doubt, classify
   one level more severe than you think, then downgrade once you have
   more information — never the other way around.
3. **Triage using [`runbook.md`](runbook.md)'s alert → runbook map** and
   its symptom → cause map. Most incident classes already have a documented
   first step.
4. **Mitigate before you diagnose the root cause**, if the two are in
   tension. Restoring service (per the runbook) takes priority over
   understanding exactly why it broke — the "what to do" in
   `runbook.md` and `redis-failure-runbook.md` is written to be safe to
   follow without first understanding the root cause.
5. **Communicate status** at whatever cadence the severity warrants (SEV1:
   continuously until resolved; SEV2: at defined checkpoints; SEV3/SEV4:
   at resolution). This repo does not prescribe a specific channel — that
   is an operational decision for whoever runs the real deployment.
6. **Resolve and confirm recovery** using the same signal that indicated
   the incident (the alert clears, `/health/ready` returns clean, the
   specific downstream effect resumes).
7. **Postmortem** for every SEV1 and any SEV2 that recurred. Use the
   template below. Skip for SEV3/SEV4 unless a pattern of repeated SEV3/
   SEV4 incidents itself becomes worth investigating.

## Postmortem template

```
# Incident: <short title>
Date:
Severity:
Detected via: <alert name, user report, manual observation>
Time to detect:
Time to mitigate:
Time to resolve:

## What happened
<factual timeline, no blame>

## Root cause
<the actual mechanism, not just the symptom>

## What limited the impact
<what already-built mechanism helped — e.g. "no business record is only-in-Redis" (redis-failure-runbook.md), an idempotent recovery sweep, a bounded startup preflight>

## What made it worse, or slower to detect/resolve
<gaps this incident exposed>

## Action items
<concrete, owned, dated — not "improve monitoring" as a vague aspiration>
```

## What this document does not cover

- **On-call scheduling/paging-tool configuration.** A real operational
  decision for whoever runs a real deployment, not something this
  repository's code or governance can decide for them.
- **Notification channel wiring** (where an Alertmanager receiver
  actually sends a page/Slack message/email) — see
  `infrastructure/monitoring/README.md`'s explicit "not configured here"
  note.
- **Post-incident customer communication** — a product/support process,
  not an engineering one.
