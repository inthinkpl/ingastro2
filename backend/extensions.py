"""
inGastro extensions: Inventory/BOM, tenant settings, public e-commerce storefront
(Stripe + PayU), Pyszne.pl aggregator integration (Order Ingestion + Menu Push).
"""
import os
import re
import time
import base64
import hashlib
import hmac
import secrets
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal

import httpx
import stripe
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel, Field

from server import (
    db, now_iso, new_id, strip_mongo, get_current_user, require_roles,
    persist_order, transition_order, JWT_SECRET, log as _log,
)

log = logging.getLogger("ingastro.ext")

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_emergent"
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
FOOD_TAX_CODE = "txcd_40060003"

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(JWT_SECRET.encode()).digest()))


def enc(v: str) -> str:
    return _fernet.encrypt(v.encode()).decode()


def dec(v: str) -> str:
    return _fernet.decrypt(v.encode()).decode()


# ---------------------------------------------------------------------------
# Tenant settings
# ---------------------------------------------------------------------------
settings_router = APIRouter(prefix="/api")

DEFAULT_SETTINGS = {
    "stock_deduction_mode": "on_create",
    "online_ordering_enabled": True,
    "payment_provider": "stripe",
    "accept_cash": True,
    "delivery_fee": 9.0,
    "min_order": 30.0,
    "store_description": "",
    "store_domain": "",
    "payu": None,
}


async def get_settings(tenant_id: str) -> dict:
    s = await db.tenant_settings.find_one({"tenant_id": tenant_id}) or {}
    return {**DEFAULT_SETTINGS, **strip_mongo(s), "tenant_id": tenant_id}


def public_settings(s: dict) -> dict:
    payu = s.get("payu")
    return {
        **{k: v for k, v in s.items() if k != "payu"},
        "payu": {"configured": bool(payu), "pos_id": dec(payu["pos_id_enc"]) if payu else "",
                 "sandbox": payu.get("sandbox", True) if payu else True},
    }


class PayUCredsIn(BaseModel):
    pos_id: str = Field(min_length=1)
    md5_second_key: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1)
    sandbox: bool = True


class SettingsIn(BaseModel):
    stock_deduction_mode: Optional[Literal["on_create", "on_ready"]] = None
    online_ordering_enabled: Optional[bool] = None
    payment_provider: Optional[Literal["stripe", "payu"]] = None
    accept_cash: Optional[bool] = None
    delivery_fee: Optional[float] = None
    min_order: Optional[float] = None
    store_description: Optional[str] = None
    store_domain: Optional[str] = None
    slug: Optional[str] = None
    payu: Optional[PayUCredsIn] = None
    clear_payu: bool = False


@settings_router.get("/settings")
async def read_settings(user: dict = Depends(require_roles("owner", "manager"))):
    s = await get_settings(user["tenant_id"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]})
    return {**public_settings(s), "slug": tenant.get("slug"), "tenant_name": tenant.get("name")}


@settings_router.put("/settings")
async def write_settings(body: SettingsIn, user: dict = Depends(require_roles("owner", "manager"))):
    patch: Dict[str, Any] = {}
    for k in ("stock_deduction_mode", "online_ordering_enabled", "payment_provider", "accept_cash",
              "delivery_fee", "min_order", "store_description", "store_domain"):
        v = getattr(body, k)
        if v is not None:
            patch[k] = v
    if body.payu:
        patch["payu"] = {
            "pos_id_enc": enc(body.payu.pos_id), "md5_enc": enc(body.payu.md5_second_key),
            "client_id_enc": enc(body.payu.client_id), "client_secret_enc": enc(body.payu.client_secret),
            "sandbox": body.payu.sandbox,
        }
    if body.clear_payu:
        patch["payu"] = None
    if body.payment_provider == "payu":
        existing = await db.tenant_settings.find_one({"tenant_id": user["tenant_id"]}) or {}
        if not (body.payu or existing.get("payu")):
            raise HTTPException(400, "Najpierw zapisz dane dostępowe PayU")
    patch["updated_at"] = now_iso()
    await db.tenant_settings.update_one({"tenant_id": user["tenant_id"]}, {"$set": patch}, upsert=True)
    if body.slug:
        slug = re.sub(r"[^a-z0-9-]", "", body.slug.lower().strip())[:40]
        if not slug:
            raise HTTPException(400, "Nieprawidłowy slug")
        clash = await db.tenants.find_one({"slug": slug, "id": {"$ne": user["tenant_id"]}})
        if clash:
            raise HTTPException(400, "Ten adres sklepu jest już zajęty")
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"slug": slug}})
    return await read_settings(user)


# ---------------------------------------------------------------------------
# Inventory / BOM
# ---------------------------------------------------------------------------
inventory_router = APIRouter(prefix="/api/inventory")

UNITS = Literal["g", "kg", "ml", "l", "szt"]


class IngredientIn(BaseModel):
    name: str
    unit: UNITS = "g"
    cost_per_unit: float = 0.0
    min_stock: float = 0.0


class MovementIn(BaseModel):
    location_id: str
    ingredient_id: str
    qty: float
    type: Literal["delivery", "waste", "adjust"]
    note: str = ""


class RecipeIn(BaseModel):
    recipe: List[Dict[str, Any]]


@inventory_router.get("/ingredients")
async def list_ingredients(user: dict = Depends(get_current_user)):
    rows = await db.ingredients.find({"tenant_id": user["tenant_id"]}).sort("name", 1).to_list(2000)
    return [strip_mongo(r) for r in rows]


@inventory_router.post("/ingredients")
async def create_ingredient(body: IngredientIn, user: dict = Depends(require_roles("owner", "manager"))):
    doc = {"id": new_id(), "tenant_id": user["tenant_id"], **body.model_dump(), "created_at": now_iso()}
    await db.ingredients.insert_one(doc)
    return strip_mongo(doc)


@inventory_router.put("/ingredients/{iid}")
async def update_ingredient(iid: str, body: IngredientIn, user: dict = Depends(require_roles("owner", "manager"))):
    await db.ingredients.update_one({"id": iid, "tenant_id": user["tenant_id"]}, {"$set": body.model_dump()})
    return strip_mongo(await db.ingredients.find_one({"id": iid}))


@inventory_router.delete("/ingredients/{iid}")
async def delete_ingredient(iid: str, user: dict = Depends(require_roles("owner", "manager"))):
    await db.ingredients.delete_one({"id": iid, "tenant_id": user["tenant_id"]})
    await db.stock_levels.delete_many({"ingredient_id": iid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


@inventory_router.get("/stock")
async def stock_for_location(location_id: str, user: dict = Depends(get_current_user)):
    ings = await db.ingredients.find({"tenant_id": user["tenant_id"]}).sort("name", 1).to_list(2000)
    levels = await db.stock_levels.find({"tenant_id": user["tenant_id"], "location_id": location_id}).to_list(5000)
    by_ing = {l["ingredient_id"]: l.get("qty", 0.0) for l in levels}
    out = []
    for i in ings:
        qty = round(by_ing.get(i["id"], 0.0), 3)
        out.append({**strip_mongo(i), "qty": qty, "low": qty <= i.get("min_stock", 0.0),
                    "value": round(qty * i.get("cost_per_unit", 0.0), 2)})
    return out


@inventory_router.post("/movements")
async def add_movement(body: MovementIn, user: dict = Depends(require_roles("owner", "manager", "cook"))):
    ing = await db.ingredients.find_one({"id": body.ingredient_id, "tenant_id": user["tenant_id"]})
    if not ing:
        raise HTTPException(404, "Składnik nie istnieje")
    delta = body.qty if body.type == "delivery" else -abs(body.qty) if body.type == "waste" else body.qty
    await record_movement(user["tenant_id"], body.location_id, body.ingredient_id, delta, body.type,
                          note=body.note, by=user.get("name"))
    lvl = await db.stock_levels.find_one({"tenant_id": user["tenant_id"], "location_id": body.location_id,
                                          "ingredient_id": body.ingredient_id})
    return {"ok": True, "qty": round(lvl.get("qty", 0.0), 3)}


@inventory_router.get("/movements")
async def list_movements(location_id: str, limit: int = 100, user: dict = Depends(get_current_user)):
    rows = await db.stock_movements.find({"tenant_id": user["tenant_id"], "location_id": location_id}) \
        .sort("at", -1).to_list(limit)
    return [strip_mongo(r) for r in rows]


@inventory_router.get("/alerts")
async def low_stock_alerts(location_id: str, user: dict = Depends(get_current_user)):
    rows = await stock_for_location(location_id, user)
    return [r for r in rows if r["low"]]


@inventory_router.put("/recipes/{pid}")
async def set_recipe(pid: str, body: RecipeIn, user: dict = Depends(require_roles("owner", "manager"))):
    lines = []
    for r in body.recipe:
        if not r.get("ingredient_id") or float(r.get("qty", 0)) <= 0:
            continue
        lines.append({"ingredient_id": r["ingredient_id"], "qty": float(r["qty"]), "variant_id": r.get("variant_id") or None})
    res = await db.products.update_one({"id": pid, "tenant_id": user["tenant_id"]}, {"$set": {"recipe": lines}})
    if not res.matched_count:
        raise HTTPException(404, "Produkt nie istnieje")
    return strip_mongo(await db.products.find_one({"id": pid}))


async def record_movement(tenant_id: str, location_id: str, ingredient_id: str, delta: float, mtype: str,
                          note: str = "", by: Optional[str] = None, ref: Optional[str] = None):
    await db.stock_levels.update_one(
        {"tenant_id": tenant_id, "location_id": location_id, "ingredient_id": ingredient_id},
        {"$inc": {"qty": delta}, "$set": {"updated_at": now_iso()}}, upsert=True)
    ing = await db.ingredients.find_one({"id": ingredient_id})
    await db.stock_movements.insert_one({
        "id": new_id(), "tenant_id": tenant_id, "location_id": location_id, "ingredient_id": ingredient_id,
        "ingredient_name": ing.get("name") if ing else "?", "unit": ing.get("unit") if ing else "",
        "delta": round(delta, 3), "type": mtype, "note": note, "by": by, "ref": ref, "at": now_iso(),
    })


async def order_ingredient_usage(order: dict) -> Dict[str, float]:
    usage: Dict[str, float] = {}
    pids = [it["product_id"] for it in order.get("items", [])]
    prods = {p["id"]: p for p in await db.products.find({"id": {"$in": pids}}).to_list(1000)}
    for it in order.get("items", []):
        p = prods.get(it["product_id"])
        if not p:
            continue
        for line in p.get("recipe", []):
            if line.get("variant_id") and line["variant_id"] != it.get("variant_id"):
                continue
            usage[line["ingredient_id"]] = usage.get(line["ingredient_id"], 0.0) + line["qty"] * it["quantity"]
        mods = {m["id"]: m for m in p.get("modifiers", [])}
        for om in it.get("modifiers", []):
            m = mods.get(om.get("modifier_id"))
            if m and om.get("kind") == "ADD" and m.get("ingredient_id") and m.get("ingredient_qty"):
                usage[m["ingredient_id"]] = usage.get(m["ingredient_id"], 0.0) + m["ingredient_qty"] * it["quantity"]
    return usage


async def apply_stock_for_order(order: dict, status: str):
    """Deduct on create/ready (per tenant setting) and return on cancel."""
    s = await get_settings(order["tenant_id"])
    mode = s["stock_deduction_mode"]
    should_deduct = (status == "new" and mode == "on_create") or (status == "ready" and mode == "on_ready")
    ref = f"#{order.get('number')}"
    if should_deduct and not order.get("stock_deducted"):
        usage = await order_ingredient_usage(order)
        for iid, qty in usage.items():
            await record_movement(order["tenant_id"], order["location_id"], iid, -qty, "order", ref=ref,
                                  note=f"Zamówienie {ref}")
        order["stock_deducted"] = True
        await db.orders.update_one({"id": order["id"]}, {"$set": {"stock_deducted": True}})
    elif status == "cancelled" and order.get("stock_deducted"):
        usage = await order_ingredient_usage(order)
        for iid, qty in usage.items():
            await record_movement(order["tenant_id"], order["location_id"], iid, qty, "cancel_return", ref=ref,
                                  note=f"Anulowanie {ref}")
        order["stock_deducted"] = False
        await db.orders.update_one({"id": order["id"]}, {"$set": {"stock_deducted": False}})


# ---------------------------------------------------------------------------
# Public storefront + payments
# ---------------------------------------------------------------------------
store_router = APIRouter(prefix="/api")


async def resolve_tenant(slug: str) -> dict:
    t = await db.tenants.find_one({"slug": slug})
    if not t:
        s = await db.tenant_settings.find_one({"store_domain": slug})
        t = await db.tenants.find_one({"id": s["tenant_id"]}) if s else None
    if not t:
        raise HTTPException(404, "Sklep nie istnieje")
    return t


@store_router.get("/public/store/{slug}")
async def public_store(slug: str):
    t = await resolve_tenant(slug)
    s = await get_settings(t["id"])
    if not s["online_ordering_enabled"]:
        raise HTTPException(403, "Zamówienia online są wyłączone")
    locs = await db.locations.find({"tenant_id": t["id"]}).to_list(100)
    cats = await db.categories.find({"tenant_id": t["id"]}).sort("sort", 1).to_list(200)
    prods = await db.products.find({"tenant_id": t["id"], "available_online": {"$ne": False}}).to_list(2000)
    for p in prods:
        p.pop("recipe", None)
    return {
        "tenant": {"id": t["id"], "name": t["name"], "slug": t["slug"]},
        "settings": {k: s[k] for k in ("payment_provider", "accept_cash", "delivery_fee", "min_order", "store_description")},
        "payu_configured": bool(s.get("payu")),
        "locations": [strip_mongo(l) for l in locs],
        "categories": [strip_mongo(c) for c in cats],
        "products": [strip_mongo(p) for p in prods],
    }


class PublicModifier(BaseModel):
    modifier_id: str
    quantity: int = 1


class PublicItem(BaseModel):
    product_id: str
    variant_id: Optional[str] = None
    quantity: int = Field(1, ge=1, le=50)
    modifier_ids: List[str] = []
    note: str = ""


class PublicOrderIn(BaseModel):
    location_id: str
    order_type: Literal["DELIVERY", "TAKEAWAY"] = "DELIVERY"
    customer_name: str = Field(min_length=2)
    customer_phone: str = Field(min_length=6)
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    payment_method: Literal["online", "cash"] = "online"
    items: List[PublicItem] = Field(min_length=1)
    note: str = ""


async def build_items_from_catalog(tenant_id: str, items: List[PublicItem]) -> List[dict]:
    """Server-side pricing – never trust client amounts."""
    out = []
    for it in items:
        p = await db.products.find_one({"id": it.product_id, "tenant_id": tenant_id})
        if not p:
            raise HTTPException(400, f"Produkt {it.product_id} nie istnieje")
        variants = p.get("variants", [])
        v = next((x for x in variants if x["id"] == it.variant_id), None) or (variants[0] if variants else None)
        if not v:
            raise HTTPException(400, f"Produkt {p['name']} nie ma ceny")
        mods = []
        for mid in it.modifier_ids:
            m = next((x for x in p.get("modifiers", []) if x["id"] == mid), None)
            if m:
                mods.append({"modifier_id": m["id"], "name": m["name"], "kind": m["kind"], "price": m.get("price", 0.0)})
        out.append({
            "product_id": p["id"], "product_name": p["name"], "variant_id": v["id"], "variant_name": v["name"],
            "unit_price": v["price"], "quantity": it.quantity, "modifiers": mods, "note": it.note,
        })
    return out


@store_router.post("/public/store/{slug}/orders")
async def public_create_order(slug: str, body: PublicOrderIn):
    t = await resolve_tenant(slug)
    s = await get_settings(t["id"])
    if not s["online_ordering_enabled"]:
        raise HTTPException(403, "Zamówienia online są wyłączone")
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": t["id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    if body.order_type == "DELIVERY" and not body.customer_address:
        raise HTTPException(400, "Podaj adres dostawy")
    if body.payment_method == "cash" and not s["accept_cash"]:
        raise HTTPException(400, "Płatność gotówką niedostępna")
    items = await build_items_from_catalog(t["id"], body.items)
    subtotal = sum((i["unit_price"] + sum(m["price"] for m in i["modifiers"] if m["kind"] == "ADD")) * i["quantity"] for i in items)
    if subtotal < s["min_order"]:
        raise HTTPException(400, f"Minimalna wartość zamówienia to {s['min_order']:.2f} zł")
    online = body.payment_method == "online"
    order = await persist_order(
        t["id"], loc, items, body.customer_name,
        status="pending_payment" if online else "new",
        extra={"delivery_fee": s["delivery_fee"] if body.order_type == "DELIVERY" else 0.0,
               "customer_email": body.customer_email},
        order_type=body.order_type, source="ECOMMERCE", customer_name=body.customer_name,
        customer_phone=body.customer_phone, customer_address=body.customer_address, note=body.note,
        payment_status="pending" if online else "cash",
        payment_provider=s["payment_provider"] if online else None,
    )
    return public_order_view(order)


def public_order_view(o: dict) -> dict:
    keys = ("id", "number", "status", "payment_status", "payment_provider", "order_type", "items", "totals",
            "customer_name", "created_at", "status_history", "location_id")
    return {k: o.get(k) for k in keys}


@store_router.get("/public/orders/{oid}")
async def public_get_order(oid: str):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Nie znaleziono")
    return public_order_view(o)


class CheckoutIn(BaseModel):
    order_id: str
    origin_url: str


@store_router.post("/public/store/{slug}/checkout")
async def public_checkout(slug: str, body: CheckoutIn, request: Request):
    t = await resolve_tenant(slug)
    s = await get_settings(t["id"])
    o = await db.orders.find_one({"id": body.order_id, "tenant_id": t["id"]})
    if not o or o["status"] != "pending_payment":
        raise HTTPException(400, "Zamówienie nie oczekuje na płatność")
    existing = await db.payment_transactions.find_one({"order_id": o["id"], "payment_status": "pending"})
    if existing and existing.get("checkout_url"):
        return {"checkout_url": existing["checkout_url"], "session_id": existing["session_id"], "provider": existing["provider"]}
    provider = s["payment_provider"]
    amount = float(o["totals"]["gross"])
    success = f"{body.origin_url}/s/{t['slug']}/payment/success?session_id={{SESSION}}"
    cancel = f"{body.origin_url}/s/{t['slug']}/payment/cancel?order_id={o['id']}"
    if provider == "payu":
        res = await payu_create_order(t, s, o, amount, success, cancel, request)
    else:
        res = stripe_create_session(t, o, amount, success, cancel)
    await db.payment_transactions.insert_one({
        "id": new_id(), "tenant_id": t["id"], "order_id": o["id"], "provider": provider,
        "session_id": res["session_id"], "checkout_url": res["checkout_url"], "amount": amount, "currency": "pln",
        "status": "initiated", "payment_status": "pending", "created_at": now_iso(), "updated_at": now_iso(),
        **res.get("extra", {}),
    })
    await db.orders.update_one({"id": o["id"]}, {"$set": {"payment_session_id": res["session_id"]}})
    return {"checkout_url": res["checkout_url"], "session_id": res["session_id"], "provider": provider}


def stripe_create_session(t: dict, o: dict, amount: float, success: str, cancel: str) -> dict:
    line_items = []
    for it in o["items"]:
        unit = it["unit_price"] + sum(m["price"] for m in it.get("modifiers", []) if m["kind"] == "ADD")
        name = it["product_name"] + (f" ({it['variant_name']})" if it.get("variant_name") else "")
        line_items.append({"quantity": it["quantity"], "price_data": {
            "currency": "pln", "unit_amount": int(round(unit * 100)), "tax_behavior": "inclusive",
            "product_data": {"name": name, "tax_code": FOOD_TAX_CODE}}})
    fee = o["totals"].get("delivery_fee", 0)
    if fee:
        line_items.append({"quantity": 1, "price_data": {
            "currency": "pln", "unit_amount": int(round(fee * 100)), "tax_behavior": "inclusive",
            "product_data": {"name": "Dostawa", "tax_code": FOOD_TAX_CODE}}})
    kwargs = dict(
        line_items=line_items, mode="payment",
        success_url=success.replace("{SESSION}", "{CHECKOUT_SESSION_ID}"), cancel_url=cancel,
        metadata={"order_id": o["id"], "tenant_id": t["id"]},
    )
    try:
        session = stripe.checkout.Session.create(**kwargs, automatic_tax={"enabled": True},
                                                 billing_address_collection="required")
    except stripe.error.InvalidRequestError as e:
        log.warning(f"Stripe automatic tax unavailable, fallback: {e}")
        session = stripe.checkout.Session.create(**kwargs)
    return {"session_id": session.id, "checkout_url": session.url}


def payu_host(s: dict) -> str:
    return "https://secure.snd.payu.com" if s["payu"].get("sandbox", True) else "https://secure.payu.com"


_payu_tokens: Dict[str, tuple] = {}


async def payu_token(tenant_id: str, s: dict) -> str:
    cached = _payu_tokens.get(tenant_id)
    if cached and cached[1] > time.time() + 60:
        return cached[0]
    c = s["payu"]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{payu_host(s)}/pl/standard/user/oauth/authorize",
                              data={"grant_type": "client_credentials", "client_id": dec(c["client_id_enc"]),
                                    "client_secret": dec(c["client_secret_enc"])})
    if r.is_error:
        raise HTTPException(502, f"PayU OAuth: {r.text[:300]}")
    d = r.json()
    _payu_tokens[tenant_id] = (d["access_token"], time.time() + int(d.get("expires_in", 3600)))
    return d["access_token"]


async def payu_create_order(t: dict, s: dict, o: dict, amount: float, success: str, cancel: str, request: Request) -> dict:
    if not s.get("payu"):
        raise HTTPException(400, "PayU nie jest skonfigurowane dla tego sklepu")
    token = await payu_token(t["id"], s)
    ext_id = f"payu_{o['id']}_{secrets.token_hex(3)}"
    base = str(request.base_url).rstrip("/")
    names = (o.get("customer_name") or "Klient").split(" ", 1)
    payload = {
        "notifyUrl": f"{base}/api/payments/payu/notify/{t['id']}",
        "continueUrl": success.replace("{SESSION}", ext_id),
        "customerIp": request.client.host if request.client else "127.0.0.1",
        "merchantPosId": dec(s["payu"]["pos_id_enc"]),
        "description": f"{t['name']} – zamówienie #{o['number']}",
        "currencyCode": "PLN",
        "totalAmount": str(int(round(amount * 100))),
        "extOrderId": ext_id,
        "buyer": {"email": o.get("customer_email") or "klient@example.com", "firstName": names[0],
                  "lastName": names[1] if len(names) > 1 else "-", "phone": o.get("customer_phone"), "language": "pl"},
        "products": [{"name": it["product_name"], "unitPrice": str(int(round(it["unit_price"] * 100))),
                      "quantity": it["quantity"]} for it in o["items"]],
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        r = await client.post(f"{payu_host(s)}/api/v2_1/orders", json=payload,
                              headers={"Authorization": f"Bearer {token}"})
    if r.status_code not in (200, 201, 302):
        raise HTTPException(502, f"PayU order: {r.text[:500]}")
    d = r.json()
    url = d.get("redirectUri") or r.headers.get("location")
    return {"session_id": ext_id, "checkout_url": url, "extra": {"payu_order_id": d.get("orderId")}}


async def mark_paid(session_id: str, extra: Optional[dict] = None):
    """Idempotent: flip transaction to paid and release order to KDS."""
    res = await db.payment_transactions.find_one_and_update(
        {"session_id": session_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso(), **(extra or {})}})
    if not res:
        return
    o = await db.orders.find_one({"id": res["order_id"]})
    if o and o["status"] == "pending_payment":
        await db.orders.update_one({"id": o["id"]}, {"$set": {"payment_status": "paid", "paid_at": now_iso()}})
        o["payment_status"] = "paid"
        await transition_order(o, "new", "Płatność online")


async def mark_failed(session_id: str, status: str):
    await db.payment_transactions.update_one({"session_id": session_id, "payment_status": {"$ne": "paid"}},
                                             {"$set": {"status": status, "payment_status": status, "updated_at": now_iso()}})
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if tx:
        o = await db.orders.find_one({"id": tx["order_id"]})
        if o and o["status"] == "pending_payment":
            await db.orders.update_one({"id": o["id"]}, {"$set": {"payment_status": status}})


@store_router.get("/public/payments/status/{session_id}")
async def public_payment_status(session_id: str):
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(404, "Transakcja nie istnieje")
    if tx["payment_status"] != "paid":
        try:
            if tx["provider"] == "stripe":
                sess = stripe.checkout.Session.retrieve(session_id)
                if sess.payment_status == "paid" or sess.status == "complete":
                    await mark_paid(session_id, {"stripe_payment_intent_id": sess.payment_intent})
                elif sess.status == "expired":
                    await mark_failed(session_id, "expired")
            elif tx["provider"] == "payu" and tx.get("payu_order_id"):
                s = await get_settings(tx["tenant_id"])
                token = await payu_token(tx["tenant_id"], s)
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.get(f"{payu_host(s)}/api/v2_1/orders/{tx['payu_order_id']}",
                                         headers={"Authorization": f"Bearer {token}"})
                if r.status_code == 200:
                    st = (r.json().get("orders") or [{}])[0].get("status")
                    if st == "COMPLETED":
                        await mark_paid(session_id)
                    elif st == "CANCELED":
                        await mark_failed(session_id, "failed")
        except Exception as e:
            log.warning(f"payment status check: {e}")
        tx = await db.payment_transactions.find_one({"session_id": session_id})
    return {"session_id": session_id, "status": tx["status"], "payment_status": tx["payment_status"],
            "order_id": tx["order_id"], "provider": tx["provider"]}


@store_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj, t = event["data"]["object"], event["type"]
    if t in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        if obj.get("payment_status", "paid") == "paid":
            await mark_paid(obj["id"], {"stripe_payment_intent_id": obj.get("payment_intent")})
    elif t == "checkout.session.async_payment_failed":
        await mark_failed(obj["id"], "failed")
    elif t == "checkout.session.expired":
        await mark_failed(obj["id"], "expired")
    elif t == "charge.refunded":
        await db.payment_transactions.update_one({"stripe_payment_intent_id": obj.get("payment_intent")},
                                                 {"$set": {"status": "refunded", "payment_status": "refunded", "updated_at": now_iso()}})
    return {"status": "ok"}


@store_router.post("/payments/payu/notify/{tenant_id}")
async def payu_notify(tenant_id: str, request: Request, openpayu_signature: Optional[str] = Header(default=None)):
    raw = await request.body()
    s = await get_settings(tenant_id)
    if not s.get("payu"):
        raise HTTPException(400, "PayU not configured")
    m = re.search(r"signature=([0-9a-fA-F]+)", openpayu_signature or "")
    expected = hashlib.md5(raw + dec(s["payu"]["md5_enc"]).encode()).hexdigest()
    if not m or not hmac.compare_digest(expected.lower(), m.group(1).lower()):
        raise HTTPException(400, "Invalid PayU signature")
    event = await request.json()
    order = event.get("order", {})
    ext_id, status = order.get("extOrderId"), order.get("status")
    if status == "COMPLETED":
        await mark_paid(ext_id, {"payu_order_id": order.get("orderId")})
    elif status == "CANCELED":
        await mark_failed(ext_id, "failed")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Pyszne.pl aggregator – Order Ingestion + Menu Push
# ---------------------------------------------------------------------------
pyszne_router = APIRouter(prefix="/api/integrations/pyszne")


class PyszneConfigIn(BaseModel):
    location_id: str
    enabled: Optional[bool] = None
    restaurant_id: Optional[str] = None
    menu_push_url: Optional[str] = None
    auto_accept: Optional[bool] = None


class PyszneExtra(BaseModel):
    name: str
    price: float = 0.0


class PyszneItem(BaseModel):
    sku: Optional[str] = None
    name: str
    quantity: int = Field(1, ge=1)
    unit_price: float
    remarks: str = ""
    extras: List[PyszneExtra] = []


class PyszneCustomer(BaseModel):
    name: str = "Klient Pyszne.pl"
    phone: Optional[str] = None
    address: Optional[str] = None


class PyszneOrderIn(BaseModel):
    order_id: str
    placed_at: Optional[str] = None
    delivery_type: Literal["delivery", "pickup"] = "delivery"
    customer: PyszneCustomer = PyszneCustomer()
    items: List[PyszneItem] = Field(min_length=1)
    total: Optional[float] = None
    payment: Literal["paid_online", "cash"] = "paid_online"
    remarks: str = ""


def pyszne_cfg(loc: dict) -> dict:
    cfg = (loc.get("integrations") or {}).get("pyszne") or {}
    return {"enabled": cfg.get("enabled", False), "api_key": cfg.get("api_key"), "restaurant_id": cfg.get("restaurant_id", ""),
            "menu_push_url": cfg.get("menu_push_url", ""), "auto_accept": cfg.get("auto_accept", True),
            "last_push_at": cfg.get("last_push_at"), "last_push_status": cfg.get("last_push_status")}


@pyszne_router.get("")
async def pyszne_get(location_id: str, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    cfg = pyszne_cfg(loc)
    recent = await db.orders.find({"tenant_id": user["tenant_id"], "location_id": location_id, "source": "AGGREGATOR"}) \
        .sort("created_at", -1).to_list(10)
    return {**cfg, "location_id": location_id, "recent_orders": [strip_mongo(o) for o in recent]}


@pyszne_router.put("")
async def pyszne_update(body: PyszneConfigIn, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    patch = {f"integrations.pyszne.{k}": v for k, v in body.model_dump(exclude={"location_id"}).items() if v is not None}
    if patch:
        await db.locations.update_one({"id": loc["id"]}, {"$set": patch})
    return await pyszne_get(body.location_id, user)


@pyszne_router.post("/generate-key")
async def pyszne_generate_key(body: PyszneConfigIn, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    key = "pysz_" + secrets.token_urlsafe(24)
    await db.locations.update_one({"id": loc["id"]}, {"$set": {"integrations.pyszne.api_key": key,
                                                                "integrations.pyszne.enabled": True}})
    return await pyszne_get(body.location_id, user)


async def build_menu_export(tenant_id: str, loc: dict) -> dict:
    cats = await db.categories.find({"tenant_id": tenant_id}).sort("sort", 1).to_list(200)
    prods = await db.products.find({"tenant_id": tenant_id, "available_online": {"$ne": False}}).to_list(2000)
    cfg = pyszne_cfg(loc)
    return {
        "restaurantId": cfg["restaurant_id"] or loc["id"],
        "restaurantName": loc["name"],
        "currency": "PLN",
        "generatedAt": now_iso(),
        "categories": [{
            "id": c["id"], "name": c["name"],
            "products": [{
                "id": p["id"], "sku": p.get("sku") or p["id"], "name": p["name"], "description": p.get("description", ""),
                "variants": [{"id": v["id"], "sku": v.get("sku") or f"{p.get('sku') or p['id']}-{v['id'][:8]}",
                              "name": v["name"], "price": v["price"]} for v in p.get("variants", [])],
                "extras": [{"id": m["id"], "name": m["name"], "price": m.get("price", 0.0)}
                           for m in p.get("modifiers", []) if m.get("kind") == "ADD"],
                "removableIngredients": [m["name"] for m in p.get("modifiers", []) if m.get("kind") == "REMOVE"],
            } for p in prods if p["category_id"] == c["id"]],
        } for c in cats],
    }


@pyszne_router.get("/menu-export")
async def pyszne_menu_export(location_id: str, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    return await build_menu_export(user["tenant_id"], loc)


@pyszne_router.post("/menu-push")
async def pyszne_menu_push(body: PyszneConfigIn, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    cfg = pyszne_cfg(loc)
    menu = await build_menu_export(user["tenant_id"], loc)
    status = "simulated"
    if cfg["menu_push_url"]:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(cfg["menu_push_url"], json=menu, headers={"X-Api-Key": cfg["api_key"] or ""})
            status = f"http_{r.status_code}"
        except Exception as e:
            status = f"error: {str(e)[:120]}"
    await db.locations.update_one({"id": loc["id"]}, {"$set": {"integrations.pyszne.last_push_at": now_iso(),
                                                                "integrations.pyszne.last_push_status": status}})
    await db.integration_logs.insert_one({"id": new_id(), "tenant_id": user["tenant_id"], "location_id": loc["id"],
                                          "provider": "pyszne", "type": "menu_push", "status": status,
                                          "products": sum(len(c["products"]) for c in menu["categories"]), "at": now_iso()})
    return {"status": status, "products": sum(len(c["products"]) for c in menu["categories"]), "pushed_at": now_iso()}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


async def map_pyszne_items(tenant_id: str, items: List[PyszneItem]) -> List[dict]:
    prods = await db.products.find({"tenant_id": tenant_id}).to_list(2000)
    out = []
    for it in items:
        prod, var = None, None
        if it.sku:
            for p in prods:
                if p.get("sku") == it.sku or p["id"] == it.sku:
                    prod = p
                    break
                for v in p.get("variants", []):
                    if v.get("sku") == it.sku or f"{p.get('sku') or p['id']}-{v['id'][:8]}" == it.sku or v["id"] == it.sku:
                        prod, var = p, v
                        break
                if prod:
                    break
        if not prod:
            n = _norm(it.name)
            for p in prods:
                pn = _norm(p["name"])
                if n == pn or n.startswith(pn + " ") or n.startswith(pn + " -") or n.startswith(pn + " ("):
                    prod = p
                    rest = n[len(pn):].strip(" -()")
                    var = next((v for v in p.get("variants", []) if _norm(v["name"]) == rest), None)
                    break
        if not prod:
            out.append({"product_id": "unmapped", "product_name": f"{it.name} (NIEZMAPOWANE)", "variant_id": None,
                        "variant_name": None, "unit_price": it.unit_price, "quantity": it.quantity, "modifiers": [],
                        "note": it.remarks, "unmapped": True})
            continue
        variants = prod.get("variants", [])
        var = var or next((v for v in variants if abs(v["price"] - it.unit_price) < 0.01), None) or (variants[0] if variants else None)
        mods = []
        for ex in it.extras:
            m = next((x for x in prod.get("modifiers", []) if _norm(x["name"]) == _norm(ex.name)), None)
            mods.append({"modifier_id": m["id"] if m else "ext", "name": ex.name, "kind": m["kind"] if m else "ADD",
                         "price": ex.price})
        out.append({"product_id": prod["id"], "product_name": prod["name"], "variant_id": var["id"] if var else None,
                    "variant_name": var["name"] if var else None, "unit_price": it.unit_price, "quantity": it.quantity,
                    "modifiers": mods, "note": it.remarks})
    return out


@pyszne_router.post("/orders")
async def pyszne_ingest(body: PyszneOrderIn, x_pyszne_api_key: Optional[str] = Header(default=None)):
    if not x_pyszne_api_key:
        raise HTTPException(401, "Missing X-Pyszne-Api-Key")
    loc = await db.locations.find_one({"integrations.pyszne.api_key": x_pyszne_api_key})
    if not loc or not pyszne_cfg(loc)["enabled"]:
        raise HTTPException(401, "Invalid or disabled API key")
    tenant_id = loc["tenant_id"]
    dup = await db.orders.find_one({"tenant_id": tenant_id, "external_id": body.order_id, "aggregator": "pyszne"})
    if dup:
        return {"accepted": True, "duplicate": True, "order_id": dup["id"], "number": dup["number"]}
    items = await map_pyszne_items(tenant_id, body.items)
    order = await persist_order(
        tenant_id, loc, items, "Pyszne.pl",
        extra={"aggregator": "pyszne", "external_id": body.order_id, "external_placed_at": body.placed_at,
               "external_total": body.total, "unmapped_items": sum(1 for i in items if i.get("unmapped"))},
        order_type="DELIVERY" if body.delivery_type == "delivery" else "TAKEAWAY", source="AGGREGATOR",
        customer_name=body.customer.name, customer_phone=body.customer.phone, customer_address=body.customer.address,
        note=body.remarks, payment_status="paid" if body.payment == "paid_online" else "cash",
        payment_provider="pyszne" if body.payment == "paid_online" else None,
    )
    await db.integration_logs.insert_one({"id": new_id(), "tenant_id": tenant_id, "location_id": loc["id"],
                                          "provider": "pyszne", "type": "order_ingest", "external_id": body.order_id,
                                          "order_id": order["id"], "unmapped": order["unmapped_items"], "at": now_iso()})
    return {"accepted": True, "duplicate": False, "order_id": order["id"], "number": order["number"],
            "unmapped_items": order["unmapped_items"]}


@pyszne_router.post("/test-order")
async def pyszne_test_order(body: PyszneConfigIn, request: Request, user: dict = Depends(require_roles("owner", "manager"))):
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Lokal nie istnieje")
    cfg = pyszne_cfg(loc)
    if not cfg["api_key"]:
        raise HTTPException(400, "Najpierw wygeneruj klucz API")
    prods = await db.products.find({"tenant_id": user["tenant_id"]}).to_list(3)
    if not prods:
        raise HTTPException(400, "Brak produktów w menu")
    items = []
    for p in prods[:2]:
        v = (p.get("variants") or [{"name": "", "price": 0}])[0]
        items.append(PyszneItem(sku=p.get("sku"), name=f"{p['name']} {v['name']}".strip(), quantity=1,
                                unit_price=v["price"], remarks="Test z panelu inGastro"))
    items.append(PyszneItem(name="Pozycja testowa spoza menu", quantity=1, unit_price=12.5))
    payload = PyszneOrderIn(order_id=f"TEST-{secrets.token_hex(3).upper()}", placed_at=now_iso(),
                            customer=PyszneCustomer(name="Jan Testowy", phone="+48 600 000 000",
                                                    address="ul. Testowa 1, Kraków"),
                            items=items, total=sum(i.unit_price * i.quantity for i in items), remarks="Zamówienie testowe")
    return await pyszne_ingest(payload, x_pyszne_api_key=cfg["api_key"])


# ---------------------------------------------------------------------------
# Seed – ingredients, recipes, stock for demo tenant
# ---------------------------------------------------------------------------
async def seed_extensions():
    t = await db.tenants.find_one({"slug": "pizzeria-savona"})
    if not t or await db.ingredients.find_one({"tenant_id": t["id"]}):
        return
    tid = t["id"]
    ing_defs = [
        ("Mąka 00", "g", 0.004, 5000), ("Mozzarella fior di latte", "g", 0.035, 2000),
        ("Sos pomidorowy San Marzano", "ml", 0.012, 3000), ("Szynka parmeńska", "g", 0.12, 500),
        ("Salami pikantne", "g", 0.08, 500), ("Gorgonzola", "g", 0.06, 500), ("Parmezan", "g", 0.09, 500),
        ("Bazylia", "g", 0.15, 50), ("Spaghetti", "g", 0.01, 2000), ("Guanciale", "g", 0.11, 300),
        ("Jajka", "szt", 0.9, 30), ("Coca-Cola 0.33", "szt", 2.5, 24), ("Woda 0.5", "szt", 1.2, 24),
        ("Mascarpone", "g", 0.045, 500), ("Rukola", "g", 0.08, 200),
    ]
    ings = {}
    for name, unit, cost, min_stock in ing_defs:
        d = {"id": new_id(), "tenant_id": tid, "name": name, "unit": unit, "cost_per_unit": cost,
             "min_stock": min_stock, "created_at": now_iso()}
        ings[name] = d
    await db.ingredients.insert_many(list(ings.values()))

    prods = await db.products.find({"tenant_id": tid}).to_list(100)
    by_name = {p["name"]: p for p in prods}

    def size_lines(p, base):
        lines = []
        for v in p.get("variants", []):
            mult = {"30 cm": 1.0, "40 cm": 1.6, "50 cm": 2.4}.get(v["name"], 1.0)
            for name, qty in base:
                lines.append({"ingredient_id": ings[name]["id"], "qty": round(qty * mult, 1), "variant_id": v["id"]})
        return lines

    recipes = {
        "Margherita": lambda p: size_lines(p, [("Mąka 00", 250), ("Mozzarella fior di latte", 120), ("Sos pomidorowy San Marzano", 80), ("Bazylia", 3)]),
        "Prosciutto": lambda p: size_lines(p, [("Mąka 00", 250), ("Mozzarella fior di latte", 110), ("Sos pomidorowy San Marzano", 80), ("Szynka parmeńska", 60)]),
        "Diavola": lambda p: size_lines(p, [("Mąka 00", 250), ("Mozzarella fior di latte", 110), ("Sos pomidorowy San Marzano", 80), ("Salami pikantne", 70)]),
        "Quattro Formaggi": lambda p: size_lines(p, [("Mąka 00", 250), ("Mozzarella fior di latte", 80), ("Gorgonzola", 50), ("Parmezan", 30)]),
        "Spaghetti Carbonara": lambda p: [{"ingredient_id": ings["Spaghetti"]["id"], "qty": 180, "variant_id": None},
                                          {"ingredient_id": ings["Guanciale"]["id"], "qty": 60, "variant_id": None},
                                          {"ingredient_id": ings["Jajka"]["id"], "qty": 2, "variant_id": None}],
        "Coca-Cola 0.33": lambda p: [{"ingredient_id": ings["Coca-Cola 0.33"]["id"], "qty": 1, "variant_id": None}],
        "Woda Mineralna 0.5": lambda p: [{"ingredient_id": ings["Woda 0.5"]["id"], "qty": 1, "variant_id": None}],
        "Tiramisu": lambda p: [{"ingredient_id": ings["Mascarpone"]["id"], "qty": 90, "variant_id": None},
                               {"ingredient_id": ings["Jajka"]["id"], "qty": 1, "variant_id": None}],
    }
    for name, fn in recipes.items():
        p = by_name.get(name)
        if p:
            patch = {"recipe": fn(p), "sku": f"SAV-{name[:3].upper()}"}
            if name in ("Margherita", "Prosciutto", "Diavola", "Quattro Formaggi"):
                mods = p.get("modifiers", [])
                for m in mods:
                    if m["name"] == "Dodatkowy ser":
                        m["ingredient_id"], m["ingredient_qty"] = ings["Mozzarella fior di latte"]["id"], 50
                    if m["name"] == "Rukola":
                        m["ingredient_id"], m["ingredient_qty"] = ings["Rukola"]["id"], 20
                    if m["name"] == "Prosciutto":
                        m["ingredient_id"], m["ingredient_qty"] = ings["Szynka parmeńska"]["id"], 40
                patch["modifiers"] = mods
            await db.products.update_one({"id": p["id"]}, {"$set": patch})

    locs = await db.locations.find({"tenant_id": tid}).to_list(10)
    opening = {"Mąka 00": 25000, "Mozzarella fior di latte": 8000, "Sos pomidorowy San Marzano": 10000,
               "Szynka parmeńska": 1500, "Salami pikantne": 1200, "Gorgonzola": 900, "Parmezan": 900, "Bazylia": 150,
               "Spaghetti": 6000, "Guanciale": 800, "Jajka": 90, "Coca-Cola 0.33": 72, "Woda 0.5": 60,
               "Mascarpone": 1500, "Rukola": 400}
    for loc in locs:
        for name, qty in opening.items():
            await record_movement(tid, loc["id"], ings[name]["id"], qty, "delivery", note="Stan otwarcia", by="System")
    await db.tenant_settings.update_one({"tenant_id": tid}, {"$set": {**DEFAULT_SETTINGS, "store_description":
        "Neapolitańska pizza z pieca opalanego drewnem. Dostawa w 40 minut na terenie Krakowa."}}, upsert=True)
    log.info("Seeded inventory/BOM + store settings for Pizzeria Savona")
