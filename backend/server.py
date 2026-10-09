"""
inGastro Cloud OS – Multi-Tenant Gastronomy ERP SaaS
FastAPI backend with JWT auth, multi-tenant row-level isolation, order state machine,
and real-time WebSocket channels for KDS.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from motor.motor_asyncio import AsyncIOMotorClient

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-super-secret-key-rotate-in-prod-2026")
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60 * 12  # 12h – long lived for POS terminals

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s – %(message)s")
log = logging.getLogger("ingastro")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="inGastro Cloud OS")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


def create_access_token(user_id: str, tenant_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def strip_mongo(doc: dict) -> dict:
    if doc is None:
        return None
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    doc.pop("pin_hash", None)
    return doc


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(auth[7:])
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(401, "User not found")
    user["role"] = payload.get("role", user.get("role"))
    user["tenant_id"] = payload.get("tid", user.get("tenant_id"))
    return strip_mongo(user)


def require_roles(*roles: str):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, f"Role {user.get('role')} not permitted")
        return user
    return _dep


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    tenant_name: str  # creates a new tenant on registration


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PinLoginIn(BaseModel):
    tenant_id: str
    pin: str


class LocationIn(BaseModel):
    name: str
    address: str = ""
    city: str = ""
    phone: str = ""
    vat_rate: float = 23.0


class TableIn(BaseModel):
    location_id: str
    label: str
    seats: int = 2
    x: int = 0
    y: int = 0
    shape: Literal["round", "square"] = "round"


class CategoryIn(BaseModel):
    name: str
    sort: int = 0
    color: str = "#3B82F6"


class ProductVariantIn(BaseModel):
    id: Optional[str] = None
    name: str
    price: float


class ProductModifierIn(BaseModel):
    id: Optional[str] = None
    name: str
    kind: Literal["ADD", "REMOVE"] = "ADD"
    price: float = 0.0


class ProductIn(BaseModel):
    category_id: str
    name: str
    description: str = ""
    image_url: Optional[str] = None
    variants: List[ProductVariantIn] = []
    modifiers: List[ProductModifierIn] = []


class EmployeeIn(BaseModel):
    name: str
    role: Literal["manager", "waiter", "cook", "courier"]
    pin: str = Field(min_length=4, max_length=6)
    hourly_rate: float = 0.0


class OrderModifierItem(BaseModel):
    modifier_id: str
    name: str
    kind: Literal["ADD", "REMOVE"]
    price: float = 0.0


class OrderItemIn(BaseModel):
    product_id: str
    product_name: str
    variant_id: Optional[str] = None
    variant_name: Optional[str] = None
    unit_price: float
    quantity: int = 1
    modifiers: List[OrderModifierItem] = []
    note: str = ""


class OrderIn(BaseModel):
    location_id: str
    order_type: Literal["DINE_IN", "TAKEAWAY", "DELIVERY"] = "DINE_IN"
    source: Literal["POS", "ECOMMERCE", "AGGREGATOR"] = "POS"
    table_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    items: List[OrderItemIn]
    note: str = ""


class OrderStatusUpdate(BaseModel):
    status: Literal["new", "in_progress", "ready", "in_delivery", "completed", "cancelled"]


# ---------------------------------------------------------------------------
# WebSocket connection manager (per-tenant, per-location KDS channels)
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, channel: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(channel, []).append(ws)

    def disconnect(self, channel: str, ws: WebSocket):
        if channel in self.active and ws in self.active[channel]:
            self.active[channel].remove(ws)

    async def broadcast(self, channel: str, message: dict):
        dead = []
        for ws in self.active.get(channel, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(channel, ws)


manager = ConnectionManager()


def kds_channel(tenant_id: str, location_id: str) -> str:
    return f"tenant.{tenant_id}.location.{location_id}.kds"


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")

    tenant_id = new_id()
    tenant_doc = {
        "id": tenant_id,
        "name": body.tenant_name,
        "slug": body.tenant_name.lower().replace(" ", "-")[:40],
        "plan": "trial",
        "created_at": now_iso(),
    }
    await db.tenants.insert_one(tenant_doc)

    user_id = new_id()
    user_doc = {
        "id": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "name": body.name,
        "role": "owner",
        "password_hash": hash_password(body.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)

    token = create_access_token(user_id, tenant_id, "owner")
    return {"token": token, "user": strip_mongo(user_doc), "tenant": strip_mongo(tenant_doc)}


@api.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Nieprawidłowy email lub hasło")

    tenant = await db.tenants.find_one({"id": user["tenant_id"]})
    token = create_access_token(user["id"], user["tenant_id"], user["role"])
    return {"token": token, "user": strip_mongo(user), "tenant": strip_mongo(tenant) if tenant else None}


@api.post("/auth/pin-login")
async def pin_login(body: PinLoginIn):
    emps = await db.employees.find({"tenant_id": body.tenant_id}).to_list(1000)
    for e in emps:
        if verify_password(body.pin, e.get("pin_hash", "")):
            # Return a short-lived employee token (acts as a staff user)
            token = create_access_token(e["id"], body.tenant_id, e["role"])
            return {"token": token, "employee": strip_mongo(e)}
    raise HTTPException(401, "Nieprawidłowy PIN")


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    tenant = await db.tenants.find_one({"id": user["tenant_id"]})
    return {"user": user, "tenant": strip_mongo(tenant) if tenant else None}


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------
@api.get("/locations")
async def list_locations(user: dict = Depends(get_current_user)):
    rows = await db.locations.find({"tenant_id": user["tenant_id"]}).to_list(500)
    return [strip_mongo(r) for r in rows]


@api.post("/locations")
async def create_location(body: LocationIn, user: dict = Depends(require_roles("owner", "manager"))):
    doc = {"id": new_id(), "tenant_id": user["tenant_id"], **body.model_dump(), "created_at": now_iso()}
    await db.locations.insert_one(doc)
    return strip_mongo(doc)


@api.put("/locations/{loc_id}")
async def update_location(loc_id: str, body: LocationIn, user: dict = Depends(require_roles("owner", "manager"))):
    r = await db.locations.update_one(
        {"id": loc_id, "tenant_id": user["tenant_id"]}, {"$set": body.model_dump()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.locations.find_one({"id": loc_id})
    return strip_mongo(doc)


@api.delete("/locations/{loc_id}")
async def delete_location(loc_id: str, user: dict = Depends(require_roles("owner"))):
    await db.locations.delete_one({"id": loc_id, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------
@api.get("/tables")
async def list_tables(location_id: str, user: dict = Depends(get_current_user)):
    rows = await db.tables.find({"tenant_id": user["tenant_id"], "location_id": location_id}).to_list(500)
    return [strip_mongo(r) for r in rows]


@api.post("/tables")
async def create_table(body: TableIn, user: dict = Depends(require_roles("owner", "manager"))):
    doc = {"id": new_id(), "tenant_id": user["tenant_id"], **body.model_dump(), "created_at": now_iso()}
    await db.tables.insert_one(doc)
    return strip_mongo(doc)


@api.put("/tables/{tid}")
async def update_table(tid: str, body: TableIn, user: dict = Depends(require_roles("owner", "manager"))):
    await db.tables.update_one({"id": tid, "tenant_id": user["tenant_id"]}, {"$set": body.model_dump()})
    doc = await db.tables.find_one({"id": tid})
    return strip_mongo(doc)


@api.delete("/tables/{tid}")
async def delete_table(tid: str, user: dict = Depends(require_roles("owner", "manager"))):
    await db.tables.delete_one({"id": tid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Menu – categories & products
# ---------------------------------------------------------------------------
@api.get("/menu/categories")
async def list_categories(user: dict = Depends(get_current_user)):
    rows = await db.categories.find({"tenant_id": user["tenant_id"]}).sort("sort", 1).to_list(500)
    return [strip_mongo(r) for r in rows]


@api.post("/menu/categories")
async def create_category(body: CategoryIn, user: dict = Depends(require_roles("owner", "manager"))):
    doc = {"id": new_id(), "tenant_id": user["tenant_id"], **body.model_dump(), "created_at": now_iso()}
    await db.categories.insert_one(doc)
    return strip_mongo(doc)


@api.delete("/menu/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(require_roles("owner", "manager"))):
    await db.categories.delete_one({"id": cid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


@api.get("/menu/products")
async def list_products(user: dict = Depends(get_current_user)):
    rows = await db.products.find({"tenant_id": user["tenant_id"]}).to_list(1000)
    return [strip_mongo(r) for r in rows]


@api.post("/menu/products")
async def create_product(body: ProductIn, user: dict = Depends(require_roles("owner", "manager"))):
    variants = [{**v.model_dump(), "id": v.id or new_id()} for v in body.variants]
    modifiers = [{**m.model_dump(), "id": m.id or new_id()} for m in body.modifiers]
    doc = {
        "id": new_id(),
        "tenant_id": user["tenant_id"],
        "category_id": body.category_id,
        "name": body.name,
        "description": body.description,
        "image_url": body.image_url,
        "variants": variants,
        "modifiers": modifiers,
        "created_at": now_iso(),
    }
    await db.products.insert_one(doc)
    return strip_mongo(doc)


@api.put("/menu/products/{pid}")
async def update_product(pid: str, body: ProductIn, user: dict = Depends(require_roles("owner", "manager"))):
    variants = [{**v.model_dump(), "id": v.id or new_id()} for v in body.variants]
    modifiers = [{**m.model_dump(), "id": m.id or new_id()} for m in body.modifiers]
    patch = {
        "category_id": body.category_id,
        "name": body.name,
        "description": body.description,
        "image_url": body.image_url,
        "variants": variants,
        "modifiers": modifiers,
    }
    await db.products.update_one({"id": pid, "tenant_id": user["tenant_id"]}, {"$set": patch})
    doc = await db.products.find_one({"id": pid})
    return strip_mongo(doc)


@api.delete("/menu/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_roles("owner", "manager"))):
    await db.products.delete_one({"id": pid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------
@api.get("/employees")
async def list_employees(user: dict = Depends(require_roles("owner", "manager"))):
    rows = await db.employees.find({"tenant_id": user["tenant_id"]}).to_list(500)
    return [strip_mongo(r) for r in rows]


@api.post("/employees")
async def create_employee(body: EmployeeIn, user: dict = Depends(require_roles("owner", "manager"))):
    doc = {
        "id": new_id(),
        "tenant_id": user["tenant_id"],
        "name": body.name,
        "role": body.role,
        "pin_hash": hash_password(body.pin),
        "hourly_rate": body.hourly_rate,
        "created_at": now_iso(),
    }
    await db.employees.insert_one(doc)
    return strip_mongo(doc)


@api.put("/employees/{eid}")
async def update_employee(eid: str, body: EmployeeIn, user: dict = Depends(require_roles("owner", "manager"))):
    patch = {
        "name": body.name,
        "role": body.role,
        "pin_hash": hash_password(body.pin),
        "hourly_rate": body.hourly_rate,
    }
    await db.employees.update_one({"id": eid, "tenant_id": user["tenant_id"]}, {"$set": patch})
    doc = await db.employees.find_one({"id": eid})
    return strip_mongo(doc)


@api.delete("/employees/{eid}")
async def delete_employee(eid: str, user: dict = Depends(require_roles("owner"))):
    await db.employees.delete_one({"id": eid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Orders – State Machine
# ---------------------------------------------------------------------------
STATE_TRANSITIONS = {
    "new": {"in_progress", "cancelled"},
    "in_progress": {"ready", "cancelled"},
    "ready": {"in_delivery", "completed", "cancelled"},
    "in_delivery": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


async def next_order_number(tenant_id: str, location_id: str) -> int:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = f"{tenant_id}:{location_id}:{today}"
    r = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return r["seq"]


def compute_totals(items: List[dict], vat_rate: float = 23.0) -> dict:
    gross = 0.0
    for it in items:
        line = it["unit_price"] * it["quantity"]
        for m in it.get("modifiers", []):
            if m.get("kind") == "ADD":
                line += m.get("price", 0.0) * it["quantity"]
        gross += line
    net = round(gross / (1 + vat_rate / 100), 2)
    vat = round(gross - net, 2)
    return {"gross": round(gross, 2), "net": net, "vat": vat}


@api.get("/orders")
async def list_orders(location_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100,
                      user: dict = Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": user["tenant_id"]}
    if location_id:
        q["location_id"] = location_id
    if status:
        q["status"] = status
    rows = await db.orders.find(q).sort("created_at", -1).to_list(limit)
    return [strip_mongo(r) for r in rows]


@api.get("/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"id": oid, "tenant_id": user["tenant_id"]})
    if not o:
        raise HTTPException(404, "Not found")
    return strip_mongo(o)


@api.post("/orders")
async def create_order(body: OrderIn, user: dict = Depends(get_current_user)):
    loc = await db.locations.find_one({"id": body.location_id, "tenant_id": user["tenant_id"]})
    if not loc:
        raise HTTPException(404, "Location not found")

    items = []
    for it in body.items:
        d = it.model_dump()
        items.append(d)
    totals = compute_totals(items, loc.get("vat_rate", 23.0))
    seq = await next_order_number(user["tenant_id"], body.location_id)

    doc = {
        "id": new_id(),
        "tenant_id": user["tenant_id"],
        "location_id": body.location_id,
        "number": seq,
        "order_type": body.order_type,
        "source": body.source,
        "table_id": body.table_id,
        "customer_name": body.customer_name,
        "customer_phone": body.customer_phone,
        "customer_address": body.customer_address,
        "items": items,
        "note": body.note,
        "status": "new",
        "created_by": user.get("id"),
        "created_by_name": user.get("name"),
        "totals": totals,
        "status_history": [{"status": "new", "at": now_iso(), "by": user.get("name")}],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.orders.insert_one(doc)

    await manager.broadcast(kds_channel(user["tenant_id"], body.location_id), {
        "event": "order.created",
        "order": strip_mongo({**doc}),
    })
    return strip_mongo(doc)


@api.put("/orders/{oid}/status")
async def update_order_status(oid: str, body: OrderStatusUpdate, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"id": oid, "tenant_id": user["tenant_id"]})
    if not o:
        raise HTTPException(404, "Not found")
    current = o["status"]
    if body.status not in STATE_TRANSITIONS[current]:
        raise HTTPException(400, f"Niedozwolone przejście {current} → {body.status}")

    history = o.get("status_history", [])
    history.append({"status": body.status, "at": now_iso(), "by": user.get("name")})
    await db.orders.update_one(
        {"id": oid},
        {"$set": {"status": body.status, "updated_at": now_iso(), "status_history": history}},
    )
    o["status"] = body.status
    o["status_history"] = history
    o["updated_at"] = now_iso()

    await manager.broadcast(kds_channel(user["tenant_id"], o["location_id"]), {
        "event": "order.status",
        "order": strip_mongo({**o}),
    })
    return strip_mongo(o)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
@api.get("/analytics/dashboard")
async def dashboard_analytics(location_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    q: Dict[str, Any] = {"tenant_id": user["tenant_id"]}
    if location_id:
        q["location_id"] = location_id

    today_q = {**q, "created_at": {"$gte": today}}
    today_orders = await db.orders.find(today_q).to_list(5000)
    revenue_today = sum(o.get("totals", {}).get("gross", 0) for o in today_orders if o.get("status") != "cancelled")

    active_q = {**q, "status": {"$in": ["new", "in_progress", "ready", "in_delivery"]}}
    active_orders = await db.orders.count_documents(active_q)

    # last 7 days revenue chart
    chart = []
    for i in range(6, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        day_q = {**q, "created_at": {"$gte": day, "$lt": day + "T23:59:59"}}
        day_orders = await db.orders.find(day_q).to_list(5000)
        rev = sum(o.get("totals", {}).get("gross", 0) for o in day_orders if o.get("status") != "cancelled")
        chart.append({"date": day[5:], "revenue": round(rev, 2), "orders": len(day_orders)})

    # status breakdown today
    status_counts: Dict[str, int] = {}
    for o in today_orders:
        s = o.get("status", "new")
        status_counts[s] = status_counts.get(s, 0) + 1

    return {
        "revenue_today": round(revenue_today, 2),
        "orders_today": len(today_orders),
        "active_orders": active_orders,
        "avg_ticket": round(revenue_today / max(len(today_orders), 1), 2),
        "chart_7d": chart,
        "status_breakdown": status_counts,
    }


# ---------------------------------------------------------------------------
# WebSocket for KDS
# ---------------------------------------------------------------------------
@app.websocket("/api/ws/kds")
async def ws_kds(ws: WebSocket, token: str, location_id: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        await ws.close(code=4401)
        return
    tenant_id = payload["tid"]
    ch = kds_channel(tenant_id, location_id)
    await manager.connect(ch, ws)
    try:
        while True:
            # Keep-alive; clients don't need to send anything.
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ch, ws)
    except Exception:
        manager.disconnect(ch, ws)


# ---------------------------------------------------------------------------
# Seed demo data on startup
# ---------------------------------------------------------------------------
async def seed_demo():
    """Create demo tenant Pizzeria Savona with menu, tables, employees if not present."""
    existing = await db.tenants.find_one({"slug": "pizzeria-savona"})
    if existing:
        return
    tenant_id = new_id()
    tenant = {
        "id": tenant_id,
        "name": "Pizzeria Savona",
        "slug": "pizzeria-savona",
        "plan": "demo",
        "created_at": now_iso(),
    }
    await db.tenants.insert_one(tenant)

    # Owner demo account
    owner_id = new_id()
    await db.users.insert_one({
        "id": owner_id,
        "tenant_id": tenant_id,
        "email": "demo@savona.pl",
        "name": "Marco Savona",
        "role": "owner",
        "password_hash": hash_password("demo1234"),
        "created_at": now_iso(),
    })

    # Two locations
    loc1_id, loc2_id = new_id(), new_id()
    await db.locations.insert_many([
        {"id": loc1_id, "tenant_id": tenant_id, "name": "Savona Centrum",
         "address": "ul. Floriańska 12", "city": "Kraków", "phone": "+48 500 100 100",
         "vat_rate": 23.0, "created_at": now_iso()},
        {"id": loc2_id, "tenant_id": tenant_id, "name": "Savona Kazimierz",
         "address": "ul. Szeroka 5", "city": "Kraków", "phone": "+48 500 100 200",
         "vat_rate": 23.0, "created_at": now_iso()},
    ])

    # Tables for loc1
    tables = []
    for i in range(1, 11):
        tables.append({
            "id": new_id(), "tenant_id": tenant_id, "location_id": loc1_id,
            "label": f"S{i}", "seats": 2 if i % 2 else 4,
            "x": (i - 1) % 5, "y": (i - 1) // 5,
            "shape": "round" if i % 2 else "square",
            "created_at": now_iso(),
        })
    await db.tables.insert_many(tables)

    # Categories
    cats = [
        {"id": new_id(), "tenant_id": tenant_id, "name": "Pizza", "sort": 1, "color": "#EF4444", "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Pasta", "sort": 2, "color": "#F59E0B", "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Sałatki", "sort": 3, "color": "#10B981", "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Napoje", "sort": 4, "color": "#3B82F6", "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Desery", "sort": 5, "color": "#A855F7", "created_at": now_iso()},
    ]
    await db.categories.insert_many(cats)
    cat_pizza, cat_pasta, cat_salad, cat_drink, cat_dessert = [c["id"] for c in cats]

    def product(name, cat_id, variants, modifiers=None, desc="", img=None):
        return {
            "id": new_id(), "tenant_id": tenant_id, "category_id": cat_id,
            "name": name, "description": desc, "image_url": img,
            "variants": [{"id": new_id(), **v} for v in variants],
            "modifiers": [{"id": new_id(), **m} for m in (modifiers or [])],
            "created_at": now_iso(),
        }

    pizza_mods = [
        {"name": "Cebula", "kind": "REMOVE", "price": 0},
        {"name": "Oliwki", "kind": "REMOVE", "price": 0},
        {"name": "Dodatkowy ser", "kind": "ADD", "price": 6.0},
        {"name": "Rukola", "kind": "ADD", "price": 4.0},
        {"name": "Prosciutto", "kind": "ADD", "price": 9.0},
    ]
    pizza_sizes = [{"name": "30 cm", "price": 32.0}, {"name": "40 cm", "price": 44.0}, {"name": "50 cm", "price": 56.0}]

    products = [
        product("Margherita", cat_pizza, pizza_sizes, pizza_mods,
                "Pomidory San Marzano, mozzarella fior di latte, bazylia"),
        product("Prosciutto", cat_pizza, pizza_sizes, pizza_mods,
                "Mozzarella, pieczarki, szynka parmeńska"),
        product("Diavola", cat_pizza, pizza_sizes, pizza_mods,
                "Salami pikantne, oliwki, chilli"),
        product("Quattro Formaggi", cat_pizza, pizza_sizes, pizza_mods,
                "Cztery sery: mozzarella, gorgonzola, parmezan, pecorino"),
        product("Spaghetti Carbonara", cat_pasta, [{"name": "Standard", "price": 38.0}], [
            {"name": "Dodatkowy boczek", "kind": "ADD", "price": 7.0},
            {"name": "Bez cebuli", "kind": "REMOVE", "price": 0},
        ], "Guanciale, pecorino romano, żółtko, pieprz"),
        product("Penne Arrabbiata", cat_pasta, [{"name": "Standard", "price": 34.0}], [], "Ostry sos pomidorowy, czosnek, chilli"),
        product("Caprese", cat_salad, [{"name": "Standard", "price": 28.0}], [], "Mozzarella di bufala, pomidor, bazylia"),
        product("Cesare", cat_salad, [{"name": "Standard", "price": 32.0}], [
            {"name": "Kurczak", "kind": "ADD", "price": 9.0},
        ], "Sałata rzymska, parmezan, grzanki, sos cezar"),
        product("Coca-Cola 0.33", cat_drink, [{"name": "Puszka", "price": 8.0}], []),
        product("Woda Mineralna 0.5", cat_drink, [{"name": "Gazowana", "price": 6.0}, {"name": "Niegazowana", "price": 6.0}], []),
        product("Tiramisu", cat_dessert, [{"name": "Porcja", "price": 18.0}], [], "Klasyczne tiramisu z mascarpone"),
    ]
    await db.products.insert_many(products)

    # Employees with PINs
    await db.employees.insert_many([
        {"id": new_id(), "tenant_id": tenant_id, "name": "Anna Nowak", "role": "manager",
         "pin_hash": hash_password("1234"), "hourly_rate": 45.0, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Piotr Wiśniewski", "role": "waiter",
         "pin_hash": hash_password("2222"), "hourly_rate": 30.0, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Luca Rossi", "role": "cook",
         "pin_hash": hash_password("3333"), "hourly_rate": 38.0, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tenant_id, "name": "Jakub Kowalczyk", "role": "courier",
         "pin_hash": hash_password("4444"), "hourly_rate": 28.0, "created_at": now_iso()},
    ])

    log.info(f"Seeded demo tenant Pizzeria Savona (tenant_id={tenant_id})")


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.tenants.create_index("slug", unique=True)
    except Exception as e:
        log.warning(f"Index creation: {e}")
    await seed_demo()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


@api.get("/")
async def root():
    return {"service": "inGastro Cloud OS", "status": "ok"}


app.include_router(api)
