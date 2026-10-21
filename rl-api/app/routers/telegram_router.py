"""Telegram Mini App auth: HMAC verification of initData per BotFather token."""
import hashlib, hmac, json, os, time, uuid
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .. import db
from ..auth import make_token

router = APIRouter()

class TgAuthIn(BaseModel):
    initData: str = ""
    tgId: int | str = ""
    firstName: str = ""

def verify_init_data(init_data: str, bot_token: str) -> dict | None:
    """https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app"""
    if not init_data or not bot_token: return None
    pairs = dict(kv.split("=", 1) for kv in init_data.split("&") if "=" in kv)
    hash_got = pairs.pop("hash", None)
    if not hash_got: return None
    data_check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    hash_exp = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if hash_exp != hash_got: return None
    try:
        user = json.loads(pairs.get("user", "{}"))
        if time.time() - int(pairs.get("auth_date", 0)) > 86400: return None
        return user
    except Exception:
        return None

@router.post("/auth")
def auth(b: TgAuthIn):
    user = None
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if b.initData and token:
        user = verify_init_data(b.initData, token)
        if user is None: raise HTTPException(401, "Bad initData")
    else:
        # dev convenience when no bot token configured
        user = {"id": b.tgId, "first_name": b.firstName or "Learner"}
    tg_id = str(user["id"])
    row = db.one("SELECT * FROM users WHERE tg_id=?", (tg_id,))
    now = int(time.time() * 1000)
    if not row:
        uid = str(uuid.uuid4())
        db.run("INSERT INTO users VALUES(?,?,?,?,?,?,?)",
               (uid, f"tg-{tg_id}@telegram", user.get("first_name", "Learner"), "student", "", tg_id, now))
        db.run("INSERT INTO crm_contacts VALUES(?,?,?,?,?,?,?)",
               (str(uuid.uuid4()), f"tg:{tg_id}", "telegram_mini_app", "new", "", None, now))
        row = db.one("SELECT * FROM users WHERE id=?", (uid,))
    return {"access_token": make_token(row), "user": {k: row[k] for k in ("id", "email", "name", "role")}}
