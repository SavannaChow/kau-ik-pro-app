// server/src/routes/watchlist.ts — server-side watchlist persistence

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { ServerWatchlist } from '../types/dto.ts';

export function registerWatchlistRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get('/api/v1/watchlist', async () => ctx.watchlists.all());

    app.post<{
        Body: { name: string; contracts: ServerWatchlist['contracts'] };
    }>('/api/v1/watchlist', async (req, reply) => {
        const name = req.body?.name?.trim();
        if (!name) return reply.code(400).send({ detail: '清單名稱不可為空' });
        if (ctx.watchlists.all().some((l) => l.name === name)) {
            return reply.code(409).send({ detail: `清單名稱已存在：${name}` });
        }
        return ctx.watchlists.create(name, req.body.contracts ?? []);
    });

    // bulk import (e.g. synced from an external watchlist source) —
    // upserts by name so re-imports update in place
    app.post<{
        Body: {
            lists?: {
                name?: string;
                contracts?: ServerWatchlist['contracts'];
            }[];
        };
    }>('/api/v1/watchlist/import', async (req, reply) => {
        const lists = req.body?.lists;
        if (!Array.isArray(lists) || lists.length === 0) {
            return reply
                .code(400)
                .send({ detail: 'lists 需為非空陣列：[{name, contracts}]' });
        }
        let created = 0;
        let updated = 0;
        for (const l of lists) {
            if (!l?.name || !Array.isArray(l.contracts)) continue;
            const res = ctx.watchlists.upsertByName(l.name, l.contracts);
            if (res.created) created += 1;
            else updated += 1;
        }
        return { imported: created + updated, created, updated };
    });

    app.put<{
        Params: { id: string };
        Body: { contracts: ServerWatchlist['contracts'] };
    }>('/api/v1/watchlist/:id', async (req, reply) => {
        const updated = ctx.watchlists.update(
            req.params.id,
            req.body.contracts ?? [],
        );
        if (!updated) {
            return reply
                .code(404)
                .send({ detail: `watchlist not found: ${req.params.id}` });
        }
        return updated;
    });

    app.patch<{
        Params: { id: string };
        Body: { name?: string };
    }>('/api/v1/watchlist/:id', async (req, reply) => {
        const name = req.body?.name?.trim();
        if (!name) return reply.code(400).send({ detail: '清單名稱不可為空' });
        if (ctx.watchlists.all().some((l) => l.id !== req.params.id && l.name === name)) {
            return reply.code(409).send({ detail: `清單名稱已存在：${name}` });
        }
        const updated = ctx.watchlists.rename(req.params.id, name);
        if (!updated) {
            return reply
                .code(404)
                .send({ detail: `watchlist not found: ${req.params.id}` });
        }
        return updated;
    });

    app.delete<{
        Params: { id: string };
    }>('/api/v1/watchlist/:id', async (req, reply) => {
        if (ctx.watchlists.all().length <= 1) {
            return reply.code(409).send({ detail: '至少需保留一個自選清單' });
        }
        if (!ctx.watchlists.delete(req.params.id)) {
            return reply
                .code(404)
                .send({ detail: `watchlist not found: ${req.params.id}` });
        }
        return { ok: true };
    });
}
