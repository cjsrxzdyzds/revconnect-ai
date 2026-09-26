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
| List sample | Initial inspection covered 20 entries; follow-up expanded to the first 100 loaded rows under Updated On descending. This is not a representative sample or a full historical audit. |
| Form definition | Counted all 12 pages and 71 question blocks in the current definition. Conditional branches mean an individual request does not answer all 71 questions. |
| Request routes | Observed 9 choices at the root request-type question. |
| Categories | Observed 11 credit-card choices and 12 reimbursement choices. These overlap and are not 23 distinct expense categories. |
| Attachments | The interface offered a ZIP download of 491 files. No bulk ZIP was downloaded. One PDF download was subsequently removed by the user and its body was not read. Two existing chat image attachments were later visually read in browser previews. |
| Financial details | Selected linked detail views exposed transaction, budget, funding, and allocation fields. Their availability in exports is not verified. |
| Workflow | Read stage definitions for credit card, reimbursement, contract, ACH, and hotel samples. Two existing conversations were read. Complete workflow histories were not collected. |
| Reporting | Generate Report and Stats controls are present. Report output, format, columns, attachment joins, and pagination are not verified. |
| API | No authenticated financial API endpoint or institutional integration credentials were tested. Browser visibility does not establish API availability. |

Research used read-only observations. No requests were approved, rejected, edited, reset, submitted, or paid. No messages were sent. This document contains no submitted personal record values, raw receipt contents, private attachment links, banking details, or session-bearing URLs.

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

Completed: current form inventory, 100-row aggregate sample, route/category choices, selected financial detail views, five route workflow definitions, two existing conversations, two chat image previews, and a de-identified field catalog.

Not completed: full historical collection, form-upload PDF reading, automated OCR validation, authenticated export/API access, official rule reconciliation, Box archive verification, importer implementation, or automation deployment.

Resume with export/field coverage verification. Application development and Cloudflare work remain paused until the user resumes them.

## Follow-up: attachment inspection access checkpoint

The user requested continued read-only exploration, including opening attachments. At this follow-up, the previously inspected submission and detail tabs were no longer present. The current browser showed the logged-in RevConnect home page. Opening the known submission-list URL redirected to the home page, so an attachment could not yet be selected.

The Groups menu displayed a Manage Org Help Admin entry. Automatic approval review blocked navigating through that management entry because it could expose unrelated private administrative content outside the attachment-research scope. No alternate route was used to bypass the block. The payment-request list subsequently became visible in the browser, and read-only research continued from that visible page without repeating the rejected navigation.

At this initial access checkpoint, no attachment body had been read. Later browser previews of existing chat images succeeded, as documented below. The list again displayed the 491-file ZIP control; this is a UI count, not a collection of inspected files.

### Verified attachment metadata

The current first page contains 20 submission cards. After expanding seven selected cards, the rendered page exposed **19 attachment-link occurrences representing 15 distinct file tokens across 10 submissions**. Other cards and inactive/hidden answers may contain additional files; zero visible attachments does not establish that a request has none. These counts describe the observed page state, not all 669 submissions.

The same file can appear both in an answer and in the card's attachment summary. Counting links would overcount files. The source `get_file` URL includes an `eid` token that supports deduplication in this observation; its stability across exports or sessions has not been verified. Do not publish these access URLs.

One reimbursement card exposed four distinct attachments: three image-named files and one document-named file. Another card exposed two distinct document-named attachments. File prefixes and names are useful hints, but do not prove the document's type or validity.

Seven useful metadata/evidence types can be retained in a controlled importer: source file token; displayed filename; filename-based type hint; parent submission association; source-question association when visibly provided; repeated-link relationship; and observed access/readability outcome. A summary link alone does not establish which document requirement a file satisfies.

### Reading attempts and limits

A single PDF attachment was downloaded through the browser's attachment control to the user's Downloads folder. The file could not be opened by the local analysis tools, so no PDF text, page count, invoice values, or receipt completeness was established. The user reported removing the downloaded files. Further exploration used browser-preview attempts and DOM metadata; no additional explicit download operation or bulk ZIP download was performed.

Opening the observed PDF attachment URL did not expose readable content in the browser state. An image attachment reached through the generic file-download route was blocked by the browser with a client-side error. Later, two direct image links from an existing conversation opened successfully in normal browser previews. Form-upload PDF reading and a reliable general attachment-reading method remain unverified. No private document values, screenshots of receipts, file tokens, or attachment URLs are included in this report.

### Proposed attachment field checklist — not yet verified against files

For a small receipt/invoice sample, inspect whether the document exposes: merchant/payee; invoice or order number; purchase/invoice date; service date; item descriptions; quantities; unit prices; subtotal; tax; fees/tips; total; currency; paid/unpaid status; payment method; and masked card reference if present. These are 15 candidate field types, not 15 guaranteed fields per document. The office's exact payment-evidence requirement still needs confirmation.

For event flyers, inspect: event title; hosting organization; date; time; location; and event purpose. These are 6 additional candidate field types. A flyer alone does not establish that an expense belongs to the event; the request and purchase evidence must be linked.

Also verify document format, page count, whether text is directly selectable or requires OCR, the associated submission/question IDs, and whether attachments can be retrieved through an authorized export. Findings should distinguish absent information from unreadable information and from information that does not apply.

### Office workflow supplied by the user

**Later clarification (2026-09-26):** The purchase initial gate checks sufficient funds only; food evidence does not block that first gate. Initial funding follows the submitted split and uses system current balances without deducting pending unpaid requests. Budget preference applies to the extra amount only after an actual purchase overrun, with Revenue covering any remainder. Reimbursements allow multiple receipts, match the eligible combined total exactly, and require an amount strictly between $25 and $500. All tax, shipping, and tips remain included after ineligible item exclusions. The user confirmed paid evidence plus card last four, the 60-day window, different submitter/recipient, and food flyer or attendee list. Gasoline, transportation, and hotel reimbursements go to staff; flowers and ammunition are ineligible. The [agent decision tree](payment-request-agent-decision-tree.md) and [policy configuration](payment-request-agent-policy.json) record these later rules and remaining exception conditions. The earlier bullets below describe the original discussion, rather than all first-stage gates.

The user described office procedures that add context beyond the form definition. These are user-reported practices, not independently verified policy:

- Intake separates purchases from reimbursements. Purchases are routed by Amazon, ordering platforms such as EZCater/Instacart, established vendor accounts, or student-supplied purchasing websites.
- Review checks the relevant revenue balance or specific budget line and applicable supporting materials. Food purchases/reimbursements require event evidence under the described office checklist.
- Staff invite students to the office when ready to handle a purchase; the office's approved message template has not yet been supplied.
- Completed purchases are documented and receipts are stored in Box. Student-facing and internal conversations have different audiences and purposes.
- Delayed receipts, including some ordering-platform and subscription cases, require an internal record of purchase timing, expected charges, and expected receipt arrival.
- Reimbursements require an itemized receipt, purchase date, and payment evidence. The exact meaning of the user's card-information requirement needs clarification; full card numbers and security codes are not research inputs.
- Eligibility exceptions and prohibited categories need a written rule sheet. Ambiguous spoken category names should not become automatic rejection rules.

The next practical milestone is a verified, controlled way to read a small attachment sample and join it to request and funding data. The immediate achievable output is a pre-review summary and delayed-receipt ledger; automatic approval, purchasing, messaging, and Box uploads have not been implemented or performed.

## Expanded research: information catalog and case relationships

A machine-readable [information catalog](payment-request-information-catalog-2026-09-26.json) accompanies this report. It records source-specific fields and evidence status, not actual submission values.

| Catalog family | Entries | Examples |
| --- | ---: | --- |
| Current form questions | 71 | Routes, categories, recipients, vendor, dates, travel logistics, document upload questions |
| Request and funding metadata | 38 | Submission/transaction IDs, budget, accounting code, raw amounts, balances, notes, financial statuses |
| Workflow and conversation metadata | 18 | Stage labels/instructions, source state, approval policy, approver, channel audience, message ID/date/time, chat attachments |
| Attachment metadata | 8 | File token, filename, source association, duplicate-link relationship, preview outcome, image dimensions |
| Visual document evidence | 28 | Order dates/numbers, items, quantities, prices, discounts, delivery, subtotal, tax, totals, masked payment evidence |
| **Source-specific catalog entries** | **163** | These are not 163 independent facts available for every request. Concepts can appear in several sources; questions can contain several concepts. |

Card expiry was visible in a sample image but should be omitted from routine normalized case data. The catalog describes its presence without retaining its value. Field visibility is not a requirement to collect every field.

### Expanded sample coverage

The first 100 loaded submissions were ordered by Updated On descending. The sample contained 78 credit-card requests, 16 reimbursements, 3 hotels, and one each for Contract, ACH/Direct Deposit, and Campus Rec Travel. It is a recency-selected sample; do not extrapolate it to all submissions or annual workload.

Within the 78 credit-card requests, visible categories were: 33 Misc. Supplies/Equipment, 26 Food, 7 Registration, 4 Clothing, 3 Membership, 2 Books, 2 Services, and 1 Already paid by staff p-card. The last choice confirms an already-paid case in the sample; its special workflow was not successfully inspected.

Across these 100 rendered cards, **47 had visible form attachments, with 91 link occurrences representing 60 distinct file tokens**. Some answers remained collapsed. These counts exclude separately discovered chat attachments and do not prove that the other requests lack evidence.

Recognized visible stage labels included 48 Initial Review, 5 Awaiting Receipt, 3 Make Appointment, 2 Contract/Check Processing, and 1 Conur Submitted. Other records did not display one of these recognized labels; this is not a complete status distribution. The overall submission heading showed 670 while earlier counters separately showed submitted and archived records; reconcile count semantics before treating them as a historical change.

### Workflow definitions verified in samples

| Route | Source stages |
| --- | --- |
| Credit Card | Initial Review → Action Required - Make Appointment → Action Required - Awaiting Receipt from Submitter → APPROVED |
| Hotel | Same labels as the inspected credit-card workflow; all stages were complete in the inspected hotel case |
| Reimbursement | Initial Review → Conur Submitted → Reimb Manager Approval → APPROVED |
| Contract | Contract/Check Processing → APPROVED |
| ACH/Direct Deposit | Contract/Check Processing → APPROVED |

The source UI distinguishes complete, active, and disabled stages and displays individual approver states. The inspected approval stages use ANYONE (FROM ANY TEAM) APPROVES. A workflow's stage state and each approver's state should be stored separately. Complete approval-event timestamps and stage-entry times were not established.

The receipt-stage instructions explicitly describe a completed transaction awaiting an itemized receipt. This is operational evidence for a receipt-follow-up queue; it is not bank-settlement confirmation. The Hotel example shows that request route and workflow template are separate dimensions.

### Existing conversations and document previews

Only conversations with an existing visible message count and no prefilled message were opened. Other chat controls contain setup parameters and prefilled context; they were not initialized. No message composer, upload, approval, rejection, or notification control was activated.

- One applicant/admin conversation contained a context message and two image attachments. Direct image links opened in the browser without another explicit download operation.
- The first image showed two order groups and three products, including order dates/numbers, totals, purchaser/recipient context, prices, and relative delivery timing.
- The second image showed another product, SKU, quantity, original/current price, discount, shipping details, payment details, subtotal, shipping, tax, and total. No purchase date or order number was visible in this image. Do not copy those fields from another order merely because both images share a conversation.
- These are order/payment screenshots, not verified compliant final invoices or proof of settlement. A screenshot of an Invoice button is not the underlying invoice.
- An existing internal hotel conversation contained system context and a staff note with a merchant/organization/transaction/amount/fund-style reference. Sender, message ID, calendar date, time, and participant context were visible. The reference did not establish an actual Box file or path.

### Reconciliation findings

The visible order totals for one purchase case did not equal its current allocated amount. Possible explanations include estimates, tax, changed prices, partial funding, or unrelated evidence. The cause was not established. Preserve both values and route the discrepancy for review.

The hotel case had an earlier split-funding calculation in Additional Notes, different current allocation/group-funds amounts, and an internal staff note whose total reconciled with those current components in this sample. This supports separate fields for original estimate, actual recorded amount, funding components, and evidence time. It does not establish a universal rule for summing similarly named amount fields in other views.

A Revenue budget name or a Revenue-style archive label does not establish that every part of a transaction came from revenue. The observed hotel case also referred to co-sponsored funding. Funding components need their own records.

The field catalog therefore needs relationships across request → transaction → budget/funding components → orders/line items → form/chat evidence → staff processing notes → verified archive. One request can have multiple orders, attachments, and funding components.

### Public API documentation: candidate integration path

The vendor's [Data Export API documentation](https://docs-prod-us-east-1.service.campusgroups.com/service-data/index.html) documents budgets, budget transactions, forms, and submissions. Financial models include funding components, payment classification, vendor, references, and receipt references; submission models include question responses and approval metadata. Queries use institutional authentication, update windows, asynchronous retrieval, and pagination. GW access is untested. Question IDs, related-content joins, attachment bodies, chat history, workflow events, and budget-line balances need coverage verification.

The separate [CampusGroups API documentation](https://www.campusgroups.com/api?public=1) describes a transaction-writing method. No write method was invoked; documented write support does not establish a supported API for advancing GW workflows.

### Remaining task-flow information gaps

| Gap | Why it matters |
| --- | --- |
| Formal rule list, exceptions, and effective dates | Prevent menu choices, old instructions, or ambiguous spoken rules from becoming incorrect rejection rules |
| Balance semantics, update time, and pending commitments | Prevent approval based on the wrong line, stale funds, or simultaneous requests |
| Actual stage-entry and external-system submission times | Establish overdue work without substituting Updated On for stage age |
| Expected charge/receipt date and assigned staff owner | Make delayed-receipt follow-up actionable |
| Box file ID/path and archive verification | Distinguish a filename mentioned in chat from a file that actually exists |
| Order-to-request and payment-to-receipt linkage | Handle multiple orders, split funding, changes, and incomplete screenshots |
| Whether chat activity updates the parent record | Avoid missing new evidence during incremental imports |
| Institutional API scope and connector permissions/costs | Select an integration path without assuming school access or free use |

Browser navigation, state reading, and tab closing repeatedly timed out while attempting special-case workflows after the 100-row sample. Campus Rec, the already-paid category, and the later Concur-stage case were observed in the list but their additional workflow details are not claimed as inspected. Resume from the saved catalog and verify these cases when browser control is available.
