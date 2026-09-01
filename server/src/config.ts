// server/src/config.ts

export type MarketProviderName = 'mock' | 'fugle';
export type TradeProviderName = 'mock' | 'fubon' | 'nova' | 'esun' | 'mega';
export type BrokerName = Exclude<TradeProviderName, 'mock'>;

export interface BrokerCreds {
    /** 身分證字號 (fubon/nova) or 證券帳號 aid (esun) */
    idNo: string;
    password: string;
    /** fubon: API key login (apikeyLogin); esun: 行動憑證 API Key */
    apiKey: string;
    /** esun only */
    apiSecret: string;
    certPath: string;
    certPass: string;
    /** override the broker API base URL (e.g. Nova test environment) */
    apiUrl: string;
    /** mega only: seven-digit stock account and four-digit branch */
    account: string;
    branchId: string;
    /** shared Bearer token for the Windows-only MegaAPI bridge */
    bridgeToken: string;
}

export interface Config {
    port: number;
    host: string;
    marketProvider: MarketProviderName;
    tradeProvider: TradeProviderName;
    fugleApiKey: string;
    broker: BrokerCreds;
}

export function credsComplete(c: Partial<BrokerCreds> | undefined | null): boolean {
    return Boolean(c && c.idNo && c.certPath && (c.password || c.apiKey));
}

/**
 * Per-broker credentials from the environment, so the dashboard switcher
 * works without typing anything when the shell already has them:
 *   fubon: FUBON_ID_NO|FUBON_NATIONAL_ID / FUBON_PASSWORD / FUBON_API_KEY /
 *          FUBON_CERT_PATH / FUBON_CERT_PASS
 *   nova:  NOVA_ID_NO|NOVA_NATIONAL_ID / NOVA_PASSWORD|NOVA_ACCOUNT_PASS /
 *          NOVA_CERT_PATH / NOVA_CERT_PASS / NOVA_API_URL
 *   esun:  ESUN_ACCOUNT|ESUN_AID / ESUN_PASSWORD / ESUN_API_KEY /
 *          ESUN_API_SECRET / ESUN_CERT_PATH / ESUN_CERT_PASS /
 *          ESUN_API_URL|ESUN_ENTRY
 */
export function envBrokerCreds(
    name: BrokerName,
    env: NodeJS.ProcessEnv = process.env,
): BrokerCreds | null {
    if (name === 'mega') {
        const mega: BrokerCreds = {
            idNo: env.MEGA_ID_NO ?? env.MEGA_NATIONAL_ID ?? '',
            password: env.MEGA_PASSWORD ?? '',
            apiKey: '',
            apiSecret: '',
            certPath: env.MEGA_CERT_PATH ?? '',
            certPass: env.MEGA_CERT_PASS ?? '',
            apiUrl: env.MEGA_BRIDGE_URL ?? '',
            account: env.MEGA_ACCOUNT ?? '',
            branchId: env.MEGA_BRANCH_ID ?? '',
            bridgeToken: env.MEGA_BRIDGE_TOKEN ?? '',
        };
        return megaCredsComplete(mega) ? mega : null;
    }
    const creds: BrokerCreds =
        name === 'fubon'
            ? {
                  idNo: env.FUBON_ID_NO ?? env.FUBON_NATIONAL_ID ?? '',
                  password: env.FUBON_PASSWORD ?? '',
                  apiKey: env.FUBON_API_KEY ?? '',
                  apiSecret: '',
                  certPath: env.FUBON_CERT_PATH ?? '',
                  certPass: env.FUBON_CERT_PASS ?? '',
                  apiUrl: '',
                  account: '',
                  branchId: '',
                  bridgeToken: '',
              }
            : name === 'nova'
              ? {
                    idNo: env.NOVA_ID_NO ?? env.NOVA_NATIONAL_ID ?? '',
                    password: env.NOVA_PASSWORD ?? env.NOVA_ACCOUNT_PASS ?? '',
                    apiKey: '',
                    apiSecret: '',
                    certPath: env.NOVA_CERT_PATH ?? '',
                    certPass: env.NOVA_CERT_PASS ?? '',
                    apiUrl: env.NOVA_API_URL ?? '',
                    account: '',
                    branchId: '',
                    bridgeToken: '',
                }
              : {
                    idNo: env.ESUN_ACCOUNT ?? env.ESUN_AID ?? '',
                    password: env.ESUN_PASSWORD ?? '',
                    apiKey: env.ESUN_API_KEY ?? '',
                    apiSecret: env.ESUN_API_SECRET ?? '',
                    certPath: env.ESUN_CERT_PATH ?? '',
                    certPass: env.ESUN_CERT_PASS ?? '',
                    apiUrl: env.ESUN_API_URL ?? env.ESUN_ENTRY ?? '',
                    account: '',
                    branchId: '',
                    bridgeToken: '',
                };
    return credsComplete(creds) ? creds : null;
}

export function megaCredsComplete(
    c: Partial<BrokerCreds> | undefined | null,
): boolean {
    return Boolean(
        c &&
            c.idNo &&
            c.password &&
            c.account &&
            c.branchId &&
            c.certPath &&
            c.certPass &&
            c.apiUrl &&
            c.bridgeToken,
    );
}

function pick<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    fallback: T,
): T {
    if (value && (allowed as readonly string[]).includes(value)) {
        return value as T;
    }
    if (value) {
        throw new Error(
            `invalid provider "${value}" — expected one of: ${allowed.join(', ')}`,
        );
    }
    return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    return {
        port: Number(env.PORT) || 8080,
        // Desktop keeps the loopback-only default. Containers opt in to
        // external access with KAUIK_HOST=0.0.0.0.
        host: env.KAUIK_HOST?.trim() || '127.0.0.1',
        marketProvider: pick(env.MARKET_PROVIDER, ['mock', 'fugle'], 'mock'),
        tradeProvider: pick(
            env.TRADE_PROVIDER,
            ['mock', 'fubon', 'nova', 'esun', 'mega'],
            'mock',
        ),
        fugleApiKey: env.FUGLE_API_KEY ?? '',
        broker: {
            idNo: env.BROKER_ID_NO ?? '',
            password: env.BROKER_PASSWORD ?? '',
            apiKey: env.BROKER_API_KEY ?? '',
            apiSecret: env.BROKER_API_SECRET ?? '',
            certPath: env.BROKER_CERT_PATH ?? '',
            certPass: env.BROKER_CERT_PASS ?? '',
            apiUrl: env.BROKER_API_URL ?? '',
            account: env.BROKER_ACCOUNT ?? '',
            branchId: env.BROKER_BRANCH_ID ?? '',
            bridgeToken: env.BROKER_BRIDGE_TOKEN ?? '',
        },
    };
}
