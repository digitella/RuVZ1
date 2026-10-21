from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid, time
from .. import db
from fastapi import Depends
from ..auth import hash_password, make_token, current_user

router = APIRouter()

class LoginIn(BaseModel):
    email: str
    password: str

class RegIn(LoginIn):
    name: str = ""

@router.post("/login")
def login(b: LoginIn):
    u = db.one("SELECT * FROM users WHERE email=?", (b.email,))
    if not u or u["pass_hash"] != hash_password(b.password):
        raise HTTPException(401, "Invalid credentials")
    return {"access_token": make_token(u), "token_type": "bearer",
            "user": {k: u[k] for k in ("id", "email", "name", "role")}}

@router.post("/register")
def register(b: RegIn):
    if db.one("SELECT 1 FROM users WHERE email=?", (b.email,)):
        raise HTTPException(409, "Email exists")
    uid = str(uuid.uuid4()); now = int(time.time() * 1000)
    db.run("INSERT INTO users VALUES(?,?,?,?,?,?,?)",
           (uid, b.email, b.name or "New learner", "student", hash_password(b.password), None, now))
    db.run("INSERT INTO crm_contacts VALUES(?,?,?,?,?,?,?)",
           (str(uuid.uuid4()), b.email, "web_register", "new", "", None, now))
    u = db.one("SELECT * FROM users WHERE id=?", (uid,))
    return {"access_token": make_token(u), "token_type": "bearer",
            "user": {k: u[k] for k in ("id", "email", "name", "role")}}

@router.get("/me")
def me(u=Depends(current_user)):
    return {k: u[k] for k in ("id", "email", "name", "role")}
