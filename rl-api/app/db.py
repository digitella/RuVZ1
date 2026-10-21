"""SQLite persistence layer (stdlib only — no SQLAlchemy dependency)."""
import json, os, sqlite3, time, uuid

DB_PATH = os.environ.get("RL_DB", "rl.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT CHECK(role IN ('student','editor','admin')),
  pass_hash TEXT, tg_id TEXT, createdAt INTEGER);
CREATE TABLE IF NOT EXISTS subscriptions(
  id TEXT PRIMARY KEY, user_id TEXT, plan TEXT CHECK(plan IN ('six_months','one_year')),
  status TEXT CHECK(status IN ('active','canceled','expired','trial')), expires_at INTEGER, auto_renew INTEGER, provider TEXT);
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, user_id TEXT, plan TEXT, provider TEXT, status TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS comments(
  id TEXT PRIMARY KEY, target_type TEXT, target_id TEXT, author_id TEXT, author_role TEXT, body TEXT,
  visibility TEXT DEFAULT 'private_instructor', reply_to TEXT, resolved INTEGER DEFAULT 0,
  internal_note TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS practice(
  id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, target_id TEXT, lesson_id TEXT, payload TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS crm_contacts(
  id TEXT PRIMARY KEY, contact TEXT, source TEXT, status TEXT, notes TEXT, assigned_to TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS xapi_log(id TEXT PRIMARY KEY, statement TEXT, stored INTEGER);
"""

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init():
    with db() as c:
        c.executescript(SCHEMA)
        if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            from .auth import hash_password
            now = int(time.time() * 1000)
            for em, pw, nm, role in [("student@demo.test", "demo123", "Sam Student", "student"),
                                     ("editor@demo.test", "demo123", "Elena Editor", "editor"),
                                     ("admin@demo.test", "admin123", "Admin Adminov", "admin")]:
                c.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?)", (str(uuid.uuid4()), em, nm, role, hash_password(pw), None, now))
            c.execute("INSERT INTO crm_contacts VALUES(?,?,?,?,?,?,?)",
                      (str(uuid.uuid4()), "lead-visitor@example.com", "landing_form", "new", "Downloaded syllabus", None, now))

def rows(sql, args=()):
    with db() as c:
        return [dict(r) for r in c.execute(sql, args)]

def one(sql, args=()):
    rs = rows(sql, args)
    return rs[0] if rs else None

def run(sql, args=()):
    with db() as c:
        c.execute(sql, args)
        c.commit()
