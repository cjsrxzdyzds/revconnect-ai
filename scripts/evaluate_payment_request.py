#!/usr/bin/env python3
"""Evaluate normalized, verified facts offline. No external actions or model calls."""

import argparse
import json
from datetime import date
from pathlib import Path


POLICY_PATH = Path(__file__).resolve().parents[1] / "docs/payment-request-agent-policy.json"


def is_money(value):
    return type(value) is int and value >= 0


def evaluate_overrun(request, policy):
    """Propose accounting for an established purchase overrun; never pay it again."""
    result = {
        "request_id": request.get("request_id"), "policy_version": policy["version"],
        "decision": "STAFF_REVIEW", "checks": {}, "reasons": [],
        "pending_conditions": [], "proposed_funding": [], "evidence_refs": [],
        "external_actions_performed": False,
    }
    approved = request.get("approved_amount_minor")
    paid = request.get("actual_paid_amount_minor")
    if not is_money(approved) or not is_money(paid) or request.get("approved_amount_verified") is not True or request.get("actual_payment_verified") is not True or not request.get("actual_payment_evidence_ref"):
        result["decision"] = "NEEDS_EVIDENCE"
        result["reasons"].append("Overrun handling requires verified original amount and actual completed payment evidence.")
        return result
    extra = paid - approved
    if extra <= 0:
        result["decision"] = "RECONCILIATION_REVIEW"
        result["reasons"].append("No positive purchase overrun is established.")
        return result
    scope = request.get("overrun_budget_scope_id")
    candidates = [pool for pool in request.get("funding_pools", []) if pool.get("account_scope_id") == scope and pool.get("source") == "budget"]
    if not scope or len(candidates) != 1:
        result["reasons"].append("Establish the eligible Budget line for the purchase overrun.")
        return result
    budget = candidates[0]
    balance = budget.get("available_balance_minor")
    if type(balance) is not int or budget.get("balance_verified") is not True or not budget.get("snapshot_ref") or not budget.get("observed_at"):
        result["decision"] = "NEEDS_EVIDENCE"
        result["reasons"].append("Budget priority requires a verified current Budget balance, even if the eventual allocation is zero.")
        return result
    if budget.get("eligible_for_request") is not True or budget.get("currency") != request.get("currency"):
        result["reasons"].append("Verify the overrun Budget account's eligibility and currency.")
        return result
    budget_available = max(0, balance)
    selected = candidates
    allocations = [{"account_scope_id": scope, "amount_minor": extra}]
    if budget_available < extra:
        revenue_scope = request.get("overrun_revenue_scope_id")
        revenues = [pool for pool in request.get("funding_pools", []) if pool.get("account_scope_id") == revenue_scope and pool.get("source") == "revenue"]
        if not revenue_scope or len(revenues) != 1:
            result["decision"] = "NEEDS_EVIDENCE"
            result["reasons"].append("Budget is insufficient for the extra; establish the eligible Revenue account and its current balance.")
            return result
        selected += revenues
        allocations = [
            {"account_scope_id": scope, "amount_minor": budget_available},
            {"account_scope_id": revenue_scope, "amount_minor": extra - budget_available},
        ]
    normalized = {
        **request, "purpose": "purchase", "already_paid": False,
        "requested_amount_minor": extra, "funding_pools": selected,
        "submitted_allocations_verified": True,
        "submitted_funding_allocations": allocations,
    }
    result = evaluate(normalized, policy)
    result["overrun_minor"] = extra
    result["evidence_refs"].append(request["actual_payment_evidence_ref"])
    if result["decision"] == "PURCHASE_INITIAL_GATE_PASS":
        result["decision"] = "OVERRUN_FUNDING_PROPOSAL"
        result["reasons"] = ["Propose allocating the already-paid purchase overrun to Budget first, then eligible Revenue for any remainder. This is accounting reconciliation, not a new charge."]
    elif result["decision"] == "FUNDING_HOLD":
        result["decision"] = "STAFF_REVIEW"
        result["reasons"] = ["Budget and Revenue cannot cover the already-paid overrun; staff reconciliation is required."]
    return result


def evaluate(request, policy):
    if request.get("purpose") == "purchase_overrun":
        return evaluate_overrun(request, policy)
    result = {
        "request_id": request.get("request_id"),
        "policy_version": policy["version"],
        "decision": None,
        "checks": {},
        "reasons": [],
        "pending_conditions": [],
        "proposed_funding": [],
        "evidence_refs": [],
        "external_actions_performed": False,
    }

    def finish(decision, reason):
        result["decision"] = decision
        result["reasons"].append(reason)
        return result

    purpose = request.get("purpose")
    if purpose == "reconciliation" or request.get("already_paid") is True:
        return finish("RECONCILIATION_REVIEW", "Already-paid items need reconciliation, not a new purchase.")
    if purpose == "transfer":
        return finish("TRANSFER_REVIEW", "Internal transfers use a separate rule set.")
    if purpose not in ("purchase", "reimbursement") or request.get("purpose_verified") is not True:
        return finish("STAFF_REVIEW", "Request purpose or payment state is unresolved.")
    amount = request.get("requested_amount_minor")
    if not request.get("request_id") or not is_money(amount) or amount == 0:
        return finish("STAFF_REVIEW", "A stable request ID and positive integer monetary amount are required.")
    if request.get("currency") != policy["money"]["currency"] or request.get("money_semantics_verified") is not True:
        return finish("STAFF_REVIEW", "Currency and signed source amount semantics need verification.")

    if purpose == "reimbursement":
        submitter = request.get("submitter_id")
        recipient = request.get("reimbursement_recipient_id")
        if not submitter or not recipient or request.get("parties_verified") is not True:
            return finish("NEEDS_EVIDENCE", "Verified submitter and reimbursement recipient identities are required.")
        result["checks"]["different_submitter_and_recipient"] = submitter != recipient
        if submitter == recipient:
            return finish("STAFF_REVIEW", "The reimbursement recipient cannot submit their own request.")
        try:
            submitted = date.fromisoformat(request.get("submitted_date", ""))
        except (ValueError, TypeError):
            return finish("NEEDS_EVIDENCE", "A verified submission calendar date is required.")
        if request.get("submitted_date_verified") is not True:
            return finish("NEEDS_EVIDENCE", "Submission date needs source verification.")
        receipts = request.get("receipts")
        if not isinstance(receipts, list) or not receipts:
            return finish("NEEDS_EVIDENCE", "Readable itemized receipt evidence is missing.")
        seen = set()
        eligible_total = 0
        food_present = False
        for receipt in receipts:
            identity = receipt.get("receipt_id")
            if not identity or identity in seen or receipt.get("unique_verified") is not True:
                return finish("STAFF_REVIEW", "Receipt identity or duplicate status needs verification.")
            seen.add(identity)
            tags = receipt.get("expense_tags")
            if not isinstance(tags, list) or receipt.get("category_classification_verified") is not True:
                return finish("STAFF_REVIEW", "Verify receipt line-item categories; one submitted category is insufficient.")
            manual_tags = set(tags) & set(policy["confirmed_rules"]["reimbursement_manual_categories"])
            if manual_tags:
                return finish("STAFF_REVIEW", "Mandatory manual reimbursement category: " + ", ".join(sorted(manual_tags)) + ".")
            food_present = food_present or "food" in tags
            if receipt.get("readable") is not True or receipt.get("itemized") is not True or receipt.get("purchase_date_present") is not True:
                return finish("NEEDS_EVIDENCE", "Each receipt must be readable, itemized, and include its purchase date.")
            if receipt.get("paid_confirmation_verified") is not True or receipt.get("credit_card_last_four_present_verified") is not True:
                return finish("NEEDS_EVIDENCE", "Each receipt must establish payment and show the credit card's last four digits.")
            try:
                purchased = date.fromisoformat(receipt.get("purchase_date", ""))
            except (ValueError, TypeError):
                return finish("NEEDS_EVIDENCE", "Each receipt needs a verified purchase calendar date.")
            if receipt.get("purchase_date_verified") is not True:
                return finish("NEEDS_EVIDENCE", "Purchase date extraction requires verification.")
            age = (submitted - purchased).days
            if not 0 <= age <= policy["confirmed_rules"]["reimbursement_submission_window_days"]:
                return finish("STAFF_REVIEW", "A receipt is outside the 60-day submission window or has a contradictory future purchase date.")
            if receipt.get("currency") != request["currency"]:
                return finish("STAFF_REVIEW", "Receipt and request currencies must match; no inferred exchange rate.")
            total = receipt.get("final_total_minor")
            excluded = receipt.get("ineligible_total_minor")
            if not is_money(total) or not is_money(excluded) or excluded > total:
                return finish("STAFF_REVIEW", "Receipt totals and exclusions are invalid or missing.")
            if receipt.get("totals_verified") is not True or receipt.get("exclusions_verified") is not True:
                return finish("STAFF_REVIEW", "Receipt arithmetic and ineligible amounts require verified evidence.")
            if set(tags) & set(policy["confirmed_rules"]["reimbursement_prohibited_examples"]) and receipt.get("ineligible_items_fully_excluded") is not True:
                return finish("STAFF_REVIEW", "Flowers or ammunition must be excluded from reimbursement.")
            refs = receipt.get("evidence_refs")
            if not isinstance(refs, list) or not refs:
                return finish("NEEDS_EVIDENCE", "Receipt fields need traceable evidence references.")
            result["evidence_refs"].extend(refs)
            eligible_total += total - excluded
        result["checks"]["receipt_completeness_payment_and_dates"] = True
        if food_present:
            event = request.get("food_event_evidence", {})
            if event.get("type") not in ("flyer", "attendee_list") or event.get("verified") is not True or not event.get("evidence_ref"):
                return finish("NEEDS_EVIDENCE", "Food reimbursement requires a verified event flyer or attendee list.")
            result["evidence_refs"].append(event["evidence_ref"])
        result["checks"]["food_event_evidence"] = True
        result["eligible_total_minor"] = eligible_total
        result["difference_minor"] = amount - eligible_total
        result["checks"]["amount_match"] = amount == eligible_total
        if amount != eligible_total:
            return finish("STAFF_REVIEW", "Requested reimbursement differs from the eligible receipt total; zero tolerance.")
        rules = policy["confirmed_rules"]
        in_range = rules["reimbursement_lower_bound_minor_exclusive"] < eligible_total < rules["reimbursement_upper_bound_minor_exclusive"]
        result["checks"]["amount_range"] = in_range
        if not in_range:
            return finish("STAFF_REVIEW", "Eligible reimbursement must be strictly greater than $25 and strictly less than $500; exceptions need a defined review process.")

    pools = request.get("funding_pools")
    if not isinstance(pools, list) or not pools:
        return finish("NEEDS_EVIDENCE", "Available funding has no verified source.")
    allocations = request.get("submitted_funding_allocations")
    if not isinstance(allocations, list) or not allocations or request.get("submitted_allocations_verified") is not True:
        return finish("NEEDS_EVIDENCE", "The submitted funding allocation must be established before funding review.")
    by_scope = {}
    for pool in pools:
        identity = pool.get("account_scope_id")
        if not identity or identity in by_scope:
            return finish("STAFF_REVIEW", "Funding scopes are missing or duplicated; do not double-count balances.")
        by_scope[identity] = pool
    selected = []
    used = set()
    for allocation in allocations:
        identity = allocation.get("account_scope_id")
        allocated = allocation.get("amount_minor")
        if not identity or identity in used or not is_money(allocated):
            return finish("STAFF_REVIEW", "Submitted funding components are invalid or duplicated.")
        used.add(identity)
        if allocated == 0:
            continue
        if identity not in by_scope:
            return finish("NEEDS_EVIDENCE", "A submitted funding scope has no balance evidence.")
        selected.append((by_scope[identity], allocated))
    if sum(allocated for _, allocated in selected) != amount:
        return finish("STAFF_REVIEW", "Submitted funding components do not sum exactly to the request.")
    for pool, allocated in selected:
        if pool.get("source") not in ("budget", "revenue") or pool.get("currency") != request["currency"]:
            return finish("STAFF_REVIEW", "Funding source or currency is unresolved.")
        if pool.get("eligible_for_request") is not True:
            return finish("STAFF_REVIEW", "An eligible account or specific budget line must be established.")
        if type(pool.get("available_balance_minor")) is not int or pool.get("balance_verified") is not True or not pool.get("snapshot_ref") or not pool.get("observed_at"):
            return finish("NEEDS_EVIDENCE", "Funding needs a verified balance snapshot and observation time.")
        result["evidence_refs"].append(pool["snapshot_ref"])

    if sum(pool["source"] == "budget" for pool, _ in selected) > 1 or sum(pool["source"] == "revenue" for pool, _ in selected) > 1:
        return finish("STAFF_REVIEW", "Combining multiple budget lines or revenue accounts is not defined.")
    shortfalls = [
        {"account_scope_id": pool["account_scope_id"], "shortfall_minor": allocated - pool["available_balance_minor"]}
        for pool, allocated in selected if pool["available_balance_minor"] < allocated
    ]
    if shortfalls:
        result["checks"]["funding_sufficient"] = False
        result["allocation_shortfalls"] = shortfalls
        if sum(max(0, pool["available_balance_minor"]) for pool, _ in selected) < amount:
            return finish("FUNDING_HOLD", "Verified eligible submitted funding cannot cover the amount.")
        result["pending_conditions"].append("initial_allocation_shortfall_exception_process")
        return finish("STAFF_REVIEW", "Combined balances may suffice, but the submitted split has a shortfall. Do not automatically reallocate before payment.")
    result["checks"]["funding_sufficient"] = True
    result["proposed_funding"] = [
        {"account_scope_id": pool["account_scope_id"], "source": pool["source"], "amount_minor": allocated}
        for pool, allocated in selected if allocated
    ]
    if purpose == "purchase":
        return finish("PURCHASE_INITIAL_GATE_PASS", "Verified available funding covers the request. Evidence and category checks do not block this initial business gate.")

    return finish("REIMBURSEMENT_READY_FOR_STAFF_REVIEW", "Verified receipt, payment, date, identity, event, amount and funding checks passed. Eligibility and exclusions use verified facts, not an inferred exhaustive category policy. This is not final approval or payment.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Normalized request JSON, with verified facts only")
    parser.add_argument("--policy", type=Path, default=POLICY_PATH)
    args = parser.parse_args()
    try:
        policy = json.loads(args.policy.read_text())
        request = json.loads(args.input.read_text())
        result = evaluate(request, policy)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        parser.error(f"Invalid input or policy: {exc}")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
