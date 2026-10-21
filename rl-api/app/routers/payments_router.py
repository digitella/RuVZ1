"""Payments: checkout, dev activation (ALLOW_DEV_ACTIVATION), webhooks, renew, cancel."""
import uuid, time
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from .. import db
from ..auth import current_user
from ..payments import get_provider, allow_dev_activation, activate, PLANS

router = APIRouter()

class CheckoutIn(BaseModel):
    plan: str
    provider: str = "mock"
    autoRenew: bool = False

@router.post("/checkout")
def checkout(b: CheckoutIn, u=Depends(current_user)):
    if b.plan not in PLANS: raise HTTPException(400, "Unknown plan")
    prov = get_provider(b.provider)
    res = prov.create_checkout(u["id"], b.plan, b.autoRenew)
    db.run("INSERT INTO payments VALUES(?,?,?,?,?,?)",
           (res["paymentId"], u["id"], b.plan, prov.name, res["status"], int(time.time() * 1000)))
    return res

class DevActivateIn(BaseModel):
    paymentId: str

@router.post("/dev-activate")   # ONLY works when ALLOW_DEV_ACTIVATION=true
def dev_activate(b: DevActivateIn, u=Depends(current_user)):
    if not allow_dev_activation():
        raise HTTPException(403, "Dev activation disabled (set ALLOW_DEV_ACTIVATION=true in dev)")
    pay = db.one("SELECT * FROM payments WHERE id=?", (b.paymentId,))
    if not pay: raise HTTPException(404, "Unknown payment")
    sub = activate(pay["user_id"], pay["plan"], pay["provider"], True)
    return sub

@router.post("/webhook/{provider}")
async def webhook(provider: str, req: Request):
    prov = get_provider(provider)
    payload = await req.json()
    pid = prov.verify_webhook(payload, dict(req.headers))
    if not pid: raise HTTPException(400, "Not confirmed")
    pay = db.one("SELECT * FROM payments WHERE id=?", (pid,))
    if pay:
        activate(pay["user_id"], pay["plan"], provider, True)
    return {"ok": True}

@router.post("/renew")
def renew(u=Depends(current_user)):
    sub = db.one("SELECT * FROM subscriptions WHERE user_id=? AND status='active'", (u["id"],))
    if not sub: raise HTTPException(400, "No subscription")
    return activate(u["id"], sub["plan"], sub["provider"], bool(sub["auto_renew"]))

@router.post("/cancel")
def cancel(u=Depends(current_user)):
    sub = db.one("SELECT * FROM subscriptions WHERE user_id=? AND status='active'", (u["id"],))
    if not sub: raise HTTPException(400, "No subscription")
    db.run("UPDATE subscriptions SET status='canceled', auto_renew=0 WHERE id=?", (sub["id"],))
    return {"status": "canceled"}
