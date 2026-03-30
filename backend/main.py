# CreditPulse — FastAPI Backend
# Run: uvicorn main:app --reload
# 
# NOTE: Most logic runs client-side via Supabase JS SDK.
# This backend is for automation: daily risk alerts, WhatsApp notifications, reports.

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
from datetime import datetime, timedelta
from supabase import create_client, Client

app = FastAPI(title="CreditPulse API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase (server-side, uses service_role key) ────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://YOUR_PROJECT.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "YOUR_SERVICE_ROLE_KEY")

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Models ────────────────────────────────────────────────────
class CustomerIn(BaseModel):
    name: str
    phone: str
    credit_limit: Optional[float] = 30000

class TransactionIn(BaseModel):
    customer_id: str
    type: str          # 'payment' | 'sale'
    amount: float

# ── Risk calculation (mirrors frontend logic) ─────────────────
def compute_risk(balance: float, days_since_payment: int, credit_limit: float) -> str:
    if balance <= 0:
        return "low"
    pct = balance / (credit_limit or 30000)
    if days_since_payment > 30 or pct > 0.9:
        return "high"
    if days_since_payment > 14 or pct > 0.6:
        return "medium"
    return "low"

def compute_prediction(risk: str, payment_count: int) -> str:
    if risk == "high":
        return "Will not pay on time — Call now"
    if risk == "medium":
        return "Likely to pay late"
    if payment_count >= 2:
        return "Usually pays on time"
    return "Looking safe"

# ── Routes ────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"app": "CreditPulse", "status": "running"}

@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}

# ── Automation: Daily risk report ─────────────────────────────
@app.get("/automation/daily-risk/{user_id}")
def daily_risk_report(user_id: str):
    """
    Called daily by a cron job (e.g. Supabase Edge Function or Railway cron).
    Returns high-risk customers for the user.
    """
    sb = get_supabase()
    customers = sb.table("customers").select("*").eq("user_id", user_id).execute().data
    transactions = sb.table("transactions").select("*").eq("user_id", user_id).execute().data

    report = []
    for c in customers:
        cust_txns = [t for t in transactions if t["customer_id"] == c["id"]]
        balance = sum(t["amount"] if t["type"] == "sale" else -t["amount"] for t in cust_txns)
        payments = [t for t in cust_txns if t["type"] == "payment"]

        if payments:
            last_pay_date = max(datetime.fromisoformat(p["created_at"].replace("Z", "")) for p in payments)
            days = (datetime.utcnow() - last_pay_date).days
        else:
            sales = [t for t in cust_txns if t["type"] == "sale"]
            if sales:
                oldest = min(datetime.fromisoformat(s["created_at"].replace("Z", "")) for s in sales)
                days = (datetime.utcnow() - oldest).days
            else:
                days = 0

        risk = compute_risk(balance, days, c.get("credit_limit", 30000))
        if risk in ("high", "medium"):
            report.append({
                "name": c["name"],
                "phone": c["phone"],
                "balance": round(balance, 2),
                "days_overdue": days,
                "risk": risk,
                "prediction": compute_prediction(risk, len(payments)),
            })

    report.sort(key=lambda x: (x["risk"] == "high", x["balance"]), reverse=True)
    return {"user_id": user_id, "date": datetime.utcnow().date().isoformat(), "high_risk_customers": report}

# ── Automation: Call list ─────────────────────────────────────
@app.get("/automation/call-list/{user_id}")
def call_list(user_id: str):
    """Returns top 3 customers to call today, sorted by urgency."""
    report = daily_risk_report(user_id)
    customers = report["high_risk_customers"]
    # Score: days_overdue * 1000 + balance
    scored = sorted(customers, key=lambda c: c["days_overdue"] * 1000 + c["balance"], reverse=True)
    return {"call_today": scored[:3]}

# ── WhatsApp reminder message generator ───────────────────────
@app.get("/whatsapp-message/{customer_id}")
def whatsapp_message(customer_id: str, user_id: str):
    """Generates a WhatsApp reminder message for a customer."""
    sb = get_supabase()
    c = sb.table("customers").select("*").eq("id", customer_id).single().execute().data
    txns = sb.table("transactions").select("*").eq("customer_id", customer_id).execute().data

    balance = sum(t["amount"] if t["type"] == "sale" else -t["amount"] for t in txns)
    msg = (
        f"Hello {c['name']}, this is a payment reminder. "
        f"Your outstanding balance is ₹{int(balance):,}. "
        f"Please arrange payment at your earliest. Thank you!"
    )
    wa_link = f"https://wa.me/{c['phone'].replace(' ', '').replace('+', '')}?text={msg}"
    return {"message": msg, "whatsapp_link": wa_link, "balance": round(balance, 2)}

# ── Summary stats ─────────────────────────────────────────────
@app.get("/summary/{user_id}")
def summary(user_id: str):
    sb = get_supabase()
    customers = sb.table("customers").select("*").eq("user_id", user_id).execute().data
    transactions = sb.table("transactions").select("*").eq("user_id", user_id).execute().data

    total_outstanding = 0
    high_risk = medium_risk = safe = 0

    for c in customers:
        cust_txns = [t for t in transactions if t["customer_id"] == c["id"]]
        balance = sum(t["amount"] if t["type"] == "sale" else -t["amount"] for t in cust_txns)
        payments = [t for t in cust_txns if t["type"] == "payment"]
        days = 0
        if payments:
            last_pay = max(datetime.fromisoformat(p["created_at"].replace("Z","")) for p in payments)
            days = (datetime.utcnow() - last_pay).days
        risk = compute_risk(balance, days, c.get("credit_limit", 30000))
        if balance > 0: total_outstanding += balance
        if risk == "high": high_risk += 1
        elif risk == "medium": medium_risk += 1
        else: safe += 1

    return {
        "total_customers": len(customers),
        "total_outstanding": round(total_outstanding, 2),
        "high_risk": high_risk,
        "medium_risk": medium_risk,
        "safe": safe,
    }
