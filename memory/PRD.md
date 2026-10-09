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

## Deferred Backlog (P1 / P2)
- **P1**: E-Commerce storefront per tenant (subdomain), Stripe/PayU payment integration, SMS OTP loyalty, Delivery geofencing & courier mobile wallet
- **P1**: Magazyn BOM + Recipes (ingredient deduction on order close), low-stock alerts, waste logging
- **P2**: RCP time logs (clock-in/out via PIN), payroll export
- **P2**: Pyszne.pl aggregator integration (Order Ingestion + Menu Push)
- **P2**: ESC/POS local print relay service

## Test Credentials
See `/app/memory/test_credentials.md`
