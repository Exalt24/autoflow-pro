"""Stand-ins for the two outside systems the saga calls: a payment provider and a carrier.

They are programmable so a test can make a call fail, time out once or decline a customer, and they keep the one
property a real provider gives a retrying caller: the same idempotency key never charges or ships twice.
"""
from __future__ import annotations


class TransientError(Exception):
    """A failure worth retrying (a timeout, a 5xx)."""


class PaymentDeclined(Exception):
    pass


class CarrierRejected(Exception):
    pass


class FakePaymentProvider:
    def __init__(self) -> None:
        self.charges: dict[str, int] = {}  # idempotency key -> amount
        self.refunds: set[str] = set()
        self.declined_customers: set[str] = set()
        self.fail_next: int = 0  # transient failures to raise before charging works
        self.calls = 0

    def charge(self, key: str, customer_id: str, amount_cents: int) -> str:
        self.calls += 1
        if self.fail_next > 0:
            self.fail_next -= 1
            raise TransientError("payment provider timed out")
        if customer_id in self.declined_customers:
            raise PaymentDeclined(customer_id)
        self.charges.setdefault(key, amount_cents)  # same key, same charge
        return f"pay_{key}"

    def refund(self, key: str) -> bool:
        if key not in self.charges or key in self.refunds:
            return False
        self.refunds.add(key)
        return True


class FakeCarrier:
    def __init__(self) -> None:
        self.shipments: dict[str, str] = {}  # idempotency key -> tracking id
        self.cancelled: set[str] = set()
        self.reject_next: bool = False
        self.fail_next: int = 0

    def ship(self, key: str) -> str:
        if self.fail_next > 0:
            self.fail_next -= 1
            raise TransientError("carrier unavailable")
        if self.reject_next:
            raise CarrierRejected(key)
        return self.shipments.setdefault(key, f"trk_{key}")

    def cancel(self, key: str) -> bool:
        if key not in self.shipments or key in self.cancelled:
            return False
        self.cancelled.add(key)
        return True
