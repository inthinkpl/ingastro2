"""Backend tests for inGastro extensions: settings, inventory/BOM, public store, Pyszne.pl."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://gastro-cloud-os.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@savona.pl", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def locations(auth):
    r = requests.get(f"{API}/locations", headers=auth)
    assert r.status_code == 200
    locs = r.json()
    assert len(locs) >= 1
    return locs


@pytest.fixture(scope="session")
def loc_id(locations):
    return locations[0]["id"]


# --- Settings ---

class TestSettings:
    def test_get_settings_has_slug(self, auth):
        r = requests.get(f"{API}/settings", headers=auth)
        assert r.status_code == 200
        d = r.json()
        assert d["slug"] == "pizzeria-savona"
        assert "stock_deduction_mode" in d
        assert "payu" in d

    def test_put_settings_toggle_fields(self, auth):
        r = requests.put(f"{API}/settings", json={"stock_deduction_mode": "on_create", "delivery_fee": 9.0, "min_order": 30.0}, headers=auth)
        assert r.status_code == 200
        d = r.json()
        assert d["stock_deduction_mode"] == "on_create"
        assert d["delivery_fee"] == 9.0

    def test_payu_requires_creds(self, auth):
        # Clear first
        requests.put(f"{API}/settings", json={"clear_payu": True, "payment_provider": "stripe"}, headers=auth)
        r = requests.put(f"{API}/settings", json={"payment_provider": "payu"}, headers=auth)
        assert r.status_code == 400

    def test_payu_configure_then_select(self, auth):
        creds = {"pos_id": "123456", "md5_second_key": "md5key", "client_id": "cid", "client_secret": "csec", "sandbox": True}
        r = requests.put(f"{API}/settings", json={"payu": creds, "payment_provider": "payu"}, headers=auth)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["payment_provider"] == "payu"
        assert d["payu"]["configured"] is True

    def test_clear_payu_resets(self, auth):
        r = requests.put(f"{API}/settings", json={"clear_payu": True, "payment_provider": "stripe"}, headers=auth)
        assert r.status_code == 200
        assert r.json()["payu"]["configured"] is False


# --- Inventory ---

class TestInventory:
    def test_list_ingredients(self, auth):
        r = requests.get(f"{API}/inventory/ingredients", headers=auth)
        assert r.status_code == 200
        assert any(i["name"] == "Mąka 00" for i in r.json())

    def test_crud_ingredient(self, auth):
        r = requests.post(f"{API}/inventory/ingredients", json={"name": "TEST_sol", "unit": "g", "cost_per_unit": 0.01, "min_stock": 10}, headers=auth)
        assert r.status_code == 200
        iid = r.json()["id"]
        r2 = requests.put(f"{API}/inventory/ingredients/{iid}", json={"name": "TEST_sol2", "unit": "g", "cost_per_unit": 0.02, "min_stock": 5}, headers=auth)
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_sol2"
        r3 = requests.delete(f"{API}/inventory/ingredients/{iid}", headers=auth)
        assert r3.status_code == 200

    def test_stock_and_movements(self, auth, loc_id):
        r = requests.get(f"{API}/inventory/stock?location_id={loc_id}", headers=auth)
        assert r.status_code == 200
        rows = r.json()
        maka = next(x for x in rows if x["name"] == "Mąka 00")
        start = maka["qty"]
        # delivery +500
        r2 = requests.post(f"{API}/inventory/movements", json={"location_id": loc_id, "ingredient_id": maka["id"], "qty": 500, "type": "delivery", "note": "TEST"}, headers=auth)
        assert r2.status_code == 200
        # waste 100
        r3 = requests.post(f"{API}/inventory/movements", json={"location_id": loc_id, "ingredient_id": maka["id"], "qty": 100, "type": "waste"}, headers=auth)
        assert r3.status_code == 200
        r4 = requests.get(f"{API}/inventory/stock?location_id={loc_id}", headers=auth)
        maka2 = next(x for x in r4.json() if x["name"] == "Mąka 00")
        assert abs(maka2["qty"] - (start + 400)) < 0.01

    def test_movements_list(self, auth, loc_id):
        r = requests.get(f"{API}/inventory/movements?location_id={loc_id}", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_alerts(self, auth, loc_id):
        r = requests.get(f"{API}/inventory/alerts?location_id={loc_id}", headers=auth)
        assert r.status_code == 200


# --- Stock deduction on order ---

class TestStockDeduction:
    def _margherita(self, auth):
        r = requests.get(f"{API}/menu/products", headers=auth)
        for p in r.json():
            if p["name"] == "Margherita":
                return p
        pytest.fail("Margherita not found")

    def _maka_qty(self, auth, loc_id):
        r = requests.get(f"{API}/inventory/stock?location_id={loc_id}", headers=auth)
        return next(x for x in r.json() if x["name"] == "Mąka 00")

    def test_on_create_deduction_and_cancel_return(self, auth, loc_id):
        # Ensure on_create
        requests.put(f"{API}/settings", json={"stock_deduction_mode": "on_create"}, headers=auth)
        marg = self._margherita(auth)
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")
        before = self._maka_qty(auth, loc_id)["qty"]
        payload = {"location_id": loc_id, "order_type": "DINE_IN", "customer_name": "TEST",
                   "items": [{"product_id": marg["id"], "product_name": marg["name"], "variant_id": v30["id"],
                              "variant_name": v30["name"], "unit_price": v30["price"], "quantity": 1, "modifiers": []}]}
        r = requests.post(f"{API}/orders", json=payload, headers=auth)
        assert r.status_code in (200, 201), r.text
        order = r.json()
        after = self._maka_qty(auth, loc_id)["qty"]
        assert abs((before - after) - 250) < 0.1, f"expected -250 on create, got {before-after}"
        # Verify order-type movement
        mv = requests.get(f"{API}/inventory/movements?location_id={loc_id}", headers=auth).json()
        assert any(m["type"] == "order" and m["ref"] == f"#{order['number']}" for m in mv)
        # Cancel
        rc = requests.put(f"{API}/orders/{order['id']}/status", json={"status": "cancelled"}, headers=auth)
        assert rc.status_code == 200, rc.text
        after2 = self._maka_qty(auth, loc_id)["qty"]
        assert abs(after2 - before) < 0.1, f"stock not restored: before={before} after2={after2}"
        mv2 = requests.get(f"{API}/inventory/movements?location_id={loc_id}", headers=auth).json()
        assert any(m["type"] == "cancel_return" and m["ref"] == f"#{order['number']}" for m in mv2)

    def test_on_ready_deduction(self, auth, loc_id):
        requests.put(f"{API}/settings", json={"stock_deduction_mode": "on_ready"}, headers=auth)
        marg = self._margherita(auth)
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")
        before = self._maka_qty(auth, loc_id)["qty"]
        r = requests.post(f"{API}/orders", json={"location_id": loc_id, "order_type": "DINE_IN", "customer_name": "TEST",
                                                 "items": [{"product_id": marg["id"], "product_name": marg["name"],
                                                            "variant_id": v30["id"], "variant_name": v30["name"],
                                                            "unit_price": v30["price"], "quantity": 1, "modifiers": []}]}, headers=auth)
        assert r.status_code in (200, 201)
        order = r.json()
        mid = self._maka_qty(auth, loc_id)["qty"]
        assert abs(mid - before) < 0.1, "should NOT deduct on create when on_ready"
        requests.put(f"{API}/orders/{order['id']}/status", json={"status": "in_progress"}, headers=auth)
        r2 = requests.put(f"{API}/orders/{order['id']}/status", json={"status": "ready"}, headers=auth)
        assert r2.status_code == 200
        after = self._maka_qty(auth, loc_id)["qty"]
        assert abs((before - after) - 250) < 0.1, f"expected -250 on ready, got {before-after}"
        # Reset to on_create
        requests.put(f"{API}/settings", json={"stock_deduction_mode": "on_create"}, headers=auth)


# --- Public store ---

class TestPublicStore:
    def test_public_store_ok(self):
        r = requests.get(f"{API}/public/store/pizzeria-savona")
        assert r.status_code == 200
        d = r.json()
        assert d["tenant"]["slug"] == "pizzeria-savona"
        assert len(d["locations"]) >= 1
        assert len(d["products"]) >= 1
        assert all("recipe" not in p for p in d["products"])

    def test_unknown_slug_404(self):
        r = requests.get(f"{API}/public/store/unknown-slug-xyz")
        assert r.status_code == 404

    def test_cash_order_min_order_delivery_address(self, auth):
        store = requests.get(f"{API}/public/store/pizzeria-savona").json()
        loc_id = store["locations"][0]["id"]
        marg = next(p for p in store["products"] if p["name"] == "Margherita")
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")

        # Below min: pick a cheap small item - actually Margherita 30cm might be above 30. Use quantity 0? Use Woda
        woda = next((p for p in store["products"] if "Woda" in p["name"]), None)
        if woda:
            r_low = requests.post(f"{API}/public/store/pizzeria-savona/orders", json={
                "location_id": loc_id, "order_type": "DELIVERY", "customer_name": "TEST", "customer_phone": "600000000",
                "customer_address": "ul. Testowa 1", "payment_method": "cash",
                "items": [{"product_id": woda["id"], "variant_id": woda["variants"][0]["id"], "quantity": 1, "modifier_ids": []}]})
            assert r_low.status_code == 400

        # DELIVERY without address
        r_no_addr = requests.post(f"{API}/public/store/pizzeria-savona/orders", json={
            "location_id": loc_id, "order_type": "DELIVERY", "customer_name": "TEST", "customer_phone": "600000000",
            "payment_method": "cash",
            "items": [{"product_id": marg["id"], "variant_id": v30["id"], "quantity": 2, "modifier_ids": []}]})
        assert r_no_addr.status_code == 400

        # Valid cash order
        r_ok = requests.post(f"{API}/public/store/pizzeria-savona/orders", json={
            "location_id": loc_id, "order_type": "DELIVERY", "customer_name": "TEST Klient", "customer_phone": "600000000",
            "customer_address": "ul. Testowa 1, Kraków", "payment_method": "cash",
            "items": [{"product_id": marg["id"], "variant_id": v30["id"], "quantity": 2, "modifier_ids": []}]})
        assert r_ok.status_code == 200, r_ok.text
        o = r_ok.json()
        assert o["status"] == "new"
        assert o["totals"].get("delivery_fee") == 9.0

    def test_online_order_pending_payment_and_checkout(self, auth):
        store = requests.get(f"{API}/public/store/pizzeria-savona").json()
        loc_id = store["locations"][0]["id"]
        marg = next(p for p in store["products"] if p["name"] == "Margherita")
        v30 = next(v for v in marg["variants"] if v["name"] == "30 cm")
        r_on = requests.post(f"{API}/public/store/pizzeria-savona/orders", json={
            "location_id": loc_id, "order_type": "DELIVERY", "customer_name": "TEST Online", "customer_phone": "600000000",
            "customer_address": "ul. Testowa 1", "payment_method": "online",
            "items": [{"product_id": marg["id"], "variant_id": v30["id"], "quantity": 2, "modifier_ids": []}]})
        assert r_on.status_code == 200, r_on.text
        order = r_on.json()
        assert order["status"] == "pending_payment"
        # Not in new list
        new_list = requests.get(f"{API}/orders?status=new", headers=auth).json()
        assert not any(o["id"] == order["id"] for o in new_list)

        # Public order view
        pub = requests.get(f"{API}/public/orders/{order['id']}")
        assert pub.status_code == 200

        # Checkout
        r_co = requests.post(f"{API}/public/store/pizzeria-savona/checkout",
                             json={"order_id": order["id"], "origin_url": BASE})
        assert r_co.status_code == 200, r_co.text
        d1 = r_co.json()
        assert d1["checkout_url"].startswith("https://checkout.stripe.com")
        assert d1["session_id"]
        # Idempotency
        r_co2 = requests.post(f"{API}/public/store/pizzeria-savona/checkout",
                              json={"order_id": order["id"], "origin_url": BASE})
        assert r_co2.json()["session_id"] == d1["session_id"]
        # Status pending
        st = requests.get(f"{API}/public/payments/status/{d1['session_id']}")
        assert st.status_code == 200
        assert st.json()["payment_status"] == "pending"


# --- Pyszne.pl ---

class TestPyszne:
    def test_generate_key_and_get(self, auth, loc_id):
        r = requests.post(f"{API}/integrations/pyszne/generate-key", json={"location_id": loc_id}, headers=auth)
        assert r.status_code == 200, r.text
        key = r.json()["api_key"]
        assert key.startswith("pysz_")
        g = requests.get(f"{API}/integrations/pyszne?location_id={loc_id}", headers=auth)
        assert g.status_code == 200
        assert g.json()["api_key"] == key

    def test_webhook_auth(self, auth, loc_id):
        # no key
        r = requests.post(f"{API}/integrations/pyszne/orders", json={"order_id": "X", "items": [{"name": "x", "quantity": 1, "unit_price": 10}]})
        assert r.status_code == 401
        # wrong key
        r2 = requests.post(f"{API}/integrations/pyszne/orders",
                           json={"order_id": "X", "items": [{"name": "x", "quantity": 1, "unit_price": 10}]},
                           headers={"X-Pyszne-Api-Key": "pysz_wrong"})
        assert r2.status_code == 401

    def test_webhook_valid_and_idempotent(self, auth, loc_id):
        import uuid
        key = requests.get(f"{API}/integrations/pyszne?location_id={loc_id}", headers=auth).json()["api_key"]
        ext_id = f"PZ-TEST-{uuid.uuid4().hex[:6]}"
        payload = {
            "order_id": ext_id,
            "items": [
                {"sku": "SAV-MAR", "name": "Margherita 40 cm", "quantity": 2, "unit_price": 44,
                 "extras": [{"name": "Rukola", "price": 4}]},
                {"name": "Nieznane danie", "quantity": 1, "unit_price": 10}
            ],
            "customer": {"name": "Jan Testowy", "phone": "+48600000000", "address": "ul. Testowa 1"},
            "delivery_type": "delivery", "payment": "paid_online"
        }
        r = requests.post(f"{API}/integrations/pyszne/orders", json=payload, headers={"X-Pyszne-Api-Key": key})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accepted"] is True
        assert d["duplicate"] is False
        assert d["unmapped_items"] == 1
        oid = d["order_id"]
        # Fetch order via admin
        orders = requests.get(f"{API}/orders?status=new", headers=auth).json()
        o = next((x for x in orders if x["id"] == oid), None)
        assert o is not None
        assert o["source"] == "AGGREGATOR"
        mapped = next(i for i in o["items"] if i["product_id"] != "unmapped")
        assert mapped["variant_name"] == "40 cm"
        assert any(m["name"] == "Rukola" for m in mapped.get("modifiers", []))
        # Idempotent
        r2 = requests.post(f"{API}/integrations/pyszne/orders", json=payload, headers={"X-Pyszne-Api-Key": key})
        assert r2.status_code == 200
        assert r2.json()["duplicate"] is True
        assert r2.json()["order_id"] == oid

    def test_disabled_returns_401(self, auth, loc_id):
        key = requests.get(f"{API}/integrations/pyszne?location_id={loc_id}", headers=auth).json()["api_key"]
        requests.put(f"{API}/integrations/pyszne", json={"location_id": loc_id, "enabled": False}, headers=auth)
        r = requests.post(f"{API}/integrations/pyszne/orders",
                          json={"order_id": "PZ-DISABLED", "items": [{"name": "x", "quantity": 1, "unit_price": 10}]},
                          headers={"X-Pyszne-Api-Key": key})
        assert r.status_code == 401
        # Re-enable
        requests.put(f"{API}/integrations/pyszne", json={"location_id": loc_id, "enabled": True}, headers=auth)

    def test_test_order(self, auth, loc_id):
        r = requests.post(f"{API}/integrations/pyszne/test-order", json={"location_id": loc_id}, headers=auth)
        assert r.status_code == 200, r.text
        assert r.json()["accepted"] is True

    def test_menu_export_and_push(self, auth, loc_id):
        r = requests.get(f"{API}/integrations/pyszne/menu-export?location_id={loc_id}", headers=auth)
        assert r.status_code == 200
        d = r.json()
        assert "categories" in d
        assert any(c.get("products") for c in d["categories"])
        p = requests.post(f"{API}/integrations/pyszne/menu-push", json={"location_id": loc_id}, headers=auth)
        assert p.status_code == 200
        assert p.json()["status"] == "simulated"


# --- Cleanup ---

def test_zz_restore_defaults(token):
    auth = {"Authorization": f"Bearer {token}"}
    requests.put(f"{API}/settings", json={"stock_deduction_mode": "on_create", "payment_provider": "stripe", "clear_payu": True}, headers=auth)
