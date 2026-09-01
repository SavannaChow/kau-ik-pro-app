// Mega Securities trading through the Windows-only MegaAPI bridge.
// Market data intentionally stays on the separately configured Fugle feed.

import type { Config } from '../../config.ts';
import type { ContractKey } from '../market-data.ts';
import { brokerLoginSuccessMessage } from '../logging.ts';
import {
    FuturesNotSupportedError,
    TradeNotFoundError,
    zeroMargin,
    type TradingProvider,
} from '../trading.ts';
import type {
    Account,
    AccountBalance,
    AccountTypeName,
    Action,
    FuturesOrderReq,
    OrderEventData,
    OrderStatusName,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../../types/dto.ts';

interface MegaOrderRow {
    order_no: string;
    nid?: string;
    code: string;
    exchange?: 'TSE' | 'OTC';
    action: Action;
    price: number;
    quantity: number;
    filled_quantity?: number;
    cancelled_quantity?: number;
    lot?: 'Common' | 'Fixing' | 'Odd' | 'IntradayOdd';
    price_type?: 'LMT' | 'MKT';
    order_type?: 'ROD' | 'IOC' | 'FOK';
    status?: OrderStatusName;
    status_code?: string;
    message?: string;
    order_ts?: number;
}

interface MegaPositionRow {
    code: string;
    direction?: Action;
    quantity: number;
    price: number;
    last_price?: number;
    pnl?: number;
    yd_quantity?: number;
}

interface MegaEvent {
    cursor: number;
    operation: 'New' | 'Cancel' | 'UpdatePrice' | 'UpdateQty' | 'Deal';
    order?: MegaOrderRow;
    code?: string;
    action?: Action;
    price?: number;
    quantity?: number;
    op_code?: string;
    message?: string;
}

function numberValue(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export class MegaTradingProvider implements TradingProvider {
    private readonly baseUrl: string;
    private readonly token: string;
    private eventsCursor = 0;
    private eventsTimer: ReturnType<typeof setInterval> | null = null;
    private eventCbs: ((ev: OrderEventData) => void)[] = [];

    constructor(private config: Config) {
        this.baseUrl = config.broker.apiUrl.replace(/\/$/, '');
        this.token = config.broker.bridgeToken;
    }

    capabilities() {
        return { futures: false, condition_orders: false };
    }

    private async request<T>(
        path: string,
        init: RequestInit = {},
    ): Promise<T> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                authorization: `Bearer ${this.token}`,
                'content-type': 'application/json',
                ...init.headers,
            },
            signal: AbortSignal.timeout(15_000),
        });
        const body = (await response.json().catch(() => ({}))) as {
            detail?: string;
        };
        if (!response.ok) {
            throw new Error(
                `兆豐 Bridge ${response.status}: ${body.detail ?? response.statusText}`,
            );
        }
        return body as T;
    }

    async init(): Promise<void> {
        const b = this.config.broker;
        if (
            !b.idNo ||
            !b.password ||
            !b.account ||
            !b.branchId ||
            !b.certPath ||
            !b.certPass ||
            !b.apiUrl ||
            !b.bridgeToken
        ) {
            throw new Error(
                '兆豐需要身分證字號、登入密碼、分公司、帳號、PFX 路徑與密碼、Bridge URL 與 Token',
            );
        }
        await this.request('/v1/session/login', {
            method: 'POST',
            body: JSON.stringify({
                id_no: b.idNo,
                password: b.password,
                account: b.account,
                branch_id: b.branchId,
                cert_path: b.certPath,
                cert_pass: b.certPass,
            }),
        });
        this.eventsTimer = setInterval(() => void this.pollEvents(), 1_000);
        console.log(brokerLoginSuccessMessage('mega', ['證券']));
    }

    dispose(): void {
        if (this.eventsTimer) clearInterval(this.eventsTimer);
        this.eventsTimer = null;
        void this.request('/v1/session/logout', { method: 'POST' }).catch(
            () => undefined,
        );
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    private async pollEvents(): Promise<void> {
        try {
            const result = await this.request<{ events: MegaEvent[] }>(
                `/v1/events?after=${this.eventsCursor}`,
            );
            for (const event of result.events) {
                this.eventsCursor = Math.max(this.eventsCursor, event.cursor);
                const row = event.order;
                const data: OrderEventData = {
                    operation: {
                        op_type: event.operation,
                        op_code: event.op_code ?? '00',
                        op_msg: event.message ?? '',
                    },
                    order: row
                        ? {
                              id: this.tradeId(row.order_no),
                              seqno: row.nid ?? '',
                              ordno: row.order_no,
                              action: row.action,
                              price: numberValue(row.price),
                              quantity: numberValue(row.quantity),
                          }
                        : undefined,
                    contract: { code: row?.code ?? event.code ?? '' },
                    status: row ? { ...row } : {},
                    ...(event.operation === 'Deal'
                        ? {
                              code: event.code ?? row?.code,
                              action: event.action ?? row?.action,
                              price: numberValue(event.price),
                              quantity: numberValue(event.quantity),
                          }
                        : {}),
                };
                for (const cb of this.eventCbs) cb(data);
            }
        } catch {
            // The next poll retries. Trading calls still surface bridge errors.
        }
    }

    private tradeId(orderNo: string): string {
        return `mega-${orderNo}`;
    }

    private rowToTrade(row: MegaOrderRow): Trade {
        const id = this.tradeId(row.order_no);
        return {
            contract: {
                exchange: row.exchange ?? 'TSE',
                code: row.code,
                security_type: 'STK',
                target_code: null,
            },
            order: {
                id,
                seqno: row.nid ?? '',
                ordno: row.order_no,
                action: row.action,
                price: numberValue(row.price),
                quantity: numberValue(row.quantity),
                order_type: row.order_type ?? 'ROD',
                price_type: row.price_type ?? 'LMT',
                order_lot: row.lot ?? 'Common',
            },
            status: {
                id,
                status: row.status ?? 'Submitted',
                status_code: row.status_code ?? '00',
                order_ts: row.order_ts,
                order_quantity: numberValue(row.quantity),
                deal_quantity: numberValue(row.filled_quantity),
                cancel_quantity: numberValue(row.cancelled_quantity),
                modified_price: 0,
                msg: row.message ?? '',
                deals: [],
            },
        };
    }

    async accounts(): Promise<Account[]> {
        return [
            {
                account_type: 'S',
                person_id: '',
                broker_id: this.config.broker.branchId,
                account_id: this.config.broker.account,
                signed: true,
                username: '',
            },
        ];
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        if (order.order_lot === 'BlockTrade') {
            throw new Error('兆豐 Bridge 目前不支援鉅額交易委託');
        }
        const row = await this.request<MegaOrderRow>('/v1/orders', {
            method: 'POST',
            body: JSON.stringify({
                code: key.code,
                exchange: key.exchange ?? 'TSE',
                action: order.action,
                price: order.price,
                quantity: order.quantity,
                price_type: order.price_type,
                order_type: order.order_type,
                lot: order.order_lot ?? 'Common',
                daytrade_short: Boolean(order.daytrade_short),
            }),
        });
        return this.rowToTrade(row);
    }

    async placeFuturesOrder(
        _key: ContractKey,
        _order: FuturesOrderReq,
    ): Promise<Trade> {
        throw new FuturesNotSupportedError();
    }

    private orderNo(tradeId: string): string {
        if (!tradeId.startsWith('mega-') || tradeId.length <= 5) {
            throw new TradeNotFoundError(tradeId);
        }
        return tradeId.slice(5);
    }

    async cancel(tradeId: string): Promise<Trade> {
        const row = await this.request<MegaOrderRow>(
            `/v1/orders/${encodeURIComponent(this.orderNo(tradeId))}/cancel`,
            { method: 'POST' },
        );
        return this.rowToTrade(row);
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const row = await this.request<MegaOrderRow>(
            `/v1/orders/${encodeURIComponent(this.orderNo(tradeId))}/replace`,
            { method: 'POST', body: JSON.stringify({ price }) },
        );
        const trade = this.rowToTrade(row);
        trade.status.modified_price = price;
        return trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const row = await this.request<MegaOrderRow>(
            `/v1/orders/${encodeURIComponent(this.orderNo(tradeId))}/replace`,
            { method: 'POST', body: JSON.stringify({ quantity }) },
        );
        return this.rowToTrade(row);
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        if (accountType !== 'S') return [];
        const result = await this.request<{ orders: MegaOrderRow[] }>('/v1/orders');
        return result.orders.map((row) => this.rowToTrade(row));
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType !== 'S') return [];
        const result = await this.request<{ positions: MegaPositionRow[] }>(
            '/v1/positions',
        );
        return result.positions.map((row, id) => ({
            id,
            code: row.code,
            direction: row.direction ?? 'Buy',
            quantity: numberValue(row.quantity),
            price: numberValue(row.price),
            last_price: numberValue(row.last_price),
            pnl: numberValue(row.pnl),
            yd_quantity: numberValue(row.yd_quantity ?? row.quantity),
        }));
    }

    async accountBalance(): Promise<AccountBalance> {
        return this.request<AccountBalance>('/v1/accounting');
    }

    async margin() {
        return zeroMargin();
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        if (accountType !== 'S') return [];
        const query = new URLSearchParams({ begin_date: beginDate, end_date: endDate });
        const result = await this.request<{ rows: PnlRow[] }>(
            `/v1/profit-loss?${query}`,
        );
        return result.rows;
    }
}
