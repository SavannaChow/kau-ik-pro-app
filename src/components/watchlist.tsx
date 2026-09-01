// src/components/watchlist.tsx — live watchlist; click row to select symbol

import { useEffect, useState } from 'react';
import { useQuote } from '../hooks/use-stream';
import type { WatchItem } from '../hooks/use-watchlist';
import { fetchKbars, fetchSymbolSearch, type SymbolHit } from '../lib/backend';
import { useRegulatoryFlag } from '../lib/regulatory';
import type { ContractInfo, SecurityType } from '../lib/types/contract';
import { fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import { dateStrOffset, kbarsToCandles } from '../lib/utils/kbars';
import * as panel from './panel.css';
import { SymbolCell, type SymbolMarker } from './symbol-cell';
import * as styles from './watchlist.css';

/** 當日 1 分 K 收盤價迷你走勢線（最後一點用即時價補） */
function Sparkline({
    contract,
    last,
}: {
    contract: ContractInfo;
    last?: number;
}) {
    const [closes, setCloses] = useState<number[] | null>(null);
    useEffect(() => {
        let dead = false;
        fetchKbars(contract, dateStrOffset(0), dateStrOffset(0))
            .then((k) => {
                if (!dead) {
                    setCloses(kbarsToCandles(k).map((b) => b.close));
                }
            })
            .catch(() => {
                if (!dead) setCloses(null);
            });
        return () => {
            dead = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract.code]);

    const W = 64;
    const H = 20;
    if (!closes || closes.length < 2) {
        return <span className={styles.sparkCell} />;
    }
    const pts = last && last > 0 ? [...closes, last] : closes;
    const ref = contract.reference;
    const lo = Math.min(...pts, ref || Infinity);
    const hi = Math.max(...pts, ref || -Infinity);
    const span = hi - lo || 1;
    const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);
    const x = (i: number) => (i / (pts.length - 1)) * (W - 2) + 1;
    const lastClose = pts[pts.length - 1]!;
    const dir =
        !ref || lastClose === ref ? 'flat' : lastClose > ref ? 'up' : 'down';
    return (
        <span className={`${styles.sparkCell} ${panel.dirText[dir]}`}>
            <svg width={W} height={H} aria-hidden='true'>
                {ref > 0 && (
                    <line
                        x1={0}
                        y1={y(ref)}
                        x2={W}
                        y2={y(ref)}
                        stroke='currentColor'
                        strokeWidth={1}
                        strokeDasharray='2 3'
                        opacity={0.35}
                    />
                )}
                <polyline
                    fill='none'
                    stroke='currentColor'
                    strokeWidth={1.2}
                    points={pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                />
            </svg>
        </span>
    );
}

function WatchRow({
    item,
    selected,
    onSelect,
    onRemove,
    showSpark,
}: {
    item: WatchItem;
    selected: boolean;
    onSelect: (c: ContractInfo) => void;
    onRemove: (code: string) => void;
    showSpark: boolean;
}) {
    const quote = useQuote(item.contract.code);
    const tick = quote?.tick;
    const regFlag = useRegulatoryFlag(item.contract.code);

    const close = tick ? Number(tick.close) : item.snapshot?.close;
    const ref = item.contract.reference;
    const chg = tick?.price_chg
        ? Number(tick.price_chg)
        : close !== undefined && ref
          ? close - ref
          : undefined;
    const pct = tick?.pct_chg
        ? Number(tick.pct_chg)
        : chg !== undefined && ref
          ? (chg / ref) * 100
          : undefined;

    const dir = chg === undefined || chg === 0 ? 'flat' : chg > 0 ? 'up' : 'down';
    // 觸及漲/跌停 → 價格填底色標註。優先用 API 權威旗標
    //（isLimitUpPrice/isLimitDownPrice，涵蓋無漲跌幅限制的特殊商品）；
    // 無旗標時（mock/快照）退回與合約漲跌停價比對
    const limitHit = tick?.limit_up
        ? ('up' as const)
        : tick?.limit_down
          ? ('down' as const)
          : close !== undefined && close > 0
            ? item.contract.limit_up > 0 && close >= item.contract.limit_up
                ? ('up' as const)
                : item.contract.limit_down > 0 &&
                    close <= item.contract.limit_down
                  ? ('down' as const)
                  : null
            : null;
    // re-key by flashSeq so the flash animation replays only on real deals
    const flashDir =
        !quote?.flashSeq ? 'none' : quote.lastDir === -1 ? 'down' : 'up';
    const markers: SymbolMarker[] = [
        ...(regFlag ? [regFlag] : []),
        ...(tick?.simtrade ? ['trial' as const] : []),
    ];

    return (
        <div
            key={`${item.contract.code}-${quote?.flashSeq ?? 0}`}
            className={`${styles.row[selected ? 'selected' : 'normal']} ${
                showSpark ? styles.rowSpark : ''
            } ${styles.flash[flashDir]}`}
            onClick={() => onSelect(item.contract)}
        >
            <SymbolCell
                code={item.contract.code}
                name={item.contract.name}
                markers={markers}
                className={styles.symbolCell}
            />
            {showSpark && <Sparkline contract={item.contract} last={close} />}
            <span
                className={`${styles.price} ${
                    limitHit
                        ? styles.priceLimit[limitHit]
                        : panel.dirText[dir]
                }`}
                title={
                    limitHit
                        ? limitHit === 'up'
                            ? '漲停'
                            : '跌停'
                        : undefined
                }
            >
                {fmtPrice(close)}
            </span>
            <span className={`${styles.change} ${panel.dirText[dir]}`}>
                {fmtSigned(chg)} {fmtPct(pct)}
            </span>
            <button
                className={styles.removeBtn}
                title={`移除 ${item.contract.code}`}
                onClick={(e) => {
                    e.stopPropagation(); // don't also select the row
                    onRemove(item.contract.code);
                }}
            >
                ✕
            </button>
        </div>
    );
}

export function Watchlist({
    items,
    selectedCode,
    onSelect,
    onAdd,
    onRemove,
    lists = [],
    activeListId = null,
    onSelectList,
    onCreateList,
    onRenameList,
    onDeleteList,
}: {
    items: WatchItem[];
    selectedCode: string | null;
    onSelect: (c: ContractInfo) => void;
    onAdd: (code: string, type: SecurityType) => Promise<unknown>;
    onRemove: (code: string) => void;
    lists?: { id: string; name: string }[];
    activeListId?: string | null;
    onSelectList?: (id: string) => void;
    onCreateList?: (name: string) => Promise<unknown>;
    onRenameList?: (name: string) => Promise<unknown>;
    onDeleteList?: () => Promise<unknown>;
}) {
    const [input, setInput] = useState('');
    const [type, setType] = useState<SecurityType>('STK');
    const [busy, setBusy] = useState(false);
    const [hits, setHits] = useState<SymbolHit[]>([]);
    const [spark, setSpark] = useState(
        () => localStorage.getItem('sj-pro-watchlist-spark') === '1',
    );

    const toggleSpark = () => {
        setSpark((s) => {
            localStorage.setItem('sj-pro-watchlist-spark', s ? '0' : '1');
            return !s;
        });
    };

    // 代碼或名稱搜尋（去抖）— 股票才查名稱，期貨直接打代碼
    useEffect(() => {
        const q = input.trim();
        if (type !== 'STK' || q.length < 1) {
            setHits([]);
            return;
        }
        let dead = false;
        const t = setTimeout(() => {
            fetchSymbolSearch(q)
                .then((r) => !dead && setHits(r.slice(0, 8)))
                .catch(() => !dead && setHits([]));
        }, 180);
        return () => {
            dead = true;
            clearTimeout(t);
        };
    }, [input, type]);

    const addCode = async (code: string, t: SecurityType) => {
        if (busy) return;
        setBusy(true);
        try {
            await onAdd(code, t);
            setInput('');
            setHits([]);
        } catch {
            // keep input so user can fix typo
        } finally {
            setBusy(false);
        }
    };

    // Enter：有搜尋結果就加第一筆（支援打名稱），否則直接當代碼加
    const submit = () => {
        if (hits.length > 0) return addCode(hits[0]!.code, 'STK');
        const code = input.trim().toUpperCase();
        if (code) return addCode(code, type);
    };

    const activeList = lists.find((l) => l.id === activeListId);
    const builtInActive = activeList?.name === 'nova-pro-v1';
    const displayName = (name: string) =>
        name === 'nova-pro-v1' ? '我的自選' : name;

    const createList = async () => {
        const name = window.prompt('新自選清單名稱');
        if (!name?.trim() || !onCreateList) return;
        try {
            await onCreateList(name.trim());
        } catch (err) {
            window.alert(err instanceof Error ? err.message : '新增清單失敗');
        }
    };

    const renameList = async () => {
        if (!activeList || !onRenameList) return;
        const name = window.prompt('重新命名自選清單', displayName(activeList.name));
        if (!name?.trim()) return;
        try {
            await onRenameList(name.trim());
        } catch (err) {
            window.alert(err instanceof Error ? err.message : '重新命名失敗');
        }
    };

    const deleteList = async () => {
        if (!activeList || !onDeleteList) return;
        if (!window.confirm(`確定刪除「${displayName(activeList.name)}」？`)) return;
        try {
            await onDeleteList();
        } catch (err) {
            window.alert(err instanceof Error ? err.message : '刪除清單失敗');
        }
    };

    return (
        <>
            {onSelectList && (
                <div className={styles.listToolbar}>
                    <select
                        className={styles.typeSelect}
                        style={{ flex: 1 }}
                        value={activeListId ?? ''}
                        onChange={(e) => onSelectList(e.target.value)}
                        title='切換自選清單（含從富果會員匯入的清單）'
                    >
                        {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {displayName(l.name)}
                            </option>
                        ))}
                    </select>
                    {onCreateList && (
                        <button className={panel.btn} title='新增自選清單' onClick={createList}>
                            ＋
                        </button>
                    )}
                    {onRenameList && (
                        <button
                            className={panel.btn}
                            title={builtInActive ? '內建清單不能重新命名' : '重新命名'}
                            disabled={builtInActive}
                            onClick={renameList}
                        >
                            ✎
                        </button>
                    )}
                    {onDeleteList && (
                        <button
                            className={panel.btn}
                            title={builtInActive ? '內建清單不能刪除' : '刪除清單'}
                            disabled={builtInActive || lists.length <= 1}
                            onClick={deleteList}
                        >
                            ×
                        </button>
                    )}
                </div>
            )}
            <div className={panel.panelBody}>
                <div className={styles.list}>
                    {items.map((item) => (
                        <WatchRow
                            key={item.contract.code}
                            item={item}
                            selected={item.contract.code === selectedCode}
                            onSelect={onSelect}
                            onRemove={onRemove}
                            showSpark={spark}
                        />
                    ))}
                </div>
            </div>
            <div className={styles.addRow} style={{ position: 'relative' }}>
                {hits.length > 0 && (
                    <div className={styles.searchMenu}>
                        {hits.map((h) => (
                            <button
                                key={h.code}
                                className={styles.searchItem}
                                onClick={() => addCode(h.code, 'STK')}
                            >
                                <span className={styles.searchCode}>
                                    {h.code}
                                </span>
                                <span className={styles.searchName}>
                                    {h.name}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                <input
                    className={styles.addInput}
                    placeholder='代碼或名稱 e.g. 2330 / 台積電'
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit();
                        if (e.key === 'Escape') setHits([]);
                    }}
                />
                <select
                    className={styles.typeSelect}
                    value={type ?? 'STK'}
                    onChange={(e) => setType(e.target.value as SecurityType)}
                >
                    <option value='STK'>股</option>
                    <option value='FUT'>期</option>
                </select>
                <button className={panel.btn} onClick={submit} disabled={busy}>
                    +
                </button>
                <button
                    className={panel.btn}
                    style={spark ? undefined : { opacity: 0.45 }}
                    title={spark ? '隱藏走勢線' : '顯示當日走勢線'}
                    onClick={toggleSpark}
                >
                    📈
                </button>
            </div>
        </>
    );
}
