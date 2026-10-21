"""Russian Launchpad — FastAPI backend skeleton.

Run:  cd rl-api && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8050

Env (see .env.example):
  SECRET_KEY, ALLOW_DEV_ACTIVATION (production example: false),
  DATABASE_URL (sqlite default), STRIPE_*, YOOKASSA_*, TELEGRAM_BOT_TOKEN
"""
