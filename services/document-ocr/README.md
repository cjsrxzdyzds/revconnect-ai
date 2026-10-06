# Private OCR pilot

Cloud Run serves the private reimbursement UI and `/v1/ocr`. Google Document AI
recognizes a rendered PNG/JPEG page and returns text, line locations, token
confidence, image-quality defects, and a source hash. Results remain unverified.
Uploaded case files are not persisted by this service or written to its logs.

The public Cloudflare site serves local OCR and links to the private workspace.
In both workspaces, field suggestions, policy checks, the Concur worksheet, and
PDF assembly execute in the user's browser. There is no server-side PDF agent,
Cloud Storage case archive, durable job queue, Gemini fallback, or Concur submitter.

## Access and build

The deployed service requires Google sign-in through IAP. Cloud Run invocation
is granted to the IAP service agent, and IAP access is restricted to the owner.
Do not deploy with `--allow-unauthenticated`. The runtime service account has
Document AI API User permission; no service-account key file is required.

`DOCUMENT_AI_PROCESSOR` pins the Document AI processor version. See
`../../docs/google-cloud-ocr-pilot.md` for resource names and rollout status.
Before building, stage the published UI from the repository root:

```sh
npm run build:reimbursement
node scripts/stage_cloud_ocr_ui.mjs
```

Build only `services/document-ocr` using its `cloudbuild.yaml`, an explicit image
substitution `_IMAGE`, and the dedicated build identity. Deploy the resulting
Artifact Registry image to the existing authenticated service. The source upload
and Docker context are allowlisted; never upload the repository root, which may
contain local institutional documents. Generated `web/` assets are ignored by Git.

Service limits: 12 MiB per image, two active OCR operations per instance, one
maximum instance, zero minimum instances, 512 MiB memory, 120-second request
timeout. These are capacity limits, not a hard monetary spending cap.

## Validation

At repository root:

```sh
npm test
python3 -m unittest discover -s tests -p 'test_payment_request_decision_tree.py'
```

The HTTP tests need permission to listen on localhost. Provider calls in unit
tests are mocked. Use `/api/health` for live health checks; Google's frontend
intercepts `/healthz`. A regular Cloud Run proxy alone does not establish IAP
access; the earlier proxy benchmark preceded IAP enablement.

Synthetic evaluation scripts generate ten receipts with five variants each:

```sh
python3 scripts/generate_ocr_fixtures.py tmp/ocr-benchmark
node scripts/benchmark_local_ocr.mjs tmp/ocr-benchmark/manifest.json tmp/ocr-benchmark/local-results.json
node scripts/benchmark_document_ai.mjs tmp/ocr-benchmark/manifest.json PROCESSOR tmp/ocr-benchmark/google-results.json
```

The direct Document AI benchmark uses the signed-in gcloud identity, not the
Cloud Run HTTP/IAP route. `GCLOUD_BIN` and `CLOUDSDK_CONFIG` can select an isolated
CLI installation. Credentials stay in memory. CORD v2 setup and evaluation are
documented in `../../docs/cord-v2-benchmark.md`.

Synthetic scores do not establish real-receipt accuracy. Compare OCR separately
from field extraction, and retain manual verification of every financial fact.
