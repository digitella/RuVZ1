"""cmi5 helpers: issue launch parameters (for your own LMS/dev testing) and
validate cmi5-required statement context (category + parent + registration)."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..auth import editor_or_admin

router = APIRouter()
ACTIVITY_ID = "https://russianlaunchpad.example/course/a1a2"

class LaunchIn(BaseModel):
    learnerId: str

@router.post("/launch")
def make_launch(b: LaunchIn, staff=Depends(editor_or_admin)):
    reg = str(uuid.uuid4())
    return {
        "launchUrl": f"../rl-cmi5/dist/index.html?launch_path=index.html&activity_id={ACTIVITY_ID}"
                     f"&registration_id={reg}&learner_id={b.learnerId}&lrs_endpoint=&auth_token=mock",
        "registration": reg,
        "moveOn": "PassedReported",
        "note": "Real LMS supplies signed lrs_endpoint/auth_token. This endpoint helps dev/testing."
    }

@router.post("/validate")
def validate(stmt: dict, staff=Depends(editor_or_admin)):
    ctx = stmt.get("context") or {}
    errs = []
    if not ctx.get("registration"): errs.append("missing context.registration")
    cat = ((ctx.get("contextActivities") or {}).get("category") or [])
    if not any("cmi5_spec.md" in (c.get("id") or "") for c in cat):
        errs.append("missing cmi5 category id")
    obj = stmt.get("object") or {}
    verb = (stmt.get("verb") or {}).get("id", "")
    if verb.endswith(("launched", "completed", "mastered", "failed", "terminated")) and obj.get("id") != ACTIVITY_ID:
        errs.append("top-level scenario object must be the Assignable Unit activity")
    return {"valid": not errs, "errors": errs}
