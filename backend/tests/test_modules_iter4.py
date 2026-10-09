"""Iteration 4 backend tests: SaaS invoices (admin), courier GPS locations, geocoding."""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://gastro-cloud-os.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


# ---------- shared fixtures ----------
@pytest.fixture(scope="session")
def admin_auth():
    r = requests.post(f"{API}/auth/login", json={"email": "balordini@gmail.com", "password": "superadmin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def owner_auth():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@savona.pl", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def tenant_info():
    return requests.get(f"{API}/public/tenant/pizzeria-savona").json()


@pytest.fixture(scope="session")
def courier_token(tenant_info):
    r = requests.post(f"{API}/auth/pin-login", json={"tenant_id": tenant_info["id"], "pin": "4444"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def waiter_token(tenant_info):
    r = requests.post(f"{API}/auth/pin-login", json={"tenant_id": tenant_info["id"], "pin": "2222"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def loc_id(owner_auth):
    locs = requests.get(f"{API}/locations", headers=owner_auth).json()
    return locs[0]["id"]


@pytest.fixture(scope="session")
def current_period():
    import datetime
    return datetime.datetime.utcnow().strftime("%Y-%m")


# ---------- SaaS Invoices ----------
class TestInvoices:
    def test_generate_invoices_current_period(self, admin_auth, current_period):
        r = requests.post(f"{API}/admin/invoices/generate", json={"period": current_period}, headers=admin_auth)
        assert r.status_code == 200, r.text
        invs = r.json()
        assert isinstance(invs, list) and len(invs) >= 1
        for inv in invs:
            assert inv["period"] == current_period
            assert "number" in inv and inv["number"].startswith(f"FV/{current_period}/")
            assert "total" in inv and inv["total"] >= 0
            assert "status" in inv
            assert "lines" in inv

    def test_invoices_list_filter_by_period(self, admin_auth, current_period):
        r = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth)
        assert r.status_code == 200
        rows = r.json()
        assert all(x["period"] == current_period for x in rows)
        assert len(rows) >= 1

    def test_summary_matches_invoices(self, admin_auth):
        r = requests.get(f"{API}/admin/invoices/summary", headers=admin_auth)
        assert r.status_code == 200
        s = r.json()
        for k in ("outstanding", "paid", "total", "count", "unpaid_count"):
            assert k in s
        # Sanity: outstanding + paid == total (within rounding)
        assert abs((s["outstanding"] + s["paid"]) - s["total"]) < 0.01

    def test_idempotent_generation(self, admin_auth, current_period):
        """Generating twice for same period must not duplicate and must preserve 'paid' status."""
        # Grab one invoice, mark paid
        rows = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth).json()
        assert rows, "no invoices from previous test"
        target = rows[0]
        before_count = len(rows)
        upd = requests.put(f"{API}/admin/invoices/{target['id']}", json={"status": "paid"}, headers=admin_auth)
        assert upd.status_code == 200
        assert upd.json()["status"] == "paid"

        # Regenerate
        r = requests.post(f"{API}/admin/invoices/generate", json={"period": current_period}, headers=admin_auth)
        assert r.status_code == 200

        # Row count for this period must remain
        rows2 = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth).json()
        assert len(rows2) == before_count, f"duplicates: before={before_count}, after={len(rows2)}"

        # Target must still be 'paid'
        same = next((x for x in rows2 if x["id"] == target["id"]), None)
        assert same is not None
        assert same["status"] == "paid", "paid status not preserved on regenerate"

    def test_status_toggle_updates_summary(self, admin_auth, current_period):
        rows = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth).json()
        paid_inv = next((x for x in rows if x["status"] == "paid"), None)
        assert paid_inv, "need a paid invoice from previous test"

        s_before = requests.get(f"{API}/admin/invoices/summary", headers=admin_auth).json()
        # toggle paid -> unpaid
        r = requests.put(f"{API}/admin/invoices/{paid_inv['id']}", json={"status": "unpaid"}, headers=admin_auth)
        assert r.status_code == 200
        assert r.json()["status"] == "unpaid"
        s_after = requests.get(f"{API}/admin/invoices/summary", headers=admin_auth).json()
        # outstanding should increase by invoice total, paid should decrease
        assert round(s_after["outstanding"] - s_before["outstanding"], 2) == round(paid_inv["total"], 2)
        assert round(s_before["paid"] - s_after["paid"], 2) == round(paid_inv["total"], 2)

    def test_pdf_download(self, admin_auth, current_period):
        rows = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth).json()
        inv = rows[0]
        r = requests.get(f"{API}/admin/invoices/{inv['id']}/pdf", headers=admin_auth)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 500
        assert r.content[:4] == b"%PDF"

    def test_module_disabled_omitted_from_invoice(self, admin_auth, current_period):
        """Disable 'inventory' module on pizzeria-savona and ensure line disappears after regenerate."""
        tenants = requests.get(f"{API}/admin/tenants", headers=admin_auth).json()
        t = next(x for x in tenants if x["slug"] == "pizzeria-savona")

        # Get platform price for inventory
        cfg = requests.get(f"{API}/admin/config", headers=admin_auth).json()
        inv_mod = next(m for m in cfg["modules"] if m["key"] == "inventory")
        inv_price = inv_mod["monthly_price"]

        # Disable inventory for this tenant
        r = requests.put(f"{API}/admin/tenants/{t['id']}", json={"modules": {"inventory": False}}, headers=admin_auth)
        assert r.status_code == 200

        try:
            # Regenerate (idempotent) – should rebuild lines but keep status
            requests.post(f"{API}/admin/invoices/generate", json={"period": current_period}, headers=admin_auth)
            rows = requests.get(f"{API}/admin/invoices", params={"period": current_period}, headers=admin_auth).json()
            inv = next(x for x in rows if x["tenant_id"] == t["id"])
            labels = [ln["label"] for ln in inv["lines"]]
            assert inv_mod["label"] not in labels, f"inventory still on invoice: {labels}"
        finally:
            # Re-enable
            requests.put(f"{API}/admin/tenants/{t['id']}", json={"modules": {"inventory": True}}, headers=admin_auth)

    def test_non_admin_cannot_access(self, owner_auth):
        r = requests.get(f"{API}/admin/invoices", headers=owner_auth)
        assert r.status_code == 403
        r2 = requests.post(f"{API}/admin/invoices/generate", json={"period": "2026-01"}, headers=owner_auth)
        assert r2.status_code == 403


# ---------- Courier GPS ----------
class TestCourierGPS:
    def test_courier_can_post_location(self, courier_token):
        auth = {"Authorization": f"Bearer {courier_token}"}
        r = requests.post(f"{API}/courier/location", json={"lat": 50.0614, "lng": 19.9372}, headers=auth)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_owner_can_list_locations_with_online(self, owner_auth, courier_token):
        auth = {"Authorization": f"Bearer {courier_token}"}
        # Post a fresh location
        requests.post(f"{API}/courier/location", json={"lat": 50.0614, "lng": 19.9372}, headers=auth)
        time.sleep(0.3)
        r = requests.get(f"{API}/courier/locations", headers=owner_auth)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # Must contain the courier Jakub Kowalczyk, online
        jakub = next((x for x in rows if x.get("name") == "Jakub Kowalczyk"), None)
        assert jakub is not None, f"courier not in list: {rows}"
        assert jakub["online"] is True
        assert abs(jakub["lat"] - 50.0614) < 0.001

    def test_courier_cannot_list_locations(self, courier_token):
        auth = {"Authorization": f"Bearer {courier_token}"}
        r = requests.get(f"{API}/courier/locations", headers=auth)
        assert r.status_code == 403

    def test_waiter_cannot_post_location(self, waiter_token):
        auth = {"Authorization": f"Bearer {waiter_token}"}
        r = requests.post(f"{API}/courier/location", json={"lat": 50.0, "lng": 20.0}, headers=auth)
        assert r.status_code == 403


# ---------- Geocoding ----------
class TestGeocoding:
    def _create_delivery(self, owner_auth, loc_id, address):
        prods = requests.get(f"{API}/menu/products", headers=owner_auth).json()
        marg = next(p for p in prods if p["name"] == "Margherita")
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")
        payload = {
            "location_id": loc_id, "order_type": "DELIVERY",
            "customer_name": "TEST GeoClient", "customer_phone": "+48600111222",
            "customer_address": address,
            "items": [{"product_id": marg["id"], "product_name": marg["name"],
                       "variant_id": v30["id"], "variant_name": v30["name"],
                       "unit_price": v30["price"], "quantity": 1, "modifiers": []}],
        }
        r = requests.post(f"{API}/orders", json=payload, headers=owner_auth)
        assert r.status_code in (200, 201), r.text
        oid = r.json()["id"]
        requests.put(f"{API}/orders/{oid}/status", json={"status": "in_progress"}, headers=owner_auth)
        requests.put(f"{API}/orders/{oid}/status", json={"status": "ready"}, headers=owner_auth)
        return oid

    def test_geocode_real_krakow_address(self, owner_auth, loc_id):
        oid = self._create_delivery(owner_auth, loc_id, "Rynek Główny 1, Kraków")
        # First call primes geocoding (Nominatim ~1 req/s). Retry once.
        geo = None
        for attempt in range(3):
            dels = requests.get(f"{API}/courier/deliveries", headers=owner_auth).json()
            o = next((x for x in dels if x["id"] == oid), None)
            assert o is not None
            if o.get("geo"):
                geo = o["geo"]
                break
            time.sleep(1.2)
        assert geo is not None, "geocode never resolved for real address"
        assert 49.0 < geo["lat"] < 51.0 and 19.0 < geo["lng"] < 21.0
        # Cleanup
        requests.put(f"{API}/orders/{oid}/status", json={"status": "completed"}, headers=owner_auth)

    def test_geocode_unresolvable_returns_null_not_500(self, owner_auth, loc_id):
        oid = self._create_delivery(owner_auth, loc_id, "zzzzzzzzzzzzz1234nonexistentplanetX, Kraków")
        r = requests.get(f"{API}/courier/deliveries", headers=owner_auth)
        assert r.status_code == 200
        o = next((x for x in r.json() if x["id"] == oid), None)
        assert o is not None
        assert o.get("geo") is None
        # Cleanup
        requests.put(f"{API}/orders/{oid}/status", json={"status": "completed"}, headers=owner_auth)


# ---------- Module gating public ----------
def test_public_tenant_courier_flag():
    r = requests.get(f"{API}/public/tenant/pizzeria-savona")
    assert r.status_code == 200
    assert "courier_enabled" in r.json()
