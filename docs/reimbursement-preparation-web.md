# Reimbursement preparation web prototype

The browser-only prototype is at `/reimbursement/` in the static site. It prepares a staff-reviewed Concur worksheet and a combined evidence PDF. It does not create, approve, allocate, or submit anything in Concur or CampusGroups.

## Use

1. Export the exact CampusGroups reimbursement request as a PDF. Select it as the printout.
2. Select each original invoice or receipt as a separate file. Each file produces one proposed Concur expense, even though all files are merged into one final PDF. Select the flyer, attendee list, or other evidence separately.
3. Verify the suggested fields against the originals. Enter the current Budget line and Revenue balances, the submitted funding split, Concur dates, organization abbreviation, and any facts that extraction could not identify. Extraction never marks a field verified.
4. For each receipt, inspect itemization, paid status, card last-four presence, purchase date, exclusions, expense type, payment type, and the Budget/Revenue Allocate split. The combined eligible receipt amount must exactly equal the requested amount.
5. Resolve all findings. Copy the worksheet values into a delegate Expense Report. Generate the evidence PDF, inspect every page and its source manifest, then confirm the review checkbox to enable download. Name format: `Student Name_$Amount.pdf`.

The suggested report name is `OrgAbbrev_#RequestNumber_Reimb`; report purpose is `Student Org Reimb`; travel type is `No Travel`; Start and End dates are the first and last days of the confirmed Concur submission month. The report date is confirmed separately. Each expense uses the organization's full name as its business purpose. Budget and Revenue are identified by Oracle aliases `542302` and `542801` in the per-expense Allocate plan.

## Checks and limits

The policy check requires an eligible combined amount strictly greater than $25 and less than $500, submission within 60 days of each purchase, a different submitter and recipient, itemized paid receipts with card last-four evidence, and food-event evidence. Flowers and ammunition must be excluded; gasoline, transportation, and hotel claims go to staff review. Eligible totals retain all tax, shipping, and tips after excluded item amounts are removed. Budget and Revenue portions follow the submitted split; the check uses the current stated balances without reserving other pending requests.

Text extraction offers hints only. Selectable PDF text is read directly; scanned request and receipt pages and receipt images use local English OCR. The OCR worker, WebAssembly engine, and English language data are served from the same site. The browser retries uncertain scans at other orientations. OCR is limited to 20 attempted pages per file, and text inspection to 60 pages. Supporting materials remain visual evidence. OCR cannot prove paid status, card last-four presence, item eligibility, or live CampusGroups balances, so staff must inspect the originals. The office's heading is regenerated as an interactive PDF cover rather than copied from a private template. Staff should compare it to the approved format before use. The GWID field can remain blank only after explicit confirmation. Report-level and expense-level fields are intentionally copyable instead of being sent to Concur.

The browser parses selected files locally and creates the final PDF locally. The page contains no upload or remote OCR/model call. The static route has a restrictive Content Security Policy in `public/_headers` when served by Cloudflare; `connect-src 'self'` permits loading the site's OCR engine and language files. A basic local server does not apply that file. No case files are persisted by the page. Reloading clears the case.

## Local validation

Run `npm test` for the JavaScript suite and `python3 -m unittest discover -s tests -p 'test_payment_request_decision_tree.py'` for the existing policy tests. Run `npm run build:reimbursement` after dependency upgrades to refresh the locally pinned PDF.js and pdf-lib bundles. For a local preview, serve `public/` and visit `/reimbursement/`. The bundled runtime removes the need for staff to install software or browser extensions.
