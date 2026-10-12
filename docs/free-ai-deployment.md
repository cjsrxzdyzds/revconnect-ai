# Free-tier AI status

The Ask endpoint is implemented with Cloudflare Workers AI and the `@cf/meta/llama-3.2-3b-instruct` model. It only summarizes matches retrieved from the server's public organization, event, and guidance records. Reimbursement uploads and private financial data remain in the browser and are not sent to this model.

The deployment fails closed unless it can verify the account's free subscriptions before every inference. It also reserves against a persistent limit of 100 model calls per UTC day, limits each prompt to 4,096 bytes and each response to 128 tokens, and falls back to public-record search if any check or model call fails. Cloudflare documents a 10,000-neuron daily allocation on the Workers Free plan, after which requests fail rather than bill; the app's call cap is an additional guard, not a conversion of calls into neurons. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [free-allocation errors](https://developers.cloudflare.com/workers-ai/platform/errors/).

**Live status on September 29, 2026:** `CF_BILLING_READ_TOKEN` is installed as an encrypted production Worker secret. It is scoped to this Cloudflare account with Account Billing Read permission. A production `/api/ask` check using a public organization question returned `"mode":"ai"` and an English model summary with public record sources. The token value is not in this repository.

To reproduce the deployment, create a Cloudflare API token scoped to the account with **Account > Billing > Read** and install it as the Worker secret `CF_BILLING_READ_TOKEN`. Do not put the token in Git, `wrangler.jsonc`, client-side code, or a chat message. Cloudflare's [billing permission guide](https://developers.cloudflare.com/billing/understand/billing-permissions/) and [subscriptions endpoint](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/) describe the required scope. Verify a public-record Ask request returns `mode: "ai"`; a `mode: "rules"` result means the summary is unavailable and the reason indicates which gate failed. Never bypass the verification gate to make a test pass.

## Budget planning — 2026-10-12

`POST /api/planning` accepts only a bounded activity description and returns up to
three logistics questions. It uses the same free subscription verification,
128-token output limit, and global 100-call daily counter as Ask. It does not
receive quote lines, balances, evidence, or planning notes. Invalid output, limits,
unverified plans, and provider failures return a rules fallback without retries.
Planning and Ask use `@cf/meta/llama-3.2-3b-instruct`. Planning accepts validated short questions as JSON or one per line. The `/planner/` page remains functional without AI. Production availability must
be checked after deployment; enabling the flag alone does not establish free-plan
verification or a successful model response.

Production verification on 2026-10-12: `/api/planning` returned `mode: ai`.
The browser displayed two relevant logistics questions. Synthetic browser QA
verified $555 total / $200 confirmed funding / $355 shortfall, a $455 alternative
with a $255 shortfall, provisional versus planner-confirmed handoffs, the
already-paid staff-verification branch, and successful CSV download. All 67
JavaScript tests passed; focused AI tests passed after final parsing changes.
Final Worker version: `e8ffa7bd-315f-4176-a635-07439c6d5131`.
