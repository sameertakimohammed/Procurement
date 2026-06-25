"""Phase 4 — BOM + explosion service -> suggested requisitions.

Mirrors test_purchasing.py / test_requisitions.py: override get_current_user with a
synthetic CurrentUser per role, run against the seeded in-memory SQLite from
conftest (refresh_all -> seed_vendors + seed_boms gives the demo catalog, stock,
vendor_prices AND BOMs).

The numbers below are computed against the SEEDED demo data and mirror the
test_bom.py style (explode -> net -> round_to_moq):

Seeded BOM (fakes.BOMS):
  BOX-RSC-A (owner APP) -> BOARD-200K 0.62 scrap 0.05, GLUE-STARCH 0.02,
                           WIRE-STITCH 0.005, STRAP-PET-16 0.5
  LABEL-1L-RANGE (owner APP) -> LBL-SUB-PP 0.02, LBL-RIBBON-TT 0.001

Seeded available stock (on_hand - allocated + on_order, summed over snapshots):
  BOARD-200K  = (12450-4200+6000)+(3100-900) = 16450
  GLUE-STARCH = 2400-300                       = 2100
  WIRE-STITCH = 210-60                          = 150
  STRAP-PET-16= 18000-2000                      = 16000
  LBL-SUB-PP  = 5400-1800                        = 3600
  LBL-RIBBON-TT = 340-80                         = 260

Chosen-vendor MOQs (cheapest, tie-break lower lead time):
  BOARD-200K 1000, GLUE-STARCH 200, WIRE-STITCH 50, STRAP-PET-16 2000,
  LBL-SUB-PP 500, LBL-RIBBON-TT 24

Worked example used throughout — BOX-RSC-A x 50000:
  BOARD-200K gross = 50000*0.62*1.05 = 32550 ; net 32550-16450=16100 ; moq1000 -> 17000
  GLUE-STARCH gross = 1000           ; net 1000-2100 < 0            -> covered
  WIRE-STITCH gross = 250            ; net 250-150 = 100 ; moq50    -> 100
  STRAP-PET-16 gross = 25000         ; net 25000-16000=9000 ; moq2000 -> 10000
"""
import pytest
from sqlmodel import Session, select

from app.auth.deps import CurrentUser, get_current_user
from app.gateway.models import (
    BomHeader,
    BomLine,
    Item,
    OrderEvent,
    Requisition,
    RequisitionLine,
)
from app.main import app

LIMITS = {
    "ADMIN": None,
    "APPROVER": 50000.0,
    "OFFICER": 5000.0,
    "REQUESTER": 0.0,
    "VIEWER": 0.0,
}


def as_role(role_code, email=None):
    user = CurrentUser(
        id=f"u-{role_code}",
        email=email or f"{role_code.lower()}@golden.com.fj",
        name=role_code.title(),
        role_code=role_code,
        approval_limit=LIMITS[role_code],
    )
    app.dependency_overrides[get_current_user] = lambda: user
    return user


@pytest.fixture(autouse=True)
def _clear_override():
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _by_sku(rows):
    return {r["sku"]: r for r in rows}


# --------------------------------------------------------------------------- #
# Seeding: BOMs land as ACTIVE headers + lines with the right owners
# --------------------------------------------------------------------------- #
def test_boms_seeded_active_with_owners(engine):
    with Session(engine) as s:
        items = {it.sku: it for it in s.exec(select(Item)).all()}
        box = items["BOX-RSC-A"]
        header = s.exec(select(BomHeader).where(
            BomHeader.parent_item_id == box.id)).first()
        assert header is not None
        assert header.status == "ACTIVE"
        assert header.owner.value == "APP"               # app-owned top kit (§2)
        lines = s.exec(select(BomLine).where(
            BomLine.bom_header_id == header.id)).all()
        assert len(lines) == 4

        label = items["LABEL-1L-RANGE"]
        lheader = s.exec(select(BomHeader).where(
            BomHeader.parent_item_id == label.id)).first()
        assert lheader.owner.value == "APP"              # app-owned top kit (§2)

        # Materials are purchased leaves: no BOM header of their own.
        board = items["BOARD-200K"]
        assert s.exec(select(BomHeader).where(
            BomHeader.parent_item_id == board.id)).first() is None


# --------------------------------------------------------------------------- #
# GET bom tree shape
# --------------------------------------------------------------------------- #
def test_bom_tree_shape(client):
    as_role("VIEWER")
    tree = client.get("/api/items/BOX-RSC-A/bom").json()
    assert tree["sku"] == "BOX-RSC-A"
    assert tree["name"]
    comps = _by_sku(tree["components"])
    assert set(comps) == {"BOARD-200K", "GLUE-STARCH", "WIRE-STITCH", "STRAP-PET-16"}
    board = comps["BOARD-200K"]
    assert board["qty_per"] == pytest.approx(0.62)
    assert board["scrap_pct"] == pytest.approx(0.05)
    assert board["owner"] == "APP"
    # A purchased leaf carries no nested components key.
    assert "components" not in board


def test_bom_tree_null_for_leaf(client):
    as_role("VIEWER")
    assert client.get("/api/items/BOARD-200K/bom").json() is None


def test_bom_tree_unknown_sku_404(client):
    as_role("VIEWER")
    assert client.get("/api/items/NOPE-999/bom").status_code == 404


# --------------------------------------------------------------------------- #
# explode: gross / net / suggested (preview, no writes)
# --------------------------------------------------------------------------- #
def test_explode_gross_correct(client):
    as_role("VIEWER")
    body = client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).json()
    gross = _by_sku(body["gross"])
    assert round(gross["BOARD-200K"]["qty"]) == 32550     # 50000*0.62*1.05
    assert round(gross["GLUE-STARCH"]["qty"]) == 1000
    assert round(gross["WIRE-STITCH"]["qty"]) == 250
    assert round(gross["STRAP-PET-16"]["qty"]) == 25000


def test_explode_net_only_shortages(client):
    as_role("VIEWER")
    body = client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).json()
    net = _by_sku(body["net"])
    # GLUE-STARCH (1000 vs 2100 available) is fully covered -> not a shortage.
    assert "GLUE-STARCH" not in net
    assert round(net["BOARD-200K"]["qty"]) == 16100       # 32550-16450
    assert round(net["WIRE-STITCH"]["qty"]) == 100        # 250-150
    assert round(net["STRAP-PET-16"]["qty"]) == 9000      # 25000-16000


def test_explode_suggested_rounded_to_moq(client):
    as_role("VIEWER")
    body = client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).json()
    sug = _by_sku(body["suggested"])
    # BOARD-200K: ceil(16100/1000)*1000 = 17000, chosen vendor Pacific (cheaper).
    assert sug["BOARD-200K"]["qty"] == pytest.approx(17000)
    assert sug["BOARD-200K"]["moq"] == pytest.approx(1000)
    assert sug["BOARD-200K"]["vendor"] == "Pacific Paper & Board Ltd"
    assert sug["BOARD-200K"]["available"] == pytest.approx(16450)
    # WIRE-STITCH: ceil(100/50)*50 = 100.
    assert sug["WIRE-STITCH"]["qty"] == pytest.approx(100)
    # STRAP-PET-16: ceil(9000/2000)*2000 = 10000.
    assert sug["STRAP-PET-16"]["qty"] == pytest.approx(10000)
    assert "GLUE-STARCH" not in sug


def test_explode_no_shortages_empty(client):
    as_role("VIEWER")
    body = client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 1000}]}).json()
    assert body["net"] == []
    assert body["suggested"] == []
    # gross still computed for the full bill.
    assert _by_sku(body["gross"])["BOARD-200K"]["qty"] == pytest.approx(651)


def test_explode_unknown_sku_404(client):
    as_role("VIEWER")
    r = client.post("/api/bom/explode", json={"lines": [{"sku": "NOPE", "qty": 1}]})
    assert r.status_code == 404


def test_explode_does_not_write(client, engine):
    as_role("OFFICER")
    before = _req_count(engine)
    client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]})
    assert _req_count(engine) == before


def _req_count(engine):
    with Session(engine) as s:
        return len(s.exec(select(Requisition)).all())


# --------------------------------------------------------------------------- #
# suggest-requisition: creates ONE DRAFT source='demand' req + audit event
# --------------------------------------------------------------------------- #
def test_suggest_creates_draft_demand_requisition(client, engine):
    as_role("OFFICER")
    r = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}], "cost_center": "CC-PROD"})
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["status"] == "DRAFT"
    assert req["number"].startswith("REQ-")
    assert req["cost_center"] == "CC-PROD"

    lines = _by_sku([{"sku": ln["sku"], **ln} for ln in req["lines"]])
    # One line per SHORTAGE material; covered GLUE-STARCH is absent.
    assert set(lines) == {"BOARD-200K", "WIRE-STITCH", "STRAP-PET-16"}
    assert lines["BOARD-200K"]["quantity"] == pytest.approx(17000)
    assert lines["WIRE-STITCH"]["quantity"] == pytest.approx(100)
    assert lines["STRAP-PET-16"]["quantity"] == pytest.approx(10000)

    with Session(engine) as s:
        row = s.get(Requisition, req["id"])
        assert row.source == "demand"
        rlines = s.exec(select(RequisitionLine).where(
            RequisitionLine.requisition_id == req["id"])).all()
        assert len(rlines) == 3


def test_suggest_records_audit_event(client, engine):
    as_role("OFFICER")
    req = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).json()
    with Session(engine) as s:
        evts = s.exec(select(OrderEvent).where(
            OrderEvent.entity_kind == "REQUISITION",
            OrderEvent.entity_id == req["id"])).all()
    assert len(evts) == 1
    assert evts[0].event_type == "CREATED"
    assert evts[0].to_status == "DRAFT"
    assert evts[0].actor == "officer@golden.com.fj"


def test_suggest_requisition_flows_into_approval(client, engine):
    # The created DRAFT req is a normal requisition: it submits + approves via the
    # Phase 2 lifecycle (no fork).
    as_role("OFFICER")
    req_id = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).json()["id"]
    submitted = client.post(f"/api/requisitions/{req_id}/submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "IN_APPROVAL"
    as_role("ADMIN", email="admin")
    approved = client.post(f"/api/requisitions/{req_id}/approve")
    assert approved.json()["status"] == "APPROVED"


def test_suggest_no_shortages_creates_nothing(client, engine):
    as_role("OFFICER")
    before = _req_count(engine)
    r = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 1000}]})    # everything covered
    assert r.status_code == 200
    assert r.json() == {"created": False, "message": "no shortages"}
    assert _req_count(engine) == before


def test_suggest_unknown_sku_404(client):
    as_role("OFFICER")
    r = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "NOPE", "qty": 1}]})
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Cycle guard -> 409 (engine raises ValueError, service catches it)
# --------------------------------------------------------------------------- #
def _make_cycle(engine):
    """Make BOARD-200K's BOM point back at BOX-RSC-A (A -> ... -> BOARD -> A)."""
    with Session(engine) as s:
        items = {it.sku: it for it in s.exec(select(Item)).all()}
        board = items["BOARD-200K"]
        box = items["BOX-RSC-A"]
        header = BomHeader(parent_item_id=board.id, status="ACTIVE")
        s.add(header)
        s.flush()
        s.add(BomLine(bom_header_id=header.id, line_no=1,
                      component_id=box.id, qty_per=1.0))
        s.commit()


def test_explode_cycle_returns_409(client, engine):
    _make_cycle(engine)
    as_role("VIEWER")
    r = client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 100}]})
    assert r.status_code == 409
    assert "cycle" in r.json()["detail"].lower()


def test_bom_tree_cycle_returns_409(client, engine):
    _make_cycle(engine)
    as_role("VIEWER")
    r = client.get("/api/items/BOX-RSC-A/bom")
    assert r.status_code == 409


def test_suggest_cycle_returns_409(client, engine):
    _make_cycle(engine)
    as_role("OFFICER")
    r = client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 100}]})
    assert r.status_code == 409


# --------------------------------------------------------------------------- #
# RBAC
# --------------------------------------------------------------------------- #
def test_viewer_can_explode(client):
    as_role("VIEWER")
    assert client.post("/api/bom/explode", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).status_code == 200


def test_viewer_cannot_suggest_requisition(client):
    as_role("VIEWER")
    assert client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).status_code == 403


def test_officer_can_suggest_requisition(client):
    as_role("OFFICER")
    assert client.post("/api/bom/suggest-requisition", json={
        "lines": [{"sku": "BOX-RSC-A", "qty": 50000}]}).status_code == 200
