"""Compiled component checks against the real LNbits host and isolated SQLite storage."""
import asyncio
import json
import os
import sys
from contextlib import ExitStack
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[5]
EXT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
TEMP = TemporaryDirectory(prefix="lnbits-clone-runtime-")
os.environ["DEBUG"] = "false"
os.environ["LNBITS_DATA_FOLDER"] = TEMP.name
os.environ["LNBITS_DATABASE_URL"] = ""
os.environ["LNBITS_BACKEND_WALLET_CLASS"] = "FakeWallet"
os.environ["LNBITS_WASM_EXTENSIONS_PATH"] = str(EXT.parent)

from bolt11 import decode
from lnbits.core.models.wallets import Wallet
from lnbits.core.services.extensions import wasm_runtime_limit_defaults
from lnbits.core.wasm_ext.api.host import ExtensionHostAPI
from lnbits.core.wasm_ext.storage.crud import _run_storage_migration
from lnbits.core.wasm_ext.wasm.invoke import _invoke_wasm_extension_export_sync
from lnbits.core.wasm_ext.wasm.loader import load_wasm_extension
from lnbits.db import Database
from lnbits.helpers import sha256s
from lnbits.settings import settings
from lnbits.wallets.fake import FakeWallet

async def main():
    settings.lnbits_data_folder = TEMP.name
    settings.lnbits_database_url = None
    settings.lnbits_wasm_extensions_path = str(EXT.parent)
    extension = load_wasm_extension(EXT.name)
    kind = EXT.name.removesuffix("wasm")
    async with Database(f"ext_{extension.id}").connect() as conn:
        await _run_storage_migration(conn, EXT / "storage/migrations/0001_initial.json")
    wallet = Wallet(id="wallet-1",user="alice",name="Wallet",adminkey="unused",inkey="unused")
    fake = FakeWallet()
    created = []
    async def create_payment(wallet_id, data, **kwargs):
        invoice = await fake.create_invoice(int(data.amount), memo=data.memo,
            unhashed_description=bytes.fromhex(data.unhashed_description) if data.unhashed_description else None)
        created.append((invoice, data, kwargs["extension_context"]))
        return SimpleNamespace(payment_hash=invoice.checking_id,checking_id=invoice.checking_id,
            payment_request=invoice.payment_request,bolt11=invoice.payment_request)
    limits = wasm_runtime_limit_defaults()
    loop = asyncio.get_running_loop()
    async def call(name, data=None, owner="alice", public=False, permissions=None):
        api = ExtensionHostAPI(extension.id, permissions if permissions is not None else extension.config.permissions,
            user_id=None if public else owner,context="event" if public else "user",owner_id=sha256s(owner))
        return await asyncio.to_thread(_invoke_wasm_extension_export_sync, extension, name, data or {}, api, loop, "clone-check", limits)
    def value(response):
        if response.get("ok") is False: raise RuntimeError(response)
        return response.get("data",response)
    with ExitStack() as stack:
        stack.enter_context(patch("lnbits.core.crud.wallets.get_wallet",AsyncMock(return_value=wallet)))
        stack.enter_context(patch("lnbits.core.crud.wallets.get_wallets",AsyncMock(return_value=[wallet])))
        stack.enter_context(patch("lnbits.core.services.payments.create_payment_request",side_effect=create_payment))
        # These checks deliberately use actual host auth, SQLite storage, and WIT transport.
        # Only wallet CRUD and the external funding source boundary are replaced.
        data = {"wallet":"wallet-1"}
        if kind == "lnticket": data.update(name="Support",description="Ask",amount=5,flatrate=False,webhook="")
        elif kind == "eightball": data.update(name="Fortune ⚡",description="Ask",wordlist="Yes\nNo",lnurlpayamount=10,base_url="https://example.com")
        else: data.update(currency="sats",status="open",company_name="Company",items=[{"description":"Item","amount":21,"quantity":2}])
        source = value(await call("create-source",data))
        assert value(await call("list-sources"))["total"] == 1
        assert value(await call("list-sources",owner="bob"))["total"] == 0
        assert (await call("delete-source",{"id":source["id"]},owner="bob"))["ok"] is False
        public = value(await call("get-public",{"id":source["id"]},public=True))
        assert "wallet" not in public and "wordlist" not in public and "webhook" not in public
        req={"id":source["id"]}
        if kind == "lnticket": req.update(name="Customer",email="buyer@example.com",ltext="two words",sats=1)
        if kind == "invoices": req["famount"]=21
        result = value(await call("create-payment",req,public=True))
        invoice, invoice_data, binding = created[-1]
        if kind == "eightball":
            lnurl = value(await call("lnurl-pay",{"id":source["id"]},public=True))
            assert decode(invoice.payment_request).description_hash == sha256(lnurl["metadata"].encode()).hexdigest()
        event={"extension":extension.id,"status":"success","pending":False,"paymentHash":result["payment_hash"],
            "walletId":wallet.id,"amount":int(decode(invoice.payment_request).amount_msat),"extra":invoice_data.extra,
            "payment":{"extension_context":binding}}
        value(await call("handle-invoice-paid",event,public=True))
        value(await call("handle-invoice-paid",event,public=True))
        assert value(await call("list-records"))["total"] == 1
        assert value(await call("payment-status",{"attempt":result["attempt"]},public=True))["paid"] is True
        try:
            response = await call("list-sources",permissions=[])
            assert response.get("ok") is False
        except PermissionError:
            pass
        print(f"{extension.id}: compiled component, SQLite schema, host permissions, two-owner isolation, payment and replay OK")
    await fake.cleanup()

try:
    asyncio.run(main())
finally:
    TEMP.cleanup()
