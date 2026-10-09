"""Iteration 3 backend tests: Super Admin panel, RCP time tracking, Courier app, SMS (mock)."""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://gastro-cloud-os.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


# ---------- shared fixtures ----------
@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@savona.pl", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "balordini@gmail.com", "password": "superadmin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def owner_auth(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="session")
def admin_auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def tenant_info():
    return requests.get(f"{API}/public/tenant/pizzeria-savona").json()


@pytest.fixture(scope="session")
def loc_id(owner_auth):
    locs = requests.get(f"{API}/locations", headers=owner_auth).json()
    return locs[0]["id"]


# ---------- Super Admin ----------
class TestSuperAdmin:
    def test_login_role_superadmin(self, admin_token):
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {admin_token}"}).json()
        assert me["user"]["role"] == "superadmin"

    def test_overview_kpis(self, admin_auth):
        r = requests.get(f"{API}/admin/overview", headers=admin_auth)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("tenants", "users", "orders", "mrr", "sms_sent", "sms_revenue"):
            assert k in d
        assert d["tenants"] >= 1

    def test_get_and_update_config(self, admin_auth):
        c = requests.get(f"{API}/admin/config", headers=admin_auth)
        assert c.status_code == 200
        cfg = c.json()
        assert any(m["key"] == "rcp" for m in cfg["modules"])
        # Change rcp price and sms price
        upd = {
            "modules": [{"key": "rcp", "monthly_price": 42.0, "enabled": True}],
            "sms_price": 0.25,
            "sms_enabled": True,
        }
        r = requests.put(f"{API}/admin/config", json=upd, headers=admin_auth)
        assert r.status_code == 200, r.text
        new_cfg = r.json()
        rcp = next(m for m in new_cfg["modules"] if m["key"] == "rcp")
        assert rcp["monthly_price"] == 42.0
        assert new_cfg["sms_price"] == 0.25
        # restore
        requests.put(f"{API}/admin/config", json={"modules": [{"key": "rcp", "monthly_price": 39.0}], "sms_price": 0.20, "sms_enabled": True}, headers=admin_auth)

    def test_tenants_list(self, admin_auth):
        r = requests.get(f"{API}/admin/tenants", headers=admin_auth)
        assert r.status_code == 200
        rows = r.json()
        assert any(t["slug"] == "pizzeria-savona" for t in rows)

    def test_tenant_module_toggle_affects_me(self, admin_auth, owner_token):
        t = next(x for x in requests.get(f"{API}/admin/tenants", headers=admin_auth).json() if x["slug"] == "pizzeria-savona")
        tid = t["id"]
        # Disable inventory
        r = requests.put(f"{API}/admin/tenants/{tid}", json={"modules": {"inventory": False}}, headers=admin_auth)
        assert r.status_code == 200
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {owner_token}"}).json()
        mods = (me.get("tenant") or {}).get("modules") or {}
        got = mods.get("inventory", True)
        assert got is False, f"inventory should be disabled on tenant, me={me}"
        # Re-enable
        r2 = requests.put(f"{API}/admin/tenants/{tid}", json={"modules": {"inventory": True}}, headers=admin_auth)
        assert r2.status_code == 200
        me2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {owner_token}"}).json()
        mods2 = (me2.get("tenant") or {}).get("modules") or {}
        assert mods2.get("inventory", True) is True

    def test_sms_log(self, admin_auth):
        r = requests.get(f"{API}/admin/sms", headers=admin_auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_non_admin_cannot_access(self, owner_auth):
        r = requests.get(f"{API}/admin/overview", headers=owner_auth)
        assert r.status_code == 403


# ---------- RCP ----------
class TestRCP:
    def test_wrong_pin_rejected(self, owner_auth, loc_id):
        # Owner can call /rcp/clock via get_actor
        r = requests.post(f"{API}/rcp/clock", json={"pin": "0000", "location_id": loc_id}, headers=owner_auth)
        assert r.status_code == 401

    def test_clock_in_then_out(self, owner_auth, loc_id):
        r1 = requests.post(f"{API}/rcp/clock", json={"pin": "2222", "location_id": loc_id}, headers=owner_auth)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        # First call: may be clock_in OR clock_out depending on prior state. Normalize: ensure after we have an open, then close.
        if d1["action"] == "clock_out":
            # already closed, open new
            r_open = requests.post(f"{API}/rcp/clock", json={"pin": "2222", "location_id": loc_id}, headers=owner_auth)
            assert r_open.json()["action"] == "clock_in"
        # Verify active list has this employee
        active = requests.get(f"{API}/rcp/active?location_id={loc_id}", headers=owner_auth).json()
        assert any(a["employee_name"] == "Piotr Wiśniewski" for a in active)
        # Clock out
        r2 = requests.post(f"{API}/rcp/clock", json={"pin": "2222", "location_id": loc_id}, headers=owner_auth)
        assert r2.status_code == 200
        assert r2.json()["action"] == "clock_out"

    def test_entries_and_report(self, owner_auth):
        r = requests.get(f"{API}/rcp/entries", headers=owner_auth)
        assert r.status_code == 200
        rep = requests.get(f"{API}/rcp/report", headers=owner_auth)
        assert rep.status_code == 200
        d = rep.json()
        assert "rows" in d and "total_hours" in d


# ---------- SMS tenant settings ----------
class TestSmsSettings:
    def test_toggle_and_get(self, owner_auth):
        on = requests.put(f"{API}/sms/settings", json={"enabled": True}, headers=owner_auth)
        assert on.status_code == 200
        assert on.json()["tenant_enabled"] is True
        g = requests.get(f"{API}/sms/settings", headers=owner_auth)
        assert g.status_code == 200
        d = g.json()
        assert d["platform_enabled"] in (True, False)
        assert "price" in d and "sent_total" in d

    def test_disable(self, owner_auth):
        r = requests.put(f"{API}/sms/settings", json={"enabled": False}, headers=owner_auth)
        assert r.status_code == 200
        assert r.json()["tenant_enabled"] is False


# ---------- Courier (end to end: PIN login -> depart -> delivered -> SMS logged) ----------
class TestCourier:
    def _create_delivery_order(self, owner_auth, loc_id):
        prods = requests.get(f"{API}/menu/products", headers=owner_auth).json()
        marg = next(p for p in prods if p["name"] == "Margherita")
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")
        payload = {
            "location_id": loc_id, "order_type": "DELIVERY",
            "customer_name": "TEST Kurier Klient", "customer_phone": "+48600111222",
            "customer_address": "ul. Testowa 1, Kraków",
            "items": [{"product_id": marg["id"], "product_name": marg["name"],
                       "variant_id": v30["id"], "variant_name": v30["name"],
                       "unit_price": v30["price"], "quantity": 1, "modifiers": []}],
        }
        r = requests.post(f"{API}/orders", json=payload, headers=owner_auth)
        assert r.status_code in (200, 201), r.text
        return r.json()

    def _advance(self, owner_auth, oid, status):
        r = requests.put(f"{API}/orders/{oid}/status", json={"status": status}, headers=owner_auth)
        assert r.status_code == 200, r.text

    def _courier_token(self, tenant_info):
        tid = tenant_info["id"]
        r = requests.post(f"{API}/auth/pin-login", json={"tenant_id": tid, "pin": "4444"})
        assert r.status_code == 200, r.text
        return r.json()["token"]

    def test_pin_login_courier_ok(self, tenant_info):
        tok = self._courier_token(tenant_info)
        assert tok

    def test_pin_login_non_courier_still_logs_in(self, tenant_info):
        # 2222 is waiter – pin-login should succeed but role != courier -> courier endpoints 403
        r = requests.post(f"{API}/auth/pin-login", json={"tenant_id": tenant_info["id"], "pin": "2222"})
        assert r.status_code == 200
        tok = r.json()["token"]
        resp = requests.get(f"{API}/courier/deliveries", headers={"Authorization": f"Bearer {tok}"})
        assert resp.status_code == 403

    def test_pin_login_bad_pin(self, tenant_info):
        r = requests.post(f"{API}/auth/pin-login", json={"tenant_id": tenant_info["id"], "pin": "0000"})
        assert r.status_code in (401, 400)

    def test_depart_sms_enabled_logs(self, owner_auth, loc_id, tenant_info, admin_auth):
        # Enable SMS globally + tenant
        requests.put(f"{API}/admin/config", json={"sms_enabled": True, "sms_price": 0.20}, headers=admin_auth)
        requests.put(f"{API}/sms/settings", json={"enabled": True}, headers=owner_auth)
        order = self._create_delivery_order(owner_auth, loc_id)
        oid = order["id"]
        self._advance(owner_auth, oid, "in_progress")
        self._advance(owner_auth, oid, "ready")

        tok = self._courier_token(tenant_info)
        auth = {"Authorization": f"Bearer {tok}"}
        # Deliveries list must contain our order
        dels = requests.get(f"{API}/courier/deliveries", headers=auth).json()
        assert any(d["id"] == oid for d in dels), f"order not in queue: {dels}"

        before_sms = requests.get(f"{API}/sms/settings", headers=owner_auth).json()["sent_total"]
        rd = requests.post(f"{API}/courier/deliveries/{oid}/depart", headers=auth)
        assert rd.status_code == 200, rd.text
        body = rd.json()
        assert body["sms"]["sent"] is True
        assert body["order"]["status"] == "in_delivery"
        after_sms = requests.get(f"{API}/sms/settings", headers=owner_auth).json()["sent_total"]
        assert after_sms == before_sms + 1

        rdl = requests.post(f"{API}/courier/deliveries/{oid}/delivered", headers=auth)
        assert rdl.status_code == 200
        assert rdl.json()["order"]["status"] == "completed"

    def test_depart_sms_disabled_no_log(self, owner_auth, loc_id, tenant_info):
        requests.put(f"{API}/sms/settings", json={"enabled": False}, headers=owner_auth)
        order = self._create_delivery_order(owner_auth, loc_id)
        oid = order["id"]
        self._advance(owner_auth, oid, "in_progress")
        self._advance(owner_auth, oid, "ready")
        tok = self._courier_token(tenant_info)
        auth = {"Authorization": f"Bearer {tok}"}
        before = requests.get(f"{API}/sms/settings", headers=owner_auth).json()["sent_total"]
        rd = requests.post(f"{API}/courier/deliveries/{oid}/depart", headers=auth)
        assert rd.status_code == 200
        assert rd.json()["sms"]["sent"] is False
        after = requests.get(f"{API}/sms/settings", headers=owner_auth).json()["sent_total"]
        assert after == before
        # cleanup -> delivered
        requests.post(f"{API}/courier/deliveries/{oid}/delivered", headers=auth)


# ---------- Public tenant resolve ----------
def test_public_tenant_resolve():
    r = requests.get(f"{API}/public/tenant/pizzeria-savona")
    assert r.status_code == 200
    d = r.json()
    assert d["slug"] == "pizzeria-savona"
    assert "courier_enabled" in d


def test_zz_restore(owner_token):
    auth = {"Authorization": f"Bearer {owner_token}"}
    requests.put(f"{API}/sms/settings", json={"enabled": True}, headers=auth)
