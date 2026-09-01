"""Private-LAN HTTP adapter for Mega Securities' Windows-only Speedy API."""

from __future__ import annotations

import os
import threading
import time
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _status(row: dict[str, Any]) -> str:
    if str(row.get("errcode", "")).strip():
        return "Failed"
    qty = _num(row.get("orgqty"))
    filled = _num(row.get("matqty"))
    cancelled = _num(row.get("celqty"))
    if qty and filled >= qty:
        return "Filled"
    if filled:
        return "PartFilled"
    if cancelled and cancelled >= qty:
        return "Cancelled"
    return "Submitted"


def _row(raw: dict[str, Any], nid: str = "") -> dict[str, Any]:
    apcode = str(raw.get("apcode", "1"))
    lot = {"2": "Fixing", "3": "Odd", "5": "IntradayOdd"}.get(apcode, "Common")
    market = str(raw.get("market", "T"))
    return {
        "order_no": str(raw.get("ordno") or raw.get("order_no") or nid),
        "nid": str(raw.get("nid") or nid),
        "code": str(raw.get("stockno") or raw.get("code") or ""),
        "exchange": "OTC" if market in ("O", "OTC") else "TSE",
        "action": "Sell" if str(raw.get("buysell", "B")) == "S" else "Buy",
        "price": _num(raw.get("odprice", raw.get("price"))),
        "quantity": _num(raw.get("orgqty", raw.get("quantity"))),
        "filled_quantity": _num(raw.get("matqty", raw.get("filled_quantity"))),
        "cancelled_quantity": _num(raw.get("celqty", raw.get("cancelled_quantity"))),
        "lot": lot,
        "price_type": "MKT" if str(raw.get("priceflag")) == "4" else "LMT",
        "order_type": {"I": "IOC", "F": "FOK"}.get(str(raw.get("bs_flag")), "ROD"),
        "status": raw.get("status") or _status(raw),
        "status_code": str(raw.get("errcode") or "00"),
        "message": str(raw.get("errmsg") or ""),
        "order_ts": int(time.time() * 1000),
    }


class LoginBody(BaseModel):
    id_no: str
    password: str
    account: str
    branch_id: str
    cert_path: str
    cert_pass: str


class OrderBody(BaseModel):
    code: str
    exchange: str = "TSE"
    action: str
    price: float = 0
    quantity: int = Field(gt=0)
    price_type: str = "LMT"
    order_type: str = "ROD"
    lot: str = "Common"
    daytrade_short: bool = False


class ReplaceBody(BaseModel):
    price: float | None = None
    quantity: int | None = Field(default=None, gt=0)


class MegaSession:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.api: Any = None
        self.login: LoginBody | None = None
        self.logged_in = False
        self.login_event = threading.Event()
        self.login_message = ""
        self.orders: dict[str, dict[str, Any]] = {}
        self.nid_to_order: dict[str, str] = {}
        self.events: list[dict[str, Any]] = []
        self.cursor = 0

    def push(self, operation: str, **values: Any) -> None:
        self.cursor += 1
        self.events.append({"cursor": self.cursor, "operation": operation, **values})
        self.events = self.events[-1000:]

    def login_api(self, body: LoginBody) -> None:
        with self.lock:
            self.logout_api()
            self.login = body
            if os.getenv("MEGA_BRIDGE_MOCK") == "1":
                self.logged_in = True
                return

            cert = Path(body.cert_path)
            if not cert.is_file():
                raise RuntimeError(f"找不到 Windows PFX 憑證：{cert}")
            host = os.getenv("MEGA_ORDER_HOST", "").strip()
            port = int(os.getenv("MEGA_ORDER_PORT", "0"))
            if not host or port <= 0:
                raise RuntimeError("請在 .env 設定 MEGA_ORDER_HOST 與 MEGA_ORDER_PORT")

            try:
                from megaSpeedy.spdOrderAPI import spdOrderAPI
            except Exception as exc:
                raise RuntimeError(
                    "無法載入兆豐 SDK；確認 megaSpeedy、Temp、speedyAPI_config.json "
                    "及 64-bit Python/DLL 均在 Bridge 目錄"
                ) from exc

            session = self

            class Api(spdOrderAPI):  # type: ignore[misc, valid-type]
                def OnConnected(api_self) -> None:
                    api_self.LogonProxy(body.id_no, body.password, body.account)

                def OnDisconnected(api_self) -> None:
                    session.logged_in = False

                def OnLogonResponse(api_self, succeed: Any, message: Any) -> None:
                    session.logged_in = bool(succeed)
                    session.login_message = str(message)
                    session.login_event.set()

                def OnReplyNewOrder(api_self, nid: Any, udd: Any, symbol: Any, price: Any,
                                    side: Any, qty: Any, order_type: Any, tif: Any,
                                    order_id: Any) -> None:
                    raw = {
                        "nid": nid, "ordno": order_id, "stockno": symbol,
                        "odprice": price, "buysell": side, "orgqty": qty,
                        "bs_flag": tif,
                    }
                    session.orders[str(order_id)] = raw
                    session.nid_to_order[str(nid)] = str(order_id)
                    session.push("New", order=_row(raw, str(nid)), op_code="00", message="")

                def OnReplyCancelOrder(api_self, nid: Any, udd: Any, symbol: Any,
                                       price: Any, side: Any, order_id: Any) -> None:
                    raw = session.orders.setdefault(str(order_id), {})
                    raw.update({"nid": nid, "ordno": order_id, "stockno": symbol,
                                "odprice": price, "buysell": side,
                                "celqty": raw.get("orgqty", 0)})
                    session.push("Cancel", order=_row(raw, str(nid)), op_code="00", message="")

                def OnReplyReplaceOrder(api_self, nid: Any, udd: Any, symbol: Any,
                                        price: Any, side: Any, qty: Any,
                                        order_type: Any, tif: Any, order_id: Any) -> None:
                    raw = session.orders.setdefault(str(order_id), {})
                    if _num(price):
                        raw["odprice"] = price
                    raw.update({"nid": nid, "ordno": order_id, "stockno": symbol,
                                "buysell": side, "bs_flag": tif})
                    session.push("UpdatePrice" if _num(price) else "UpdateQty",
                                 order=_row(raw, str(nid)), op_code="00", message="")

                def OnRejectOrder(api_self, nid: Any, udd: Any, action: Any,
                                  code: Any, message: Any) -> None:
                    operation = {"N": "New", "C": "Cancel", "R": "UpdatePrice"}.get(str(action), "New")
                    session.push(operation, op_code=str(code), message=str(message))

                def OnFill(api_self, nid: Any, udd: Any, order_id: Any,
                           sequence: Any, price: Any, qty: Any, fill_time: Any) -> None:
                    raw = session.orders.setdefault(str(order_id), {})
                    raw["matqty"] = _num(raw.get("matqty")) + _num(qty)
                    session.push("Deal", order=_row(raw, str(nid)),
                                 code=str(raw.get("stockno", "")),
                                 action="Sell" if raw.get("buysell") == "S" else "Buy",
                                 price=_num(price), quantity=_num(qty), op_code="00", message="")

            api = Api()
            if not api.EnableMEGACA(str(cert), body.id_no, body.cert_pass):
                raise RuntimeError(f"兆豐憑證設定失敗：{api.GetLastErrorMsg()}")
            api.SetAccount("TWSE", body.branch_id, body.account)
            api.SetAccount("OTC", body.branch_id, body.account)
            self.api = api
            self.login_event.clear()
            api.Connect(host, port, 10)
            if not self.login_event.wait(15):
                raise RuntimeError("兆豐登入逾時")
            if not self.logged_in:
                raise RuntimeError(f"兆豐登入失敗：{self.login_message}")

    def logout_api(self) -> None:
        if self.api is not None:
            try:
                self.api.Disconnect()
            except Exception:
                pass
        self.api = None
        self.logged_in = False

    def require(self) -> None:
        if not self.logged_in or self.login is None:
            raise HTTPException(409, "尚未登入兆豐")

    def query_orders(self) -> list[dict[str, Any]]:
        self.require()
        if os.getenv("MEGA_BRIDGE_MOCK") == "1":
            return [_row(v, str(v.get("nid", ""))) for v in self.orders.values()]
        result = self.api.queryStkOrder({
            "branch_id": self.login.branch_id, "cust_id": self.login.account,
            "stock_no": "", "apcode": "0", "market": "0", "qry_type": "0",
        })
        if str(result.get("result")) != "0":
            raise HTTPException(502, str(result.get("message", "委託查詢失敗")))
        rows = result.get("ackList", [])
        self.orders.update({str(r.get("ordno")): r for r in rows if r.get("ordno")})
        return [_row(r) for r in rows]


session = MegaSession()
app = FastAPI(title="Kau-ik Pro Mega Bridge", version="1.0.0")


def authorize(authorization: str | None = Header(default=None)) -> None:
    token = os.getenv("MEGA_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise HTTPException(503, "MEGA_BRIDGE_TOKEN 必須至少 32 個字元")
    if authorization != f"Bearer {token}":
        raise HTTPException(401, "invalid bridge token")


@app.get("/v1/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "logged_in": session.logged_in,
            "mock": os.getenv("MEGA_BRIDGE_MOCK") == "1"}


@app.post("/v1/session/login", dependencies=[Depends(authorize)])
def login(body: LoginBody) -> dict[str, bool]:
    try:
        session.login_api(body)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"logged_in": True}


@app.post("/v1/session/logout", dependencies=[Depends(authorize)])
def logout() -> dict[str, bool]:
    session.logout_api()
    return {"logged_in": False}


@app.get("/v1/orders", dependencies=[Depends(authorize)])
def orders() -> dict[str, Any]:
    return {"orders": session.query_orders()}


@app.post("/v1/orders", dependencies=[Depends(authorize)])
def new_order(body: OrderBody) -> dict[str, Any]:
    session.require()
    market = "otc" if body.exchange.upper() == "OTC" else "tse"
    side = "S" if body.action == "Sell" else "B"
    order_type = "M" if body.price_type == "MKT" else "L"
    tif = {"IOC": "I", "FOK": "F"}.get(body.order_type, "R")
    trading_session = {"IntradayOdd": "I", "Odd": "O", "Fixing": "A"}.get(body.lot, "N")
    twse_type = "A" if body.daytrade_short else "0"
    udd = f"K{int(time.time() * 1000) % 10**14:014d}"
    with session.lock:
        if os.getenv("MEGA_BRIDGE_MOCK") == "1":
            nid = str(int(time.time() * 1000))
            order_no = nid[-6:]
        else:
            nid = str(session.api.SendNewOrderEx(
                market, udd, body.code, body.price, side, body.quantity,
                order_type, tif, trading_session, "A", twse_type,
            ))
            if nid == "0":
                raise HTTPException(502, session.api.GetLastErrorMsg())
            order_no = nid
        raw = {
            "nid": nid, "ordno": order_no, "stockno": body.code,
            "market": "O" if market == "otc" else "T", "buysell": side,
            "odprice": body.price, "orgqty": body.quantity,
            "apcode": {"I": "5", "O": "3", "A": "2"}.get(trading_session, "1"),
            "priceflag": "4" if body.price_type == "MKT" else "0", "bs_flag": tif,
        }
        session.orders[order_no] = raw
        session.nid_to_order[nid] = order_no
        if os.getenv("MEGA_BRIDGE_MOCK") == "1":
            session.push("New", order=_row(raw, nid), op_code="00", message="")
        return _row(raw, nid)


def _find_order(order_no: str) -> dict[str, Any]:
    session.query_orders()
    raw = session.orders.get(order_no)
    if raw is None:
        raise HTTPException(404, f"找不到委託：{order_no}")
    return raw


@app.post("/v1/orders/{order_no}/cancel", dependencies=[Depends(authorize)])
def cancel_order(order_no: str) -> dict[str, Any]:
    raw = _find_order(order_no)
    if os.getenv("MEGA_BRIDGE_MOCK") != "1":
        nid = session.api.SendCancelOrderEx(
            "otc" if raw.get("market") == "O" else "tse", "KCancel",
            str(raw.get("stockno", "")), _num(raw.get("odprice")),
            str(raw.get("buysell", "B")), order_no,
            {"5": "I", "3": "O", "2": "A"}.get(str(raw.get("apcode")), "N"),
            "A" if raw.get("trade") == "A" else "0",
        )
        if not nid:
            raise HTTPException(502, session.api.GetLastErrorMsg())
    raw["celqty"] = raw.get("orgqty", 0)
    if os.getenv("MEGA_BRIDGE_MOCK") == "1":
        session.push("Cancel", order=_row(raw), op_code="00", message="")
    return _row(raw)


@app.post("/v1/orders/{order_no}/replace", dependencies=[Depends(authorize)])
def replace_order(order_no: str, body: ReplaceBody) -> dict[str, Any]:
    if body.price is None and body.quantity is None:
        raise HTTPException(400, "必須提供 price 或 quantity")
    if body.price is not None and body.quantity is not None:
        raise HTTPException(400, "改價與減量請分開執行")
    raw = _find_order(order_no)
    remaining = _num(raw.get("orgqty")) - _num(raw.get("matqty")) - _num(raw.get("celqty"))
    reduce_qty = 0
    if body.quantity is not None:
        reduce_qty = int(remaining - body.quantity)
        if reduce_qty <= 0:
            raise HTTPException(400, "兆豐改量只能減少未成交數量")
    price = body.price or 0
    if os.getenv("MEGA_BRIDGE_MOCK") != "1":
        nid = session.api.SendReplaceOrderEx(
            "otc" if raw.get("market") == "O" else "tse", "KReplace",
            str(raw.get("stockno", "")), order_no, str(raw.get("buysell", "B")),
            price, reduce_qty, "M" if raw.get("priceflag") == "4" else "L",
            str(raw.get("bs_flag", "R")),
            {"5": "I", "3": "O", "2": "A"}.get(str(raw.get("apcode")), "N"),
            "A" if raw.get("trade") == "A" else "0",
        )
        if not nid:
            raise HTTPException(502, session.api.GetLastErrorMsg())
    if body.price is not None:
        raw["odprice"] = body.price
    else:
        raw["orgqty"] = body.quantity
    if os.getenv("MEGA_BRIDGE_MOCK") == "1":
        session.push("UpdatePrice" if body.price is not None else "UpdateQty",
                     order=_row(raw), op_code="00", message="")
    return _row(raw)


@app.get("/v1/positions", dependencies=[Depends(authorize)])
def positions() -> dict[str, Any]:
    session.require()
    if os.getenv("MEGA_BRIDGE_MOCK") == "1":
        return {"positions": []}
    result = session.api.makeStockAccountInquriy({
        "branch_id": session.login.branch_id, "cust_id": session.login.account,
    })
    if str(result.get("result")) != "0":
        raise HTTPException(502, str(result.get("message", "帳務查詢失敗")))
    rows = []
    for item in result.get("stksumList", []):
        unit = _num(item.get("t32unit")) or 1000
        rows.append({
            "code": str(item.get("stkno", "")), "direction": "Buy",
            "quantity": _num(item.get("costqty")) / unit,
            "price": _num(item.get("priceavg")), "last_price": _num(item.get("pricenow")),
            "pnl": _num(item.get("makeasum")), "yd_quantity": _num(item.get("qtyl")) / unit,
        })
    return {"positions": rows}


@app.get("/v1/accounting", dependencies=[Depends(authorize)])
def accounting() -> dict[str, Any]:
    session.require()
    return {"acc_balance": 0, "date": date.today().isoformat(),
            "errmsg": "兆豐即時帳務 API 未提供可用現金欄位"}


@app.get("/v1/profit-loss", dependencies=[Depends(authorize)])
def profit_loss(begin_date: str, end_date: str) -> dict[str, Any]:
    session.require()
    return {"rows": []}


@app.get("/v1/events", dependencies=[Depends(authorize)])
def events(after: int = 0) -> dict[str, Any]:
    session.require()
    return {"events": [event for event in session.events if event["cursor"] > after]}
