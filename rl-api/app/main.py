"""Russian Launchpad FastAPI backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import db
from .routers import auth_router, access, payments_router, crm, comments, practice, telegram_router, xapi_proxy, cmi5_proxy

db.init()
app = FastAPI(title="Russian Launchpad API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_headers=["*"], allow_methods=["*"])

app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(access.router, tags=["access"])          # /access, /course/data
app.include_router(payments_router.router, prefix="/payments", tags=["payments"])
app.include_router(crm.router, prefix="/crm", tags=["crm"])
app.include_router(comments.router, prefix="/comments", tags=["comments"])
app.include_router(practice.router, prefix="/practice", tags=["practice"])
app.include_router(telegram_router.router, prefix="/telegram", tags=["telegram"])
app.include_router(xapi_proxy.router, prefix="/xapi", tags=["xapi"])
app.include_router(cmi5_proxy.router, prefix="/cmi5", tags=["cmi5"])

@app.get("/health")
def health():
    return {"ok": True}
