"""Synthetic acceptance cases for office-confirmed decision boundaries."""

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("payment_decisions", ROOT / "scripts/evaluate_payment_request.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
POLICY = json.loads((ROOT / "docs/payment-request-agent-policy.json").read_text())


def pool(scope="budget-1", source="budget", balance=10000):
    return {
        "account_scope_id": scope, "source": source, "currency": "USD",
        "eligible_for_request": True, "available_balance_minor": balance,
        "balance_verified": True,
        "snapshot_ref": "synthetic-balance", "observed_at": "2026-09-26T12:00:00Z",
    }


def purchase(amount=10000, balance=10000):
    return {
        "request_id": "synthetic-request", "purpose": "purchase",
        "purpose_verified": True, "already_paid": False, "currency": "USD",
        "money_semantics_verified": True, "requested_amount_minor": amount,
        "submitted_allocations_verified": True,
        "submitted_funding_allocations": [{"account_scope_id": "budget-1", "amount_minor": amount}],
        "funding_pools": [pool(balance=balance)],
    }


def receipt(amount=10000, identity="receipt-1"):
    return {
        "receipt_id": identity, "unique_verified": True, "readable": True,
        "itemized": True, "purchase_date_present": True,
        "purchase_date": "2026-09-01", "purchase_date_verified": True,
        "paid_confirmation_verified": True, "credit_card_last_four_present_verified": True,
        "currency": "USD", "expense_tags": ["supplies"],
        "category_classification_verified": True, "final_total_minor": amount,
        "ineligible_total_minor": 0, "totals_verified": True,
        "exclusions_verified": True, "evidence_refs": ["synthetic-receipt-page"],
    }


def reimbursement(amount=10000):
    request = purchase(amount, max(amount, 10000))
    request.update({
        "purpose": "reimbursement", "submitter_id": "synthetic-officer",
        "reimbursement_recipient_id": "synthetic-recipient", "parties_verified": True,
        "submitted_date": "2026-09-26", "submitted_date_verified": True,
        "receipts": [receipt(amount)],
    })
    return request


class DecisionAcceptanceTests(unittest.TestCase):
    def decide(self, request):
        output = MODULE.evaluate(request, POLICY)
        self.assertFalse(output["external_actions_performed"])
        self.assertIn(output["decision"], POLICY["outputs"])
        return output

    def test_purchase_equal_balance_without_food_documents_passes(self):
        request = purchase()
        request["category"] = "Food"
        self.assertEqual(self.decide(request)["decision"], "PURCHASE_INITIAL_GATE_PASS")

    def test_purchase_one_cent_short_holds(self):
        self.assertEqual(self.decide(purchase(balance=9999))["decision"], "FUNDING_HOLD")

    def test_verified_negative_balance_cannot_fund_purchase(self):
        self.assertEqual(self.decide(purchase(balance=-100))["decision"], "FUNDING_HOLD")

    def test_missing_balance_never_passes(self):
        request = purchase()
        request["funding_pools"][0]["balance_verified"] = False
        self.assertEqual(self.decide(request)["decision"], "NEEDS_EVIDENCE")

    def test_pending_unpaid_requests_do_not_reduce_system_balance(self):
        request = purchase()
        request["pending_unpaid_request_amount_minor"] = 10000
        self.assertEqual(self.decide(request)["decision"], "PURCHASE_INITIAL_GATE_PASS")

    def test_original_split_preserved(self):
        request = purchase()
        request["funding_pools"] = [pool(balance=10000), pool("revenue-1", "revenue", 4000)]
        request["submitted_funding_allocations"] = [
            {"account_scope_id": "budget-1", "amount_minor": 6000},
            {"account_scope_id": "revenue-1", "amount_minor": 4000},
        ]
        result = self.decide(request)
        self.assertEqual(result["decision"], "PURCHASE_INITIAL_GATE_PASS")
        self.assertEqual([x["amount_minor"] for x in result["proposed_funding"]], [6000, 4000])

    def test_combined_funds_do_not_authorize_automatic_reallocation(self):
        request = purchase()
        request["funding_pools"] = [pool(balance=10000), pool("revenue-1", "revenue", 1000)]
        request["submitted_funding_allocations"] = [
            {"account_scope_id": "budget-1", "amount_minor": 6000},
            {"account_scope_id": "revenue-1", "amount_minor": 4000},
        ]
        result = self.decide(request)
        self.assertEqual(result["decision"], "STAFF_REVIEW")
        self.assertEqual(result["proposed_funding"], [])

    def test_unrelated_unused_unverified_account_does_not_block(self):
        request = purchase()
        unused = pool("revenue-1", "revenue")
        unused["balance_verified"] = False
        request["funding_pools"].append(unused)
        self.assertEqual(self.decide(request)["decision"], "PURCHASE_INITIAL_GATE_PASS")

    def test_receipts_sum_exactly(self):
        request = reimbursement()
        request["receipts"] = [receipt(4000, "one"), receipt(6000, "two")]
        self.assertEqual(self.decide(request)["decision"], "REIMBURSEMENT_READY_FOR_STAFF_REVIEW")

    def test_ineligible_amount_is_subtracted(self):
        request = reimbursement()
        request["receipts"][0].update({"final_total_minor": 11000, "ineligible_total_minor": 1000})
        result = self.decide(request)
        self.assertEqual(result["eligible_total_minor"], 10000)
        self.assertEqual(result["decision"], "REIMBURSEMENT_READY_FOR_STAFF_REVIEW")

    def test_all_incidental_charges_remain_after_ineligible_item_exclusion(self):
        request = reimbursement()
        request["receipts"][0].update({
            "final_total_minor": 12000, "ineligible_total_minor": 2000,
            "tax_minor": 500, "shipping_minor": 300, "tip_minor": 200,
        })
        result = self.decide(request)
        self.assertEqual(result["eligible_total_minor"], 10000)
        self.assertEqual(result["decision"], "REIMBURSEMENT_READY_FOR_STAFF_REVIEW")

    def test_one_cent_mismatch_routes_to_staff(self):
        request = reimbursement()
        request["receipts"][0]["final_total_minor"] = 9999
        result = self.decide(request)
        self.assertEqual(result["decision"], "STAFF_REVIEW")
        self.assertEqual(result["difference_minor"], 1)

    def test_open_amount_interval(self):
        for amount, expected in [(2500, "STAFF_REVIEW"), (2501, "REIMBURSEMENT_READY_FOR_STAFF_REVIEW"), (49999, "REIMBURSEMENT_READY_FOR_STAFF_REVIEW"), (50000, "STAFF_REVIEW")]:
            with self.subTest(amount=amount):
                self.assertEqual(self.decide(reimbursement(amount))["decision"], expected)

    def test_duplicate_receipts_never_aggregate(self):
        request = reimbursement()
        request["receipts"] = [receipt(5000), receipt(5000)]
        self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")

    def test_each_receipt_needs_payment_and_card_last_four(self):
        for field in ["paid_confirmation_verified", "credit_card_last_four_present_verified"]:
            request = reimbursement()
            request["receipts"] = [receipt(4000, "one"), receipt(6000, "two")]
            request["receipts"][1][field] = False
            with self.subTest(field=field):
                self.assertEqual(self.decide(request)["decision"], "NEEDS_EVIDENCE")

    def test_sixty_day_boundary_for_each_receipt(self):
        for submitted, expected in [("2026-10-31", "REIMBURSEMENT_READY_FOR_STAFF_REVIEW"), ("2026-11-01", "STAFF_REVIEW")]:
            request = reimbursement()
            request["submitted_date"] = submitted
            request["receipts"] = [receipt(4000, "one"), receipt(6000, "two")]
            request["receipts"][0]["purchase_date"] = "2026-10-01"
            with self.subTest(submitted=submitted):
                self.assertEqual(self.decide(request)["decision"], expected)

    def test_same_submitter_and_recipient_routes_to_staff(self):
        request = reimbursement()
        request["reimbursement_recipient_id"] = request["submitter_id"]
        self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")

    def test_food_requires_flyer_or_attendee_list(self):
        request = reimbursement()
        request["receipts"][0]["expense_tags"] = ["food"]
        self.assertEqual(self.decide(request)["decision"], "NEEDS_EVIDENCE")
        for kind in ["flyer", "attendee_list"]:
            request["food_event_evidence"] = {"type": kind, "verified": True, "evidence_ref": "synthetic-event"}
            self.assertEqual(self.decide(request)["decision"], "REIMBURSEMENT_READY_FOR_STAFF_REVIEW")

    def test_manual_travel_categories(self):
        for category in POLICY["confirmed_rules"]["reimbursement_manual_categories"]:
            request = reimbursement()
            request["receipts"][0]["expense_tags"] = [category]
            self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")

    def test_prohibited_items_must_be_fully_excluded(self):
        request = reimbursement()
        request["receipts"][0].update({"expense_tags": ["supplies", "flowers"], "final_total_minor": 11000, "ineligible_total_minor": 1000})
        self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")
        request["receipts"][0]["ineligible_items_fully_excluded"] = True
        self.assertEqual(self.decide(request)["decision"], "REIMBURSEMENT_READY_FOR_STAFF_REVIEW")

    def test_no_float_money_or_currency_conversion(self):
        for field, value in [("requested_amount_minor", 10000.0), ("currency", "EUR")]:
            request = purchase()
            request[field] = value
            self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")

    def test_already_paid_routes_to_reconciliation(self):
        request = purchase()
        request["already_paid"] = True
        self.assertEqual(self.decide(request)["decision"], "RECONCILIATION_REVIEW")

    def test_post_purchase_overrun_uses_extra_only(self):
        request = purchase()
        request.update({"purpose": "purchase_overrun", "already_paid": True, "approved_amount_minor": 10000, "approved_amount_verified": True, "actual_paid_amount_minor": 11000, "actual_payment_verified": True, "actual_payment_evidence_ref": "synthetic-paid", "overrun_budget_scope_id": "budget-1"})
        result = self.decide(request)
        self.assertEqual(result["decision"], "OVERRUN_FUNDING_PROPOSAL")
        self.assertEqual(result["proposed_funding"][0]["amount_minor"], 1000)
        request["funding_pools"][0]["available_balance_minor"] = 999
        request["overrun_revenue_scope_id"] = "revenue-1"
        request["funding_pools"].append(pool("revenue-1", "revenue", 1))
        result = self.decide(request)
        self.assertEqual(result["decision"], "OVERRUN_FUNDING_PROPOSAL")
        self.assertEqual([x["amount_minor"] for x in result["proposed_funding"]], [999, 1])
        request["funding_pools"][1]["available_balance_minor"] = 0
        self.assertEqual(self.decide(request)["decision"], "STAFF_REVIEW")

    def test_overrun_zero_budget_still_requires_verified_budget_balance(self):
        request = purchase()
        request.update({"purpose": "purchase_overrun", "approved_amount_minor": 10000, "approved_amount_verified": True, "actual_paid_amount_minor": 11000, "actual_payment_verified": True, "actual_payment_evidence_ref": "synthetic-paid", "overrun_budget_scope_id": "budget-1", "overrun_revenue_scope_id": "revenue-1"})
        request["funding_pools"] = [pool(balance=0), pool("revenue-1", "revenue", 1000)]
        request["funding_pools"][0]["balance_verified"] = False
        self.assertEqual(self.decide(request)["decision"], "NEEDS_EVIDENCE")
        request["funding_pools"][0]["balance_verified"] = True
        result = self.decide(request)
        self.assertEqual(result["decision"], "OVERRUN_FUNDING_PROPOSAL")
        self.assertEqual(result["proposed_funding"], [{"account_scope_id": "revenue-1", "source": "revenue", "amount_minor": 1000}])


if __name__ == "__main__":
    unittest.main()
