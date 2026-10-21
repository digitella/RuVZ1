"""JWT auth + RBAC. Roles: student / editor / admin."""
import hashlib, hmac, os, time
import jwt
from fastapi import Depends, HTTPException, Header

SECRET = os.environ.get("SECRET_KEY", "dev-secret-change-me")
ALGO = "HS256"

def hash_password(pw: str) -> str:
    return hmac.new(SECRET.encode(), pw.encode(), hashlib.sha256).hexdigest()

def make_token(user: dict) -> str:
    payload = {"sub": user["id"], "role": user["role"], "email": user["email"],
               "exp": int(time.time()) + 7 * 86400}
    return jwt.encode(payload, SECRET, algorithm=ALGO)

def current_user(authorization: str = Header(default="")) -> dict:
    from . import db
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    try:
        payload = jwt.decode(authorization[7:], SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    u = db.one("SELECT * FROM users WHERE id=?", (payload["sub"],))
    if not u:
        raise HTTPException(401, "Unknown user")
    return u

def require_roles(*roles):
    def dep(u=Depends(current_user)):
        if u["role"] not in roles:
            raise HTTPException(403, "Insufficient role")
        return u
    return dep

editor_or_admin = require_roles("editor", "admin")
