"""
inGastro modules (iteration 3):
- RCP (Rejestracja Czasu Pracy): PIN clock-in/out on POS + payroll reports.
- Courier app: delivery queue, depart (triggers customer SMS), delivered.
- SMS (mock): per-tenant toggle, priced by the platform super admin.
- Platform Super Admin: SaaS module catalog, pricing, feature toggles, tenant management.
"""
import logging
import io
import math
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from server import (
    db, now_iso, new_id, strip_mongo, hash_password, verify_password, decode_token,
    get_current_user, require_roles, transition_order,
)

log = logging.getLogger("ingastro.modules")


# ---------------------------------------------------------------------------
# Actor auth – works for BOTH users (password login) and employees (PIN login)
# ---------------------------------------------------------------------------
async def get_actor(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(auth[7:])
    actor = await db.users.find_one({"id": payload["sub"]}) or await db.employees.find_one({"id": payload["sub"]})
    if not actor:
        raise HTTPException(401, "User not found")
    actor["role"] = payload.get("role", actor.get("role"))
    actor["tenant_id"] = payload.get("tid", actor.get("tenant_id"))
    return strip_mongo(actor)


def require_actor_roles(*roles: str):
    async def _dep(actor: dict = Depends(get_actor)) -> dict:
        if actor.get("role") not in roles:
            raise HTTPException(403, f"Rola {actor.get('role')} nie ma uprawnień")
        return actor
    return _dep


# ---------------------------------------------------------------------------
# Platform config (super admin) – SaaS module catalog + pricing
# ---------------------------------------------------------------------------
DEFAULT_MODULES = [
    {"key": "pos", "label": "Kasa POS", "monthly_price": 0.0, "enabled": True},
    {"key": "kds", "label": "KDS Kuchnia", "monthly_price": 49.0, "enabled": True},
    {"key": "inventory", "label": "Magazyn BOM", "monthly_price": 79.0, "enabled": True},
    {"key": "ecommerce", "label": "Sklep online", "monthly_price": 99.0, "enabled": True},
    {"key": "pyszne", "label": "Integracja Pyszne.pl", "monthly_price": 59.0, "enabled": True},
    {"key": "rcp", "label": "RCP – Czas pracy", "monthly_price": 39.0, "enabled": True},
    {"key": "courier", "label": "Aplikacja Kuriera", "monthly_price": 49.0, "enabled": True},
    {"key": "sms", "label": "Powiadomienia SMS", "monthly_price": 0.0, "enabled": True},
]

DEFAULT_PLATFORM = {
    "modules": DEFAULT_MODULES,
    "sms_price": 0.20,          # zł per SMS charged to tenant
    "sms_enabled": True,        # global kill-switch
    "currency": "PLN",
}


async def get_platform_config() -> dict:
    cfg = await db.platform_config.find_one({"_id": "global"})
    if not cfg:
        return dict(DEFAULT_PLATFORM)
    cfg.pop("_id", None)
    merged = {**DEFAULT_PLATFORM, **cfg}
    # ensure every default module key exists
    by_key = {m["key"]: m for m in merged.get("modules", [])}
    merged["modules"] = [by_key.get(m["key"], m) for m in DEFAULT_MODULES]
    return merged


async def effective_modules(tenant: Optional[dict]) -> Dict[str, bool]:
    cfg = await get_platform_config()
    platform = {m["key"]: m["enabled"] for m in cfg["modules"]}
    overrides = (tenant or {}).get("modules", {}) or {}
    return {k: bool(platform.get(k, True)) and bool(overrides.get(k, True)) for k in platform}


# ---------------------------------------------------------------------------
# SMS (mock) – logs messages + accrues cost to tenant usage ledger
# ---------------------------------------------------------------------------
async def send_customer_sms(tenant_id: str, order: dict, body: str, kind: str = "courier_departed") -> dict:
    cfg = await get_platform_config()
    s = await db.tenant_settings.find_one({"tenant_id": tenant_id}) or {}
    tenant_on = s.get("sms_courier_enabled", False)
    phone = order.get("customer_phone")
    if not cfg["sms_enabled"]:
        return {"sent": False, "reason": "disabled_platform"}
    if not tenant_on:
        return {"sent": False, "reason": "disabled_tenant"}
    if not phone:
        return {"sent": False, "reason": "no_phone"}
    cost = round(float(cfg["sms_price"]), 2)
    msg = {
        "id": new_id(), "tenant_id": tenant_id, "order_id": order.get("id"),
        "order_number": order.get("number"), "to": phone, "body": body, "kind": kind,
        "cost": cost, "status": "simulated", "at": now_iso(),
    }
    await db.sms_messages.insert_one(msg)
    log.info(f"[SMS MOCK] → {phone}: {body}")
    return {"sent": True, "cost": cost, "to": phone}


# ---------------------------------------------------------------------------
# Super Admin router
# ---------------------------------------------------------------------------
admin_router = APIRouter(prefix="/api/admin")


class ModuleIn(BaseModel):
    key: str
    label: Optional[str] = None
    monthly_price: Optional[float] = None
    enabled: Optional[bool] = None


class PlatformConfigIn(BaseModel):
    modules: Optional[List[ModuleIn]] = None
    sms_price: Optional[float] = None
    sms_enabled: Optional[bool] = None


class TenantAdminIn(BaseModel):
    plan: Optional[str] = None
    modules: Optional[Dict[str, bool]] = None
    active: Optional[bool] = None


@admin_router.get("/overview")
async def admin_overview(admin: dict = Depends(require_roles("superadmin"))):
    tenants = await db.tenants.count_documents({})
    users = await db.users.count_documents({"role": {"$ne": "superadmin"}})
    orders = await db.orders.count_documents({})
    sms_total = await db.sms_messages.count_documents({})
    sms_agg = await db.sms_messages.aggregate([{"$group": {"_id": None, "cost": {"$sum": "$cost"}}}]).to_list(1)
    cfg = await get_platform_config()
    mrr = 0.0
    for t in await db.tenants.find({}).to_list(1000):
        ov = t.get("modules", {}) or {}
        for m in cfg["modules"]:
            if m["enabled"] and ov.get(m["key"], True):
                mrr += m["monthly_price"]
    return {
        "tenants": tenants, "users": users, "orders": orders,
        "sms_sent": sms_total, "sms_revenue": round((sms_agg[0]["cost"] if sms_agg else 0.0), 2),
        "mrr": round(mrr, 2), "currency": cfg["currency"],
    }


@admin_router.get("/config")
async def admin_get_config(admin: dict = Depends(require_roles("superadmin"))):
    return await get_platform_config()


@admin_router.put("/config")
async def admin_put_config(body: PlatformConfigIn, admin: dict = Depends(require_roles("superadmin"))):
    cfg = await get_platform_config()
    if body.modules is not None:
        by_key = {m["key"]: m for m in cfg["modules"]}
        for m in body.modules:
            tgt = by_key.get(m.key)
            if not tgt:
                continue
            if m.label is not None:
                tgt["label"] = m.label
            if m.monthly_price is not None:
                tgt["monthly_price"] = round(float(m.monthly_price), 2)
            if m.enabled is not None:
                tgt["enabled"] = bool(m.enabled)
        cfg["modules"] = [by_key[m["key"]] for m in DEFAULT_MODULES]
    if body.sms_price is not None:
        cfg["sms_price"] = round(float(body.sms_price), 2)
    if body.sms_enabled is not None:
        cfg["sms_enabled"] = bool(body.sms_enabled)
    cfg["updated_at"] = now_iso()
    await db.platform_config.update_one({"_id": "global"}, {"$set": cfg}, upsert=True)
    return await get_platform_config()


@admin_router.get("/tenants")
async def admin_tenants(admin: dict = Depends(require_roles("superadmin"))):
    rows = await db.tenants.find({}).sort("created_at", -1).to_list(1000)
    out = []
    for t in rows:
        tid = t["id"]
        owner = await db.users.find_one({"tenant_id": tid, "role": "owner"})
        sms_agg = await db.sms_messages.aggregate([
            {"$match": {"tenant_id": tid}},
            {"$group": {"_id": None, "n": {"$sum": 1}, "cost": {"$sum": "$cost"}}},
        ]).to_list(1)
        out.append({
            "id": tid, "name": t.get("name"), "slug": t.get("slug"), "plan": t.get("plan"),
            "active": t.get("active", True), "modules": t.get("modules", {}) or {},
            "owner_email": owner.get("email") if owner else None,
            "orders": await db.orders.count_documents({"tenant_id": tid}),
            "sms_sent": sms_agg[0]["n"] if sms_agg else 0,
            "sms_cost": round(sms_agg[0]["cost"], 2) if sms_agg else 0.0,
            "created_at": t.get("created_at"),
        })
    return out


@admin_router.put("/tenants/{tid}")
async def admin_update_tenant(tid: str, body: TenantAdminIn, admin: dict = Depends(require_roles("superadmin"))):
    patch: Dict[str, Any] = {}
    if body.plan is not None:
        patch["plan"] = body.plan
    if body.active is not None:
        patch["active"] = body.active
    if body.modules is not None:
        patch["modules"] = body.modules
    if not patch:
        raise HTTPException(400, "Brak zmian")
    r = await db.tenants.update_one({"id": tid}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(404, "Tenant nie istnieje")
    return strip_mongo(await db.tenants.find_one({"id": tid}))


@admin_router.get("/sms")
async def admin_sms(limit: int = 50, admin: dict = Depends(require_roles("superadmin"))):
    rows = await db.sms_messages.find({}).sort("at", -1).to_list(limit)
    return [strip_mongo(r) for r in rows]


# ---------------------------------------------------------------------------
# SaaS invoices (super admin) – monthly subscription + SMS usage per tenant
# ---------------------------------------------------------------------------
def _period_bounds(period: str) -> tuple:
    """period = 'YYYY-MM' -> (start_iso_prefix, next_month_prefix)."""
    y, m = int(period[:4]), int(period[5:7])
    nm = f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"
    return period, nm


async def _build_invoice(tenant: dict, period: str, cfg: dict) -> dict:
    tid = tenant["id"]
    mods = await effective_modules(tenant)
    prices = {m["key"]: m for m in cfg["modules"]}
    lines = []
    subtotal = 0.0
    for key, on in mods.items():
        m = prices.get(key)
        if on and m and m["monthly_price"] > 0:
            lines.append({"label": m["label"], "qty": 1, "unit": m["monthly_price"], "amount": m["monthly_price"]})
            subtotal += m["monthly_price"]
    start, nxt = _period_bounds(period)
    sms_rows = await db.sms_messages.find({
        "tenant_id": tid, "at": {"$gte": start, "$lt": nxt},
    }).to_list(100000)
    sms_count = len(sms_rows)
    sms_cost = round(sum(r.get("cost", 0.0) for r in sms_rows), 2)
    if sms_count:
        lines.append({"label": f"Powiadomienia SMS ({sms_count} szt.)", "qty": sms_count,
                      "unit": cfg["sms_price"], "amount": sms_cost})
    total = round(subtotal + sms_cost, 2)
    return {
        "tenant_id": tid, "tenant_name": tenant.get("name"), "period": period,
        "lines": lines, "subtotal_modules": round(subtotal, 2),
        "sms_count": sms_count, "sms_cost": sms_cost, "total": total,
        "currency": cfg["currency"],
    }


class InvoiceGenIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")


@admin_router.post("/invoices/generate")
async def admin_generate_invoices(body: InvoiceGenIn, admin: dict = Depends(require_roles("superadmin"))):
    cfg = await get_platform_config()
    tenants = await db.tenants.find({}).to_list(1000)
    out = []
    for t in tenants:
        inv = await _build_invoice(t, body.period, cfg)
        existing = await db.invoices.find_one({"tenant_id": t["id"], "period": body.period})
        if existing:
            await db.invoices.update_one(
                {"id": existing["id"]},
                {"$set": {**inv, "status": existing.get("status", "unpaid"), "updated_at": now_iso()}},
            )
            out.append(strip_mongo(await db.invoices.find_one({"id": existing["id"]})))
        else:
            doc = {"id": new_id(), **inv, "status": "unpaid", "paid_at": None,
                   "number": f"FV/{body.period}/{t['id'][:6].upper()}", "created_at": now_iso()}
            await db.invoices.insert_one(doc)
            out.append(strip_mongo(await db.invoices.find_one({"id": doc["id"]})))
    return out


@admin_router.get("/invoices")
async def admin_invoices(period: Optional[str] = None, status: Optional[str] = None,
                         admin: dict = Depends(require_roles("superadmin"))):
    q: Dict[str, Any] = {}
    if period:
        q["period"] = period
    if status:
        q["status"] = status
    rows = await db.invoices.find(q).sort("created_at", -1).to_list(2000)
    return [strip_mongo(r) for r in rows]


@admin_router.get("/invoices/summary")
async def admin_invoices_summary(admin: dict = Depends(require_roles("superadmin"))):
    rows = await db.invoices.find({}).to_list(5000)
    outstanding = round(sum(r["total"] for r in rows if r.get("status") != "paid"), 2)
    paid = round(sum(r["total"] for r in rows if r.get("status") == "paid"), 2)
    return {
        "outstanding": outstanding, "paid": paid, "total": round(outstanding + paid, 2),
        "count": len(rows), "unpaid_count": sum(1 for r in rows if r.get("status") != "paid"),
    }


class InvoiceStatusIn(BaseModel):
    status: Literal["paid", "unpaid"]


@admin_router.put("/invoices/{iid}")
async def admin_update_invoice(iid: str, body: InvoiceStatusIn, admin: dict = Depends(require_roles("superadmin"))):
    patch = {"status": body.status, "paid_at": now_iso() if body.status == "paid" else None}
    r = await db.invoices.update_one({"id": iid}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(404, "Faktura nie istnieje")
    return strip_mongo(await db.invoices.find_one({"id": iid}))


@admin_router.get("/invoices/{iid}/pdf")
async def admin_invoice_pdf(iid: str, admin: dict = Depends(require_roles("superadmin"))):
    inv = await db.invoices.find_one({"id": iid})
    if not inv:
        raise HTTPException(404, "Faktura nie istnieje")
    pdf = _render_invoice_pdf(inv)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{inv.get("number", iid)}.pdf"'})


def _render_invoice_pdf(inv: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm)
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontSize=20, textColor=colors.HexColor("#0f172a"))
    muted = ParagraphStyle("m", parent=styles["Normal"], textColor=colors.HexColor("#64748b"), fontSize=9)
    story = []
    story.append(Paragraph("inGastro Cloud OS", h))
    story.append(Paragraph("Faktura za uslugi SaaS", muted))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(f"<b>Nr faktury:</b> {inv.get('number', '')}", styles["Normal"]))
    story.append(Paragraph(f"<b>Okres rozliczeniowy:</b> {inv.get('period', '')}", styles["Normal"]))
    story.append(Paragraph(f"<b>Klient (tenant):</b> {inv.get('tenant_name', '')}", styles["Normal"]))
    story.append(Paragraph(f"<b>Status:</b> {'ZAPLACONA' if inv.get('status') == 'paid' else 'NIEZAPLACONA'}", styles["Normal"]))
    story.append(Spacer(1, 8 * mm))

    cur = inv.get("currency", "PLN")
    data = [["Pozycja", "Ilosc", "Cena jedn.", "Kwota"]]
    for ln in inv.get("lines", []):
        data.append([ln["label"], str(ln["qty"]), f"{ln['unit']:.2f} {cur}", f"{ln['amount']:.2f} {cur}"])
    data.append(["", "", "RAZEM", f"{inv.get('total', 0):.2f} {cur}"])
    tbl = Table(data, colWidths=[90 * mm, 20 * mm, 30 * mm, 30 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("Dokument wygenerowany automatycznie przez platforme inGastro Cloud OS.", muted))
    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tenant-facing SMS settings
# ---------------------------------------------------------------------------
sms_router = APIRouter(prefix="/api/sms")


class SmsSettingsIn(BaseModel):
    enabled: bool


@sms_router.get("/settings")
async def sms_get_settings(user: dict = Depends(require_roles("owner", "manager"))):
    cfg = await get_platform_config()
    s = await db.tenant_settings.find_one({"tenant_id": user["tenant_id"]}) or {}
    recent = await db.sms_messages.find({"tenant_id": user["tenant_id"]}).sort("at", -1).to_list(20)
    agg = await db.sms_messages.aggregate([
        {"$match": {"tenant_id": user["tenant_id"]}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "cost": {"$sum": "$cost"}}},
    ]).to_list(1)
    return {
        "platform_enabled": cfg["sms_enabled"], "price": cfg["sms_price"], "currency": cfg["currency"],
        "tenant_enabled": s.get("sms_courier_enabled", False),
        "sent_total": agg[0]["n"] if agg else 0, "cost_total": round(agg[0]["cost"], 2) if agg else 0.0,
        "recent": [strip_mongo(r) for r in recent],
    }


@sms_router.put("/settings")
async def sms_put_settings(body: SmsSettingsIn, user: dict = Depends(require_roles("owner", "manager"))):
    await db.tenant_settings.update_one({"tenant_id": user["tenant_id"]},
                                        {"$set": {"sms_courier_enabled": body.enabled, "updated_at": now_iso()}},
                                        upsert=True)
    return await sms_get_settings(user)


# ---------------------------------------------------------------------------
# RCP – Rejestracja Czasu Pracy
# ---------------------------------------------------------------------------
rcp_router = APIRouter(prefix="/api/rcp")


class RcpClockIn(BaseModel):
    pin: str = Field(min_length=4, max_length=6)
    location_id: str


def _minutes_between(a: str, b: str) -> int:
    da, db_ = datetime.fromisoformat(a), datetime.fromisoformat(b)
    return max(0, int((db_ - da).total_seconds() // 60))


@rcp_router.post("/clock")
async def rcp_clock(body: RcpClockIn, actor: dict = Depends(get_actor)):
    tenant_id = actor["tenant_id"]
    emps = await db.employees.find({"tenant_id": tenant_id}).to_list(1000)
    emp = next((e for e in emps if verify_password(body.pin, e.get("pin_hash", ""))), None)
    if not emp:
        raise HTTPException(401, "Nieprawidłowy PIN")
    open_entry = await db.time_entries.find_one({"tenant_id": tenant_id, "employee_id": emp["id"], "status": "open"})
    if open_entry:
        out = now_iso()
        minutes = _minutes_between(open_entry["clock_in"], out)
        await db.time_entries.update_one({"id": open_entry["id"]},
                                         {"$set": {"clock_out": out, "minutes": minutes, "status": "closed"}})
        return {"action": "clock_out", "employee_name": emp["name"], "minutes": minutes,
                "clock_in": open_entry["clock_in"], "clock_out": out}
    entry = {
        "id": new_id(), "tenant_id": tenant_id, "location_id": body.location_id,
        "employee_id": emp["id"], "employee_name": emp["name"], "role": emp.get("role"),
        "hourly_rate": emp.get("hourly_rate", 0.0),
        "clock_in": now_iso(), "clock_out": None, "minutes": None, "status": "open",
    }
    await db.time_entries.insert_one(entry)
    return {"action": "clock_in", "employee_name": emp["name"], "clock_in": entry["clock_in"]}


@rcp_router.get("/active")
async def rcp_active(location_id: Optional[str] = None, actor: dict = Depends(get_actor)):
    q = {"tenant_id": actor["tenant_id"], "status": "open"}
    if location_id:
        q["location_id"] = location_id
    rows = await db.time_entries.find(q).sort("clock_in", -1).to_list(500)
    return [strip_mongo(r) for r in rows]


@rcp_router.get("/entries")
async def rcp_entries(date_from: Optional[str] = None, date_to: Optional[str] = None,
                      employee_id: Optional[str] = None, location_id: Optional[str] = None,
                      user: dict = Depends(require_roles("owner", "manager"))):
    q: Dict[str, Any] = {"tenant_id": user["tenant_id"]}
    if employee_id:
        q["employee_id"] = employee_id
    if location_id:
        q["location_id"] = location_id
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to + "T23:59:59"
        q["clock_in"] = rng
    rows = await db.time_entries.find(q).sort("clock_in", -1).to_list(2000)
    return [strip_mongo(r) for r in rows]


@rcp_router.get("/report")
async def rcp_report(date_from: Optional[str] = None, date_to: Optional[str] = None,
                     location_id: Optional[str] = None,
                     user: dict = Depends(require_roles("owner", "manager"))):
    rows = await rcp_entries(date_from, date_to, None, location_id, user)
    by_emp: Dict[str, dict] = {}
    for r in rows:
        if r.get("status") != "closed" or not r.get("minutes"):
            continue
        e = by_emp.setdefault(r["employee_id"], {
            "employee_id": r["employee_id"], "employee_name": r.get("employee_name"),
            "role": r.get("role"), "hourly_rate": r.get("hourly_rate", 0.0),
            "total_minutes": 0, "shifts": 0,
        })
        e["total_minutes"] += r["minutes"]
        e["shifts"] += 1
    out = []
    for e in by_emp.values():
        hours = round(e["total_minutes"] / 60, 2)
        out.append({**e, "hours": hours, "amount": round(hours * e["hourly_rate"], 2)})
    out.sort(key=lambda x: x["employee_name"] or "")
    return {"rows": out, "total_amount": round(sum(x["amount"] for x in out), 2),
            "total_hours": round(sum(x["hours"] for x in out), 2)}


# ---------------------------------------------------------------------------
# Courier app
# ---------------------------------------------------------------------------
courier_router = APIRouter(prefix="/api/courier")

_GEO_CACHE: Dict[str, dict] = {}


def _haversine(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlam = math.radians(b_lng - a_lng)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.asin(math.sqrt(x))


async def _geocode(address: str) -> Optional[dict]:
    if not address:
        return None
    key = address.strip().lower()
    if key in _GEO_CACHE:
        return _GEO_CACHE[key]
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "json", "limit": 1, "countrycodes": "pl"},
                headers={"User-Agent": "inGastroCloudOS/1.0 (dispatch)"},
            )
            data = r.json()
            if data:
                geo = {"lat": float(data[0]["lat"]), "lng": float(data[0]["lon"])}
                _GEO_CACHE[key] = geo
                return geo
    except Exception as e:
        log.warning(f"geocode failed: {e}")
    return None


def _delivery_view(o: dict) -> dict:
    keys = ("id", "number", "status", "order_type", "customer_name", "customer_phone",
            "customer_address", "note", "totals", "items", "payment_status", "created_at", "location_id", "geo")
    v = {k: o.get(k) for k in keys}
    v["item_count"] = sum(it.get("quantity", 1) for it in o.get("items", []))
    return v


@courier_router.get("/deliveries")
async def courier_deliveries(location_id: Optional[str] = None,
                             actor: dict = Depends(require_actor_roles("courier", "owner", "manager"))):
    q: Dict[str, Any] = {"tenant_id": actor["tenant_id"], "order_type": "DELIVERY",
                         "status": {"$in": ["ready", "in_delivery"]}}
    if location_id:
        q["location_id"] = location_id
    rows = await db.orders.find(q).sort("created_at", 1).to_list(200)
    out = []
    for o in rows:
        if not o.get("geo") and o.get("customer_address"):
            geo = await _geocode(o["customer_address"])
            if geo:
                o["geo"] = geo
                await db.orders.update_one({"id": o["id"]}, {"$set": {"geo": geo}})
        out.append(_delivery_view(o))
    return out


class CourierLocationIn(BaseModel):
    lat: float
    lng: float


@courier_router.post("/location")
async def courier_set_location(body: CourierLocationIn,
                               actor: dict = Depends(require_actor_roles("courier", "owner", "manager"))):
    await db.courier_locations.update_one(
        {"employee_id": actor["id"]},
        {"$set": {"employee_id": actor["id"], "name": actor.get("name"), "role": actor.get("role"),
                  "tenant_id": actor["tenant_id"], "lat": body.lat, "lng": body.lng, "at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@courier_router.get("/locations")
async def courier_locations(actor: dict = Depends(require_actor_roles("owner", "manager"))):
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    rows = await db.courier_locations.find({"tenant_id": actor["tenant_id"]}).to_list(200)
    return [{**strip_mongo(r), "online": r.get("at", "") >= cutoff} for r in rows]


@courier_router.post("/deliveries/{oid}/depart")
async def courier_depart(oid: str, actor: dict = Depends(require_actor_roles("courier", "owner", "manager"))):
    o = await db.orders.find_one({"id": oid, "tenant_id": actor["tenant_id"]})
    if not o:
        raise HTTPException(404, "Zamówienie nie istnieje")
    updated = await transition_order(o, "in_delivery", actor.get("name", "Kurier"))
    body = f"Twoje zamowienie #{o.get('number')} jest w drodze! Kurier {actor.get('name', '')} juz jedzie. Smacznego!"
    sms = await send_customer_sms(actor["tenant_id"], o, body)
    return {"order": _delivery_view({**o, **updated}), "sms": sms}


@courier_router.post("/deliveries/{oid}/delivered")
async def courier_delivered(oid: str, actor: dict = Depends(require_actor_roles("courier", "owner", "manager"))):
    o = await db.orders.find_one({"id": oid, "tenant_id": actor["tenant_id"]})
    if not o:
        raise HTTPException(404, "Zamówienie nie istnieje")
    updated = await transition_order(o, "completed", actor.get("name", "Kurier"))
    return {"order": _delivery_view({**o, **updated})}


# ---------------------------------------------------------------------------
# Public tenant resolve (courier portal PIN login needs tenant_id)
# ---------------------------------------------------------------------------
public_router = APIRouter(prefix="/api")


@public_router.get("/public/tenant/{slug}")
async def public_tenant(slug: str):
    t = await db.tenants.find_one({"slug": slug})
    if not t:
        raise HTTPException(404, "Nie znaleziono")
    mods = await effective_modules(t)
    return {"id": t["id"], "name": t["name"], "slug": t["slug"], "courier_enabled": mods.get("courier", True)}


# ---------------------------------------------------------------------------
# Seed – platform config + super admin
# ---------------------------------------------------------------------------
async def seed_modules():
    if not await db.platform_config.find_one({"_id": "global"}):
        await db.platform_config.insert_one({"_id": "global", **DEFAULT_PLATFORM, "created_at": now_iso()})
        log.info("Seeded platform_config")
    email = "balordini@gmail.com"
    if not await db.users.find_one({"email": email}):
        await db.users.insert_one({
            "id": new_id(), "tenant_id": "platform", "email": email, "name": "Super Admin",
            "role": "superadmin", "password_hash": hash_password("superadmin123"), "created_at": now_iso(),
        })
        log.info("Seeded super admin balordini@gmail.com")
