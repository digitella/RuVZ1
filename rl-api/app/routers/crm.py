"""CRM: contacts with source/status/notes/assigned_to."""
import uuid, time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from .. import db
from ..auth import editor_or_admin

router = APIRouter(dependencies=[Depends(editor_or_admin)])
SOURCES = ["web_register", "telegram_mini_app", "manual", "stripe_checkout", "landing_form"]
STATUSES = ["new", "contacted", "interested", "trial", "paid", "churned", "spam"]

class ContactIn(BaseModel):
    contact: str
    source: str = "manual"
    status: str = "new"
    notes: str = ""
    assigned_to: Optional[str] = None

class ContactPatch(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    source: Optional[str] = None

@router.get("/contacts")
def list_contacts():
    return db.rows("SELECT * FROM crm_contacts ORDER BY created_at DESC")

@router.post("/contacts")
def create(b: ContactIn):
    if b.source not in SOURCES: raise HTTPException(400, "Bad source")
    cid = str(uuid.uuid4())
    db.run("INSERT INTO crm_contacts VALUES(?,?,?,?,?,?,?)",
           (cid, b.contact, b.source, b.status, b.notes, b.assigned_to, int(time.time() * 1000)))
    return db.one("SELECT * FROM crm_contacts WHERE id=?", (cid,))

@router.patch("/contacts/{cid}")
def patch(cid: str, b: ContactPatch):
    cur = db.one("SELECT * FROM crm_contacts WHERE id=?", (cid,))
    if not cur: raise HTTPException(404, "Not found")
    fields = {k: v for k, v in b.dict().items() if v is not None}
    if "status" in fields and fields["status"] not in STATUSES: raise HTTPException(400, "Bad status")
    sets = ", ".join(f"{k}=?" for k in fields)
    db.run(f"UPDATE crm_contacts SET {sets} WHERE id=?", (*fields.values(), cid))
    return db.one("SELECT * FROM crm_contacts WHERE id=?", (cid,))
