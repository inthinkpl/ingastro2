# inGastro Cloud OS – Multi-Tenant Gastronomy ERP SaaS

## Original Problem Statement
Chmurowy system SaaS klasy ERP/POS do kompleksowego zarządzania sieciami lokali, pojedynczymi restauracjami, pizzeriami oraz konceptami Dark Kitchen. Platforma udostępnia moduły sprzedaży (POS), realizacji zamówień (KDS), e-Commerce z zamawianiem online, logistyki dostaw, magazynu BOM, programu lojalnościowego oraz ewidencji czasu pracy (RCP). Multi-Tenant SaaS architecture.

> Note: Spec called for Laravel 13 + Vue 3 + PostgreSQL + Reverb. Platform uses **FastAPI + React + MongoDB** so the architecture was faithfully translated to this stack (row-level multi-tenancy via `tenant_id` scoping on every query, native FastAPI WebSockets instead of Reverb, Pydantic/Motor instead of Eloquent).

## Architecture (as built)
- **Backend**: FastAPI, Motor (MongoDB), PyJWT, bcrypt, native WebSockets for KDS channels (`tenant.{tid}.location.{lid}.kds`).
- **Frontend**: React 19, React Router 7, TanStack Query, Shadcn UI (dark theme), Recharts, Tailwind, Sonner toasts, Outfit + IBM Plex Sans fonts.
- **Multi-tenancy**: Row-level – every collection has `tenant_id`; API handlers inject `user["tenant_id"]` into all Mongo queries.
- **Auth**: JWT (`Authorization: Bearer`) carrying `sub`, `tid`, `role`. Bcrypt-hashed passwords & employee PINs. RBAC via `require_roles(...)`.
- **Order State Machine**: `new → in_progress → ready → in_delivery → completed` (+ `cancelled`). Illegal transitions rejected 400.
- **Real-time**: WebSocket `/api/ws/kds?token=&location_id=` broadcasts `order.created` / `order.status`.

## User Personas
- **Owner** – signs up a tenant, full access.
- **Manager** – CRUD on locations/tables/menu/employees, operational oversight.
- **Waiter** – POS cashier, creates orders.
- **Cook** – KDS, updates order states.
- **Courier** – delivery handoff / completion.

## Implemented Modules (2026-02)
- ✅ Multi-tenant auth (register, login, me, pin-login) with JWT + bcrypt
- ✅ Tenants, Locations CRUD, Tables CRUD
- ✅ Menu – categories, products with variants + ADD/REMOVE modifiers
- ✅ POS – floor-plan table selector, menu grid, variant/modifier dialog, cart, order submission
- ✅ KDS – live grid, SLA-colored ticket headers (green/amber/red by elapsed minutes), REMOVE/ADD highlighted, state actions, WebSocket broadcast
- ✅ Orders list with status filter + Order Detail with history timeline & state-machine actions
- ✅ Employees management (role, bcrypt-hashed PIN, hourly rate)
- ✅ Analytics dashboard (KPI cards, 7-day revenue chart, status breakdown)
- ✅ Dark ERP UI (Outfit + IBM Plex Sans), Polish i18n
- ✅ Seed demo tenant "Pizzeria Savona" with 2 locations, 10 tables, 5 categories, 11 products, 4 employees

## Implemented 2026-06 (iteration 2) – `/app/backend/extensions.py`
- ✅ **Magazyn BOM**: ingredients CRUD, per-location stock levels, movements (delivery/waste/adjust/order/cancel_return), recipes per product + per-variant lines, modifier→ingredient links, low-stock alerts. Auto deduction on order (tenant setting `stock_deduction_mode`: `on_create` default | `on_ready`), return on cancel. UI `/inventory` (4 tabs + RecipeEditor).
- ✅ **E-Commerce storefront**: public `/s/{slug}` (+ subdomain detection in `lib/store.js`, `store_domain` setting), server-side pricing, cash / online payment. Online orders start `pending_payment` → `new` + KDS broadcast only after payment. **Stripe** claimable sandbox (Flow A, PL account, Stripe-calculates tax w/ tax_code txcd_40060003 inclusive, fallback no-tax), webhook `/api/stripe/webhook`, status poll `/api/public/payments/status/{sid}`. **PayU** per-tenant encrypted creds (Fernet from JWT_SECRET), OAuth + `/api/v2_1/orders`, notify `/api/payments/payu/notify/{tenant_id}` MD5 signature. Settings UI `/store-settings`. Tracking page `/s/{slug}/order/{id}`.
- ✅ **Pyszne.pl**: per-location API key, webhook `POST /api/integrations/pyszne/orders` (header `X-Pyszne-Api-Key`), SKU/name→product/variant mapping, extras→modifiers, unmapped flag, idempotent on `order_id`, source AGGREGATOR badge on KDS/Orders, test-order button, Menu Push (JSON export; real push if `menu_push_url` set, else `simulated`). UI `/integrations`.
- Tests: `/app/test_reports/iteration_2.json` (23/23 backend, all frontend flows pass).

## Implemented 2026-06 (iteration 3) – `/app/backend/modules.py`
- ✅ **RCP – Czas pracy**: PIN clock-in/out on POS (`Zegar RCP` keypad dialog → `/api/rcp/clock`, auto toggles open/close via `time_entries`), live "obecnie w pracy" (`/api/rcp/active`), payroll report `/api/rcp/report` (hours × hourly_rate per employee) with date filters + CSV export on `/rcp` page. New `get_actor` dependency so PIN (employee) tokens work on protected endpoints.
- ✅ **Aplikacja Kuriera**: standalone mobile portal `/c/{slug}` (public tenant resolve `/api/public/tenant/{slug}`, PIN login, courier role enforced via `require_actor_roles`). Delivery queue `/api/courier/deliveries` (DELIVERY orders status ready/in_delivery), Google-Maps navigation, `tel:` call, `/depart` (ready→in_delivery + customer SMS) and `/delivered` (in_delivery→completed). Link in sidebar (`nav-courier`).
- ✅ **SMS (MOCK) – płatna opcja**: `send_customer_sms` logs to `sms_messages` (status `simulated`, cost = platform price) when platform SMS enabled AND tenant toggled on. Tenant toggle + usage/cost + recent log in `/store-settings` (`/api/sms/settings`). NO real gateway yet.
- ✅ **Panel Super Admina** (new role `superadmin`, tenant_id `platform`, seeded `balordini@gmail.com`): `/api/admin/overview` KPIs (tenants/users/orders/MRR/SMS), `/config` SaaS module catalog (per-module monthly price + global enable toggle) + SMS price/global toggle, `/tenants` list with per-tenant module enable/disable + active flag, `/sms` global log. Frontend `AdminPanel.jsx` (App.js routes superadmin to it instead of tenant AppShell). Module gating: `/auth/me` returns `tenant.modules` via `effective_modules` (platform AND tenant override); `AppShell` hides nav items for disabled modules.
- Tests: `/app/test_reports/iteration_3.json` (19/19 backend, 100% frontend). Run `pytest -n 0` (shared platform_config/tenant_settings state).

## Deferred Backlog (P1 / P2)
- **P1**: SMS OTP loyalty (phone point collection), Delivery geofencing & courier GPS/route optimization & mobile wallet
- **P1**: Real SMS gateway (Twilio) to replace the current mock
- **P2**: ESC/POS local print relay service
- **P2**: Stripe refunds UI, PayU production credentials from user (not yet provided)
- **P2**: Super Admin – per-tenant plan/billing invoices, audit log

## Test Credentials
See `/app/memory/test_credentials.md`
