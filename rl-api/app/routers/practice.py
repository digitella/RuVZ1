"""Practice attempts: quiz results, pronunciation recordings meta, speech-blank grades."""
import uuid, time, json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from .. import db
from ..auth import current_user

router = APIRouter()

@router.post("/attempt")
async def attempt(req: Request, u=Depends(current_user)):
    body = await req.json()
    aid = str(uuid.uuid4())
    db.run("INSERT INTO practice VALUES(?,?,?,?,?,?,?)",
           (aid, u["id"], body.get("kind"), body.get("targetId"), body.get("lessonId"),
            json.dumps(body), int(time.time() * 1000)))
    if body.get("kind") == "quiz" and body.get("lessonId"):
        pass  # progress aggregation hook
    return {"id": aid, **body}

@router.get("/attempts")
def attempts(kind: str = Query(None), targetId: str = Query(None), u=Depends(current_user)):
    sql, args = "SELECT * FROM practice WHERE 1=1", []
    if u["role"] == "student": sql += " AND user_id=?"; args.append(u["id"])
    if kind: sql += " AND kind=?"; args.append(kind)
    if targetId: sql += " AND target_id=?"; args.append(targetId)
    out = []
    for r in db.rows(sql + " ORDER BY ts DESC LIMIT 200", tuple(args)):
        out.append({**json.loads(r["payload"]), "id": r["id"], "ts": r["ts"]})
    return out

@router.delete("/attempt/{aid}")
def delete(aid: str, u=Depends(current_user)):
    r = db.one("SELECT * FROM practice WHERE id=?", (aid,))
    if not r: raise HTTPException(404, "Not found")
    if u["role"] == "student" and r["user_id"] != u["id"]: raise HTTPException(403, "Not yours")
    db.run("DELETE FROM practice WHERE id=?", (aid,))
    return {"deleted": True}
