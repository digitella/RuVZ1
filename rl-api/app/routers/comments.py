"""Comments: lesson/exercise/quiz_question/pronunciation_phrase targets.
Students default to private_instructor; public requires course config + staff."""
import uuid, time
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from .. import db
from ..auth import current_user, editor_or_admin

router = APIRouter()
TARGETS = ["lesson", "exercise", "quiz_question", "pronunciation_phrase"]

class CommentIn(BaseModel):
    targetType: str
    targetId: str
    body: str
    visibility: str = "private_instructor"
    replyTo: Optional[str] = None

@router.get("")
def list_comments(targetType: str = Query(None), targetId: str = Query(None), u=Depends(current_user)):
    sql, args = "SELECT * FROM comments WHERE 1=1", []
    if targetType: sql += " AND target_type=?"; args.append(targetType)
    if targetId: sql += " AND target_id=?"; args.append(targetId)
    rows = db.rows(sql + " ORDER BY created_at DESC", tuple(args))
    if u["role"] == "student":
        rows = [r for r in rows if r["author_id"] == u["id"] or (r["visibility"] == "public")]
        rows = [{**r, "internal_note": None} for r in rows]
    return rows

@router.post("")
def create(b: CommentIn, u=Depends(current_user)):
    if b.targetType not in TARGETS: raise HTTPException(400, "Bad target type")
    vis = b.visibility
    if u["role"] == "student": vis = "private_instructor"   # public disabled by default policy
    cid = str(uuid.uuid4())
    db.run("INSERT INTO comments VALUES(?,?,?,?,?,?,?,?,?,?,?)",
           (cid, b.targetType, b.targetId, u["id"], u["role"], b.body, vis, b.replyTo, 0, None, int(time.time() * 1000)))
    return db.one("SELECT * FROM comments WHERE id=?", (cid,))

class PatchIn(BaseModel):
    resolved: Optional[bool] = None
    internalNote: Optional[str] = None
    visibility: Optional[str] = None

@router.patch("/{cid}")
def patch(cid: str, b: PatchIn, u=Depends(editor_or_admin)):
    cur = db.one("SELECT * FROM comments WHERE id=?", (cid,))
    if not cur: raise HTTPException(404, "Not found")
    fields = {}
    if b.resolved is not None: fields["resolved"] = 1 if b.resolved else 0
    if b.internalNote is not None: fields["internal_note"] = b.internalNote
    if b.visibility is not None: fields["visibility"] = b.visibility
    sets = ", ".join(f"{k}=?" for k in fields)
    if sets: db.run(f"UPDATE comments SET {sets} WHERE id=?", (*fields.values(), cid))
    return db.one("SELECT * FROM comments WHERE id=?", (cid,))
