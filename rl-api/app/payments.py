"""Payment provider abstraction: mock | stripe | yookassa (stubs).

Dev activation endpoint is only enabled when ALLOW_DEV_ACTIVATION=true.
The production example (.env.example) sets it to false.
"""
import os, time, uuid

PLANS = {"six_months": 180, "one_year": 365}  # days

class Provider:
    name = "base"
    def create_checkout(self, user_id: str, plan: str, auto_renew: bool):
        raise NotImplementedError
    def verify_webhook(self, payload: dict, headers: dict) -> str | None:
        """Return payment_id if the webhook confirms a paid order."""
        raise NotImplementedError

class MockProvider(Provider):
    name = "mock"
    def create_checkout(self, user_id, plan, auto_renew):
        pid = "pay_mock_" + uuid.uuid4().hex[:12]
        return {"paymentId": pid, "status": "requires_confirmation", "confirmUrl": None}
    def verify_webhook(self, payload, headers):
        return payload.get("paymentId")

class StripeProvider(Provider):
    name = "stripe"
    def create_checkout(self, user_id, plan, auto_renew):
        key = os.environ.get("STRIPE_SECRET_KEY")
        if not key:
            # Stub: real implementation would call https://api.stripe.com/v1/checkout/sessions
            return {"paymentId": "pay_stripe_" + uuid.uuid4().hex[:12], "status": "stub_not_configured",
                    "confirmUrl": None, "note": "Set STRIPE_SECRET_KEY and implement Checkout Sessions API"}
        raise NotImplementedError("Wire Stripe SDK here (checkout.sessions.create)")
    def verify_webhook(self, payload, headers):
        # Verify signature with STRIPE_WEBHOOK_SECRET; map checkout.session.completed -> payment id
        return payload.get("id")

class YooKassaProvider(Provider):
    name = "yookassa"
    def create_checkout(self, user_id, plan, auto_renew):
        shop = os.environ.get("YOOKASSA_SHOP_ID")
        if not shop:
            return {"paymentId": "pay_yk_" + uuid.uuid4().hex[:12], "status": "stub_not_configured",
                    "confirmUrl": None, "note": "Set YOOKASSA_SHOP_ID/SECRET_KEY; create confirmation_url via API"}
        raise NotImplementedError("Call YooKassa API: POST /payments (return confirmation_url)")
    def verify_webhook(self, payload, headers):
        if payload.get("event") == "payment.succeeded":
            return payload.get("object", {}).get("id")
        return None

PROVIDERS = {p.name: p() for p in (MockProvider, StripeProvider, YooKassaProvider)}

def get_provider(name: str) -> Provider:
    return PROVIDERS.get(name or "mock", PROVIDERS["mock"])

def allow_dev_activation() -> bool:
    return os.environ.get("ALLOW_DEV_ACTIVATION", "false").lower() == "true"

def activate(user_id: str, plan: str, provider: str, auto_renew: bool):
    """Mark subscription active. Shared by webhooks and dev activation."""
    from . import db
    days = PLANS[plan]
    now = int(time.time() * 1000)
    prev = db.one("SELECT * FROM subscriptions WHERE user_id=? AND status='active'", (user_id,))
    base = max(prev["expires_at"], now) if prev and prev["plan"] == plan else now
    if prev:
        db.run("UPDATE subscriptions SET status='active', expires_at=?, auto_renew=?, provider=? WHERE id=?",
               (base + days * 86400000, 1 if auto_renew else 0, provider, prev["id"]))
        sub = db.one("SELECT * FROM subscriptions WHERE id=?", (prev["id"],))
    else:
        sid = str(uuid.uuid4())
        db.run("INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)",
               (sid, user_id, plan, "active", base + days * 86400000, 1 if auto_renew else 0, provider))
        sub = db.one("SELECT * FROM subscriptions WHERE id=?", (sid,))
    db.run("UPDATE payments SET status='paid' WHERE user_id=? AND plan=?", (user_id, plan))
    return sub
