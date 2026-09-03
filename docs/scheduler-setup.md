# Scheduled ingestion — Cloud Scheduler + OIDC

`POST /internal/ingest` refreshes every enabled source for every user. It is **never publicly
invocable**: Cloud Run's IAM check runs first, and the application independently verifies the
caller's OIDC token and service-account identity (Amendment A.5).

Two gates rather than one is deliberate. A route that iterates every user's sources should not
be a single misconfiguration away from being open.

## 1. Create a dedicated invoker service account

Separate from the runtime identity. Its only privilege is invoking one Cloud Run service.

```bash
PROJECT=perimeter-507310
REGION=asia-south1

gcloud iam service-accounts create perimeter-scheduler \
  --project "$PROJECT" \
  --display-name="Perimeter scheduled ingest invoker"

SCHED_SA="perimeter-scheduler@${PROJECT}.iam.gserviceaccount.com"
```

## 2. Grant it permission to invoke the service — and nothing else

```bash
gcloud run services add-iam-policy-binding perimeter \
  --project "$PROJECT" --region "$REGION" \
  --member="serviceAccount:${SCHED_SA}" \
  --role="roles/run.invoker"
```

Note this is a **per-service** binding, not project-level. The scheduler cannot invoke anything
else, cannot read secrets, and cannot touch Firestore.

## 3. Tell the app which identity to accept

The application refuses all scheduled invocations when this is unset — a missing config value
closes the endpoint rather than opening it (B.6).

The audience must be set too. Verifying only the signature and the caller's email would accept
**any** Google-issued token belonging to that service account — including one minted for a
different service entirely. That is a valid credential presented at the wrong door, and checking
`aud` is what closes it. Both variables are required: if either is missing the endpoint returns
503 rather than guessing (B.6).

```bash
SERVICE_URL=$(gcloud run services describe perimeter \
  --project "$PROJECT" --region "$REGION" --format='value(status.url)')

gcloud run services update perimeter \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars="SCHEDULER_SERVICE_ACCOUNT=${SCHED_SA},SCHEDULER_AUDIENCE=${SERVICE_URL}"
```

`SCHEDULER_AUDIENCE` must match `--oidc-token-audience` in step 4 exactly.

## 4. Create the job

```bash
gcloud scheduler jobs create http perimeter-ingest \
  --project "$PROJECT" --location "$REGION" \
  --schedule="0 */6 * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="${SERVICE_URL}/internal/ingest" \
  --http-method=POST \
  --oidc-service-account-email="${SCHED_SA}" \
  --oidc-token-audience="${SERVICE_URL}" \
  --attempt-deadline=540s
```

Every six hours. Cloud Scheduler's free tier covers three jobs per month.

## 5. Verify

Force a run and read the result:

```bash
gcloud scheduler jobs run perimeter-ingest --project "$PROJECT" --location "$REGION"

gcloud run services logs read perimeter \
  --project "$PROJECT" --region "$REGION" --limit=30
```

Then confirm the endpoint rejects an unauthenticated caller:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "${SERVICE_URL}/internal/ingest"
# 403 — Cloud Run IAM refuses before the request reaches the app
```

And that a *valid* token from the *wrong* identity is also refused:

```bash
curl -s -X POST "${SERVICE_URL}/internal/ingest" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
# 403 Forbidden — the app checks WHICH service account, not merely that a token verifies
```

That second check is the one worth running. It is the difference between "authenticated" and
"authorised", and it is the failure mode a single IAM binding would not catch.

## What a run records

Per source: `lastRunAt`, `lastRunStatus`, `lastRunError` — all rendered in the Sources panel.
Per user: an `ingest_run` entry in the append-only audit log.

A per-source failure is recorded and the run continues; one unreachable repository does not
stop everyone else's ingest. A background job that fails silently is treated as a defect.
