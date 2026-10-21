"""xAPI LRS proxy: forwards statements to a configured LRS, logs locally.
If no LRS is configured, acts as a minimal local statement store (GET/POST)."""
import os, json, uuid, time, base64
from fastapi import APIRouter, Depends, Request, HTTPException
from .. import db
from ..auth import current_user

router = APIRouter()
LRS = os.environ.get("XAPI_LRS_ENDPOINT", "")
KEY = os.environ.get("XAPI_LRS_KEY", "")
SECRET = os.environ.get("XAPI_LRS_SECRET", "")

@router.post("/statements")
async def post_statements(req: Request, u=Depends(current_user)):
    stmts = await req.json()
    if isinstance(stmts, dict): stmts = [stmts]
    ids = []
    for s in stmts:
        sid = s.get("id") or str(uuid.uuid4())
        db.run("INSERT OR REPLACE INTO xapi_log VALUES(?,?,?)", (sid, json.dumps(s), int(time.time() * 1000)))
        ids.append({"id": sid})
    if LRS and KEY:
        try:  # best-effort forward; local log already succeeded
            import httpx
            auth = base64.b64encode(f"{KEY}:{SECRET}".encode()).decode()
            httpx.post(LRS.rstrip("/") + "/statements", json=stmts,
                       headers={"Authorization": f"Basic {auth}", "X-Experience-API-Version": "1.0.3"}, timeout=5)
        except Exception as e:
            return {"stored": ids, "forwarded": False, "warning": str(e)}
    return {"stored": ids, "forwarded": bool(LRS and KEY)}

@router.get("/statements")
def get_statements(registration: str = None, u=Depends(current_user)):
    rows = db.rows("SELECT statement FROM xapi_log ORDER BY stored DESC LIMIT 200")
    out = [json.loads(r["statement"]) for r in rows]
    if registration:
        out = [s for s in out if (s.get("context") or {}).get("registration") == registration]
    if u["role"] == "student":
        out = [s for s in out if (s.get("actor") or {}).get("account", {}).get("name") in (u["email"], u["id"])]
    return {"statements": out}
