import { timingSafeEqual } from 'node:crypto';

function safeEqual(actual: string, expected: string): boolean {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function webAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.KAUIK_WEB_USERNAME && env.KAUIK_WEB_PASSWORD);
}

export function verifyWebBasicAuth(
    header: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (!webAuthConfigured(env)) return true;
    if (!header?.startsWith('Basic ')) return false;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const split = decoded.indexOf(':');
        if (split < 0) return false;
        return (
            safeEqual(decoded.slice(0, split), env.KAUIK_WEB_USERNAME ?? '') &&
            safeEqual(decoded.slice(split + 1), env.KAUIK_WEB_PASSWORD ?? '')
        );
    } catch {
        return false;
    }
}
