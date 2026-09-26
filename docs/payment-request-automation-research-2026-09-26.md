# GW Payment Request Form: Research Progress and Automation Design

Research date: September 26, 2026 (America/New_York).

Status: research only. RevConnectAI application development and Cloudflare integration are paused at the user's request. This document preserves the findings and a proposed design; it does not implement an integration or authorize financial actions.

## Conclusion

The Payment Request Form can support substantial automation of intake, document checks, classification, reconciliation preparation, and review queues. A single reimbursement-versus-payment classifier is insufficient. The current form mixes request routes, expense categories, purchasing channels, funding sources, and purchases that have already been paid.

Use a financial case with separate dimensions for purpose, payment method, expense category, funding allocation, approval state, and processing state. Preserve the original answers and their evidence. Start with deterministic extraction and checks; use a model only for ambiguous descriptions and document extraction after the data handling arrangement is established. Keep approval and payment within the existing authorized staff workflow.

## Evidence and coverage

The primary source is the authenticated [GW Payment Request Form submissions page](https://revconnect.gwu.edu/form_answers?id=4), its form definition, linked request details, and an inspected workflow. These sources require appropriate access.

| Observation | Coverage and limitation |
| --- | --- |
| Submission list | The interface showed 669 submitted records and 1 archived record. These are interface counts, not a downloaded dataset. |
| List sample | Inspected the first page of 20 entries and selected expanded answers/details. This is not a representative sample or a full historical audit. |
| Form definition | Counted all 12 pages and 71 question blocks in the current definition. Conditional branches mean an individual request does not answer all 71 questions. |
| Request routes | Observed 9 choices at the root request-type question. |
| Categories | Observed 11 credit-card choices and 12 reimbursement choices. These overlap and are not 23 distinct expense categories. |
| Attachments | The interface offered a ZIP download of 491 files. No bulk ZIP or receipt contents were downloaded or inspected. |
| Financial details | Selected linked detail views exposed transaction, budget, funding, and allocation fields. Their availability in exports is not verified. |
| Workflow | Inspected one reimbursement workflow and observed other route stages in the list. Complete workflow histories were not collected. |
| Reporting | Generate Report and Stats controls are present. Report output, format, columns, attachment joins, and pagination are not verified. |
| API | No authenticated financial API endpoint or institutional integration credentials were tested. Browser visibility does not establish API availability. |

Research used read-only observations. No requests were approved, rejected, edited, reset, submitted, or paid. This document contains no submitted personal records, receipt contents, private attachment links, banking details, or session-bearing URLs.

The session exposes administrative functions. Do not infer that ordinary students can see the same data, or that a student-facing RevConnectAI application may use this access.

## Information that can be collected

These are ten useful information families, not a claim that every field exists in every request or in one export.

| Family | Observed information | Automation use |
| --- | --- | --- |
| Identity and provenance | Submission identifier, form/question identifiers, started/submitted/updated dates, linked transaction identifier | Join records, incremental imports, auditability |
| People and organizations | Submitter, reimbursement recipient, recipient organization/department, vendor/contact, group name/type | Resolve roles without conflating submitter, purchaser, beneficiary, and payee |
| Request routing | Credit card, reimbursement, ACH, contract, transfer, and travel routes | Select the applicable checklist and review queue |
| Expenses and purpose | Category, vendor/store, description, transfer reason, destination | Classify expenses and split mixed purchases into line items |
| Amounts and funding | Requested amount, contract total, budget name, allocation/group-money fields, budget line, balance | Prepare reconciliations and identify inconsistencies |
| Dates and timing | Purchase, event/service, departure/return, check-in/check-out, rental dates | Check timing and distinguish invoice date from service date |
| Delivery and logistics | Campus/off-campus/pickup, address/building/room, tickets, vehicles, authorized drivers, voucher recipients | Route operational work and identify missing logistics |
| Evidence | Invoice, itemized receipt, event flyer/attendee list, travel bill, authorization form/link, confirmation | Branch-specific completeness checks and document extraction |
| Approval and processing | Approval status, workflow step/title, approvers, waiting state, approved date when available | Show where a request is waiting; separate approval from payment |
| Exceptions and data quality | Notes, stale conditional answers, menu/instruction conflicts, possible duplicates | Create explainable review findings rather than silently changing records |

The list exposes Pending Approval, Approved, Rejected, On Hold, and Requires Modifications filters. Approval is not evidence of bank settlement. A linked transaction identifier is different from a submission identifier.

## Request routes and category choices

The nine root routes are Credit Card; Reimbursement; Contract; ACH/Direct Deposit; Transfer (org, dept); Hotel; Transportation Tickets (plane, train, bus); Enterprise Car Rental; and Campus Rec Travel.

| Branch | Choices observed |
| --- | --- |
| Credit-card purchase type | Food; Misc. Supplies/Equipment; Services; Membership; Registration; Printing; Clothing; Books; Postage/Shipping; Already paid by staff p-card; Others |
| Reimbursement category | Food; Subscriptions; Supplies; Contract Services; Office Supplies; Membership; Registration; Printing; Clothing; Books; Postage/Shipping; Other |
| Intended credit-card vendor/channel | Amazon; EZCater; Instacart; Uber Eats; PayPal; Other |

“Already paid by staff p-card” describes a processing state, not what was purchased. Campus Rec Travel can record a charge after booking/payment. Transfers move funds internally. A contract can involve a deposit or installment whose requested amount differs from the total contract cost. These cases need distinct handling.

The intended vendor/channel can be a marketplace or payment service, while a separate answer identifies the restaurant or store. Keep both instead of treating the channel as the legal payee.

## Proposed normalization paradigm

### Independent dimensions

| Dimension | Proposed normalized values or behavior |
| --- | --- |
| `request_route` | Preserve the nine source choices; do not replace them with the inferred purpose. |
| `purpose` | `reimbursement`, `vendor_payment`, `internal_transfer`, `reconciliation`, or `unknown` |
| `payment_method` | Card, ACH/check, internal transfer, or unknown; preserve the actual source choice. A travel service is not a payment method. |
| `expense_category` | Food, supplies/equipment, services, subscription, membership, registration, printing, apparel, books, shipping, travel subcategories, other, or unknown |
| `budget_code` | Preserve the institution's actual accounting code and description; do not infer it from expense category alone. |
| `payment_state` | Requested, committed, already paid, reconciled, or unknown, only when supported by evidence |
| `approval_state` | Preserve source status and workflow stage. Approval and payment remain independent. |
| `evidence` | Source field/document, extraction location, confidence, and unresolved conflict |

The proposed expense taxonomy is an initial mapping, not an official GW chart of accounts. Sample financial views showed codes such as OC03 Food/Drink, OC06 Inventories/Supplies, and OC13 Training. A books request was associated with Training, demonstrating that purchase category and budget code cannot be collapsed into one field. The full account catalog was not inspected.

### Case structure

Use linked records rather than one large text prompt:

- **Request:** source submission/transaction IDs, route, purpose, dates, raw answers, normalized fields, import version.
- **Parties:** submitter, purchaser, reimbursement recipient, vendor/payee, organization, department, and reviewer roles.
- **Line items:** description, quantity when known, category, amounts, invoice/receipt references, and event/service context. One request can contain several expense categories.
- **Funding allocations:** budget ID/name, account code, source allocation fields, amount semantics, and balance snapshot.
- **Documents:** type, source attachment reference, verification state, extracted fields, and evidence locations. Avoid publicly accessible copies.
- **Workflow events:** source status/stage, observed time, event time if supplied, responsible team, and recorded outcome.
- **Review findings:** rule ID/version, severity, affected fields, evidence, exception status, and human resolution.

Store the raw source alongside normalization. Use stable source IDs for idempotent imports; use update times or content versions to detect changes. Preserve financial values as decimal strings or minor units with explicit currency, rather than binary floating-point values. Never infer currency solely from a dollar symbol.

The financial UI uses negative amounts in some accounting fields. In one inspected view, similarly named funding fields repeated the same amount. Preserve these values and mark their semantics as unverified; summing them could double-count a request. A contract total, invoice total, deposit, amount requested, approved allocation, and amount settled are separate concepts.

### Synthetic example

The following is invented and contains no actual submission data:

```json
{
  "request_route": "Credit Card",
  "purpose": "vendor_payment",
  "payment_method": "card",
  "payment_state": "unknown",
  "approval_state": "pending",
  "line_items": [
    { "description": "Refreshments", "expense_category": "food" },
    { "description": "Whiteboard", "expense_category": "supplies_equipment" }
  ],
  "funding_allocations": [],
  "findings": [
    {
      "code": "mixed_expense_categories",
      "resolution": "review_line_items_before_account_assignment"
    }
  ]
}
```

## Rules and contradictions to preserve

These observations summarize the current form's instructions. They are not an independent verification of current university policy. Before production enforcement, reconcile them with authoritative policy owners, effective dates, and documented exceptions.

| Topic | Form observation | Proposed handling |
| --- | --- | --- |
| Reimbursement amount and age | Instructions describe a $25–$500 range and a 60-day submission window; additional text refers to prior-approval exceptions. | Calculate dates/amounts deterministically; route exceptions to review. |
| Submitter versus recipient | Instructions say the person being reimbursed cannot submit their own request and refer to another authorized officer. | Compare resolved identities; flag uncertainty rather than matching names alone. |
| Reimbursement menu conflict | Clothing, Registration, and Contract Services remain selectable even though instructions restrict related reimbursements. | Emit an instruction/menu conflict finding. A selectable option is not proof of eligibility. |
| Receipt evidence | Instructions require an itemized receipt rather than a bank statement; food also requires a flyer or attendee list. | Check applicable document types and extracted completeness. File presence alone does not prove validity. |
| ACH invoice | Instructions specify vendor identity/address, invoice number/date, amount, and goods/services; approved vendor setup is a separate process. | Check invoice completeness and separately verify vendor status through an authorized source. |
| Banking information | Vendor banking setup is directed to PaymentWorks. | Store vendor onboarding status/reference, not banking credentials in request intake. |
| Contracts | Instructions require the contract process before payment and distinguish contract approval from student signature authority. | Link contract evidence; keep service date, contract total, invoice, and installment separate. |
| Payment timing | ACH/contract instructions describe Net 30 based on the later relevant invoice/service date. | Extract both dates; verify the policy and exceptions before producing a payment deadline. |
| Transfers | Instructions distinguish allocation/revenue funds and restrict certain source-to-destination combinations. | Validate the funding pair against a versioned rule table. |
| Travel | Instructions describe advance planning, event/travel approval, and restrictions on personal purchases. | Apply route-specific checklists; verify domestic/international and exception rules. |
| Hotel and rental | Hotel, rental, driver, authorization, and final-receipt requirements differ. | Select the relevant branch rather than one generic travel checklist. |
| Campus Rec | Instructions describe recording already booked/paid travel and avoiding a second entry when Club Sports has recorded it. | Reconciliation and duplicate-candidate review, not an automatic new payment. |
| Conditional answers | A sampled off-campus request retained an on-campus location answer. | Preserve raw values; determine the active branch and flag contradictory stale answers. |
| Mixed purchases | A sampled description combined food and equipment under a single Food selection. | Suggest line-item separation with evidence; retain the submitted category. |
| Similar requests | Similar titles by the same submitter appeared at different times. | Treat as duplicate candidates only; compare invoice IDs, dates, totals, vendor, and documents before a conclusion. |

One reimbursement workflow showed Initial Review → “Conur Submitted” (source spelling) → Reimb Manager Approval → Approved. Other list entries showed Contract/Check Processing and a credit-card stage awaiting a receipt. Workflow labels differ by route and can contain typos; preserve source values and use explicit mappings.

The list's Updated On timestamp does not establish when the current stage started. Stage aging requires actual stage-entry timestamps or a clearly labeled observation-based estimate.

## Automation workflow

1. **Acquire:** verify an authorized report/export or institution-supported API. Record scope, source IDs, and extraction time. Do not assume visible questions, finance details, workflow history, or attachments are included in one export.
2. **Normalize:** retain raw answers, resolve active conditional branches, map parties and routes, parse dates and amounts, and join submissions to transactions by source IDs.
3. **Extract evidence:** parse structured PDFs where available; use OCR for scans. Capture invoice number, vendor, dates, line items, totals, and document type with page/field evidence. Document extraction is a proposed capability, not tested in this research.
4. **Validate:** run versioned, branch-specific deterministic checks for completeness, conflicts, timing, arithmetic, funding combinations, and duplicate candidates.
5. **Triage:** produce queues such as Ready for Human Review, Missing Evidence, Rule/Category Conflict, Possible Duplicate, Funding Review, and Already-Paid Reconciliation. Ready for review does not mean approved.
6. **Review:** show original evidence and reasons. Record staff corrections and exceptions instead of silently replacing source answers.
7. **Reconcile:** update processing state only from an authorized source that actually establishes the relevant outcome. An approved request must not be automatically marked paid.

An LLM can help interpret descriptions, propose categories, and extract ambiguous document fields. It should not calculate balances, invent missing facts, resolve contradictory policy, infer approval, or initiate payment. Most initial value comes from structured intake and rules, without a model.

No submitted financial records or attachments were sent to Cloudflare Workers AI or another external model during this research. The paused free-tier AI work is a separate application task, not an approved destination for this financial dataset.

## Complete current question inventory

Question identifiers below were observed in the current form definition. Labels are shortened English descriptions. `M` means the builder displayed a mandatory marker; it does not mean the field applies to every route. `O` means no mandatory marker was observed. Requiredness must be combined with verified conditional-display rules, which have not yet been exhaustively captured.

| Page | Questions | Inventory: question ID — description (marker) |
| --- | ---: | --- |
| 1. Purchase Requests | 1 | 25 — Request type (M) |
| 2. Credit Card | 8 | 7 — Purchase type (M); 26 — Intended vendor/channel (M); 1144 — Wishlist link (O); 27 — Event flyer/attendee list (M); 28 — Vendor name (M); 33 — Invoice attachment (M); 34 — Restaurant/store (M); 35 — Event date (M) |
| 3. Delivery | 8 | 36 — Recipient name (M); 1454 — Recipient phone (M); 37 — Campus/off-campus/pickup (M); 1608 — Academic office/dorm (M); 1204 — Dorm (O); 38 — Academic office building (O); 39 — Room/office number (M); 40 — Address (M) |
| 4. Reimbursement | 6 | 41 — Reimbursement recipient (O); 45 — Category (M); 536 — Purchase vendor (M); 51 — Purchase date (M); 47 — Receipt attachment (M); 46 — Event flyer/attendee list (M) |
| 5. ACH/Direct Deposit | 2 | 108 — Invoice attachment (M); 692 — Vendor name/contact (M) |
| 6. Org/Dept Transfer | 7 | 63 — Recipient type (M); 62 — Transfer reason (M); 2070 — Organization (M); 676 — Department name (M); 65 — Oracle/Banner number (M); 66 — Event confirmation number (O); 675 — Event confirmation/fleet rental summary (O) |
| 7. Travel | 8 | 67 — Destination (M); 68 — Method (M); 69 — Company (M); 70 — Station/airport (M); 71 — Ticket/voucher count (M); 72 — Departure date (M); 73 — Return date (M); 74 — Nonrefundable/group ticket acceptance (M) |
| 8. Uber Vouchers | 4 | 535 — Destination (M); 112 — Voucher count (M); 113 — Recipient emails (M); 225 — Amount per voucher (O) |
| 9. Hotel | 13 | 75 — Destination (M); 76 — Hotel name (M); 77 — Check-in date (M); 78 — Check-out date (M); 79 — Reservation already made (M); 85 — Booking channel (M); 80 — Confirmation number (M); 81 — Daily/total room rate and tax rate (M); 83 — Block/nonrefundable acceptance (M); 87 — Reservation name (M); 224 — Credit-card authorization format (O); 222 — Authorization attachment (O); 223 — Authorization link (O) |
| 10. Enterprise | 6 | 96 — Destination (M); 97 — Pickup/return location (M); 1185 — Pickup date (M); 1186 — Return date (M); 99 — Vehicles/count/models (M); 98 — Authorized drivers (M) |
| 11. Contracts | 6 | 677 — Vendor name (M); 638 — Event request completed (M); 678 — Event/service start date (M); 679 — Contract request completed (M); 635 — Total contract cost (M); 637 — Vendor payment method (M) |
| 12. Campus Rec Travel | 2 | 690 — Travel type (M); 691 — Travel receipt/confirmation (M) |
| **Total** | **71** | Current form definition only; historical submissions may reflect earlier versions. |

Some questions contain several concepts in one free-text answer, such as room rate/tax/total or vehicle models/counts. Those need separate normalized fields with an unresolved state when parsing is ambiguous. Instruction text also mentions information without a distinct structured question, so checklist completeness cannot be determined from question presence alone.

## Open questions and next research steps

1. Verify Generate Report output on a small authorized sample: IDs, all branch answers, finance fields, encoding, timestamps, blank-value semantics, and coverage across pages.
2. Determine whether finance allocations, workflow events, and attachments need separate exports; test joins using source IDs.
3. Obtain the full conditional-display graph and historical form versions. Confirm whether omitted answers mean unanswered, inactive, unavailable, or not included in an export.
4. Confirm institutional API availability, permitted data scope, account/organization access controls, update cadence, and any integration costs. No API is assumed available.
5. Confirm the meaning and sign of allocation/group-money fields, the chart of accounts, deposit/installment handling, and the source that establishes payment settlement.
6. Reconcile menu/instruction conflicts with current authoritative policies, effective dates, and exception procedures. Obtain complete workflow definitions for each route.
7. If approved to proceed, pilot a read-only importer on 10–20 de-identified or appropriately controlled cases spanning credit card, reimbursement, ACH, and contract. Test mixed categories, missing evidence, stale branches, installments, and duplicate candidates.
8. Measure field extraction accuracy, false-positive review findings, unresolved cases, and reviewer effort before claiming an automation rate or time saving.

## Resume checkpoint

Completed: submission-list inspection, current form inventory, route/category choices, selected financial detail views, one workflow inspection, and this de-identified research document.

Not completed: bulk collection, receipt/OCR inspection, verified financial export/API access, full historical distribution, official rule reconciliation, importer implementation, or automation deployment.

Resume with export/field coverage verification. Application development and Cloudflare work remain paused until the user resumes them.
