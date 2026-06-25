"""Business Central adapter — OData v4 over NTLM. On-prem (172.16.1.10),
reachable from the Docker host. BC is the system of record for price/SKU,
customer + vendor masters, posted POs, and invoices.

Until the live endpoints are confirmed (CLAUDE.md §7) the read methods serve demo
data when BC is unconfigured. OPEN QUESTIONS to resolve before going live:
  * exact OData price-list entity for get_item_price + auth (NavUserPassword vs NTLM)
  * the item master entity/fields and company segment in the URL
"""
from typing import Optional

from ..config import settings
from . import fakes


class BCAdapter:
    def __init__(self, base_url=None, company=None, user=None, password=None):
        self.base_url = base_url if base_url is not None else settings.bc_base_url
        self.company = company if company is not None else settings.bc_company
        self.user = user if user is not None else settings.bc_username
        self.password = password if password is not None else settings.bc_password

    @property
    def use_fakes(self) -> bool:
        return settings.fakes_for(settings.bc_enabled)

    # READS
    def list_items(self) -> list[dict]:
        """Item master: sku/name/type/uom/refs. Demo data until BC is wired."""
        if self.use_fakes:
            return fakes.list_items()
        # TODO: GET {base_url}/Company('{company}')/Items  (NTLM) -> map to canonical dicts.
        raise NotImplementedError("BC live item master read not implemented (CLAUDE.md §7).")

    def get_item_price(self, sku: str) -> Optional[float]:
        """Selling price per SKU from a BC price list. Demo data until BC is wired."""
        if self.use_fakes:
            return fakes.item_price(sku)
        # TODO: query the BC price-list entity for this SKU. Entity name + auth = open question.
        raise NotImplementedError("BC live price read not implemented (CLAUDE.md §7).")

    def get_vendor(self, vendor_no: str) -> Optional[dict]:
        raise NotImplementedError  # Phase 3

    # WRITES
    def create_purchase_order(self, po: dict) -> str:
        """Post a PO to BC; return the BC PO number."""
        raise NotImplementedError  # Phase 3

    def post_sales_invoice(self, order: dict) -> str:
        raise NotImplementedError  # Phase 5
