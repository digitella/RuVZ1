"""Access & course data."""
import os, json
from fastapi import APIRouter, Depends
from .. import db
from ..auth import current_user

router = APIRouter()

@router.get("/access")
def access(u=Depends(current_user)):
    sub = db.one("SELECT * FROM subscriptions WHERE user_id=? AND status IN ('active','trial') ORDER BY expires_at DESC", (u["id"],))
    import time
    now = int(time.time() * 1000)
    active = bool(sub and (not sub["expires_at"] or sub["expires_at"] > now))
    return {"hasAccess": active or u["role"] != "student",
            "subscription": {k: sub[k] for k in ("plan", "status", "expires_at", "auto_renew")} if sub else None,
            "role": u["role"]}

@router.get("/course/data")
def course_data():
    path = os.environ.get("COURSE_JSON_PATH", "../rl-content/course.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)
