// server/src/runtime-config.ts — user-editable settings persisted to
// server/data/config.json (gitignored). Seeded from env on first run.

import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
    splitBrokerCreds,
    type BrokerMetadata,
} from './broker-credential-parts.ts';
import type { BrokerCreds, TradeProviderName } from './config.ts';

type BrokerKey = 'fubon' | 'nova' | 'esun' | 'mega';

interface EncryptedBrokerCreds {
    v: 1;
    salt: string;
    iv: string;
    tag: string;
    data: string;
}

interface PersistedRuntimeConfig extends Partial<RuntimeConfig> {
    encryptedBrokerCreds?: EncryptedBrokerCreds;
}

export interface RuntimeConfig {
    /** standalone market choice (broker modes carry their own market data) */
    marketProvider: 'mock' | 'fugle';
    fugleApiKey: string;
    tradeProvider: TradeProviderName;
    defaultTradeBroker: BrokerKey | null;
    /** non-secret broker setup metadata persisted to config.json */
    brokerMetadata: Partial<Record<BrokerKey, BrokerMetadata>>;
    /** legacy/plaintext credentials kept in memory only for migration */
    brokerCreds: Partial<Record<BrokerKey, BrokerCreds>>;
}

export class RuntimeConfigStore {
    private config: RuntimeConfig;

    constructor(
        private filePath: string,
        envSeed: { marketProvider?: string; fugleApiKey?: string } = {},
        private options: { secretKey?: string } = {},
    ) {
        let loaded: PersistedRuntimeConfig = {};
        try {
            loaded = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
            // first run — use env seed
        }
        const legacyCreds = loaded.brokerCreds ?? {};
        const encryptedCreds = decryptBrokerCreds(
            loaded.encryptedBrokerCreds,
            options.secretKey,
        );
        this.config = {
            marketProvider:
                loaded.marketProvider ??
                (envSeed.marketProvider === 'fugle' ? 'fugle' : 'mock'),
            fugleApiKey: loaded.fugleApiKey ?? envSeed.fugleApiKey ?? '',
            tradeProvider: loaded.tradeProvider ?? 'mock',
            defaultTradeBroker:
                loaded.defaultTradeBroker === 'fubon' ||
                loaded.defaultTradeBroker === 'nova' ||
                loaded.defaultTradeBroker === 'esun' ||
                loaded.defaultTradeBroker === 'mega'
                    ? loaded.defaultTradeBroker
                    : null,
            brokerMetadata:
                loaded.brokerMetadata ?? deriveBrokerMetadata(legacyCreds),
            brokerCreds: { ...legacyCreds, ...encryptedCreds },
        };
    }

    get(): RuntimeConfig {
        return { ...this.config };
    }

    set(patch: Partial<RuntimeConfig>): void {
        const brokerMetadata = {
            ...this.config.brokerMetadata,
            ...deriveBrokerMetadata(patch.brokerCreds),
            ...patch.brokerMetadata,
        };
        this.config = { ...this.config, ...patch, brokerMetadata };
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(
            this.filePath,
            JSON.stringify(
                persistedConfig(this.config, this.options.secretKey),
                null,
                2,
            ),
            {
                mode: 0o600,
            },
        );
    }
}

function deriveBrokerMetadata(
    brokerCreds: Partial<Record<BrokerKey, BrokerCreds>> | undefined,
): Partial<Record<BrokerKey, BrokerMetadata>> {
    const metadata: Partial<Record<BrokerKey, BrokerMetadata>> = {};
    for (const broker of ['fubon', 'nova', 'esun', 'mega'] as const) {
        const creds = brokerCreds?.[broker];
        if (creds) metadata[broker] = splitBrokerCreds(creds).metadata;
    }
    return metadata;
}

function persistedConfig(config: RuntimeConfig, secretKey?: string) {
    return {
        marketProvider: config.marketProvider,
        fugleApiKey: config.fugleApiKey,
        tradeProvider: config.tradeProvider,
        defaultTradeBroker: config.defaultTradeBroker,
        brokerMetadata: config.brokerMetadata,
        ...(secretKey && Object.keys(config.brokerCreds).length > 0
            ? {
                  encryptedBrokerCreds: encryptBrokerCreds(
                      config.brokerCreds,
                      secretKey,
                  ),
              }
            : {}),
    };
}

function encryptBrokerCreds(
    creds: RuntimeConfig['brokerCreds'],
    secretKey: string,
): EncryptedBrokerCreds {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(secretKey, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([
        cipher.update(JSON.stringify(creds), 'utf8'),
        cipher.final(),
    ]);
    return {
        v: 1,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    };
}

function decryptBrokerCreds(
    payload: EncryptedBrokerCreds | undefined,
    secretKey: string | undefined,
): RuntimeConfig['brokerCreds'] {
    if (!payload || payload.v !== 1 || !secretKey) return {};
    try {
        const key = scryptSync(
            secretKey,
            Buffer.from(payload.salt, 'base64'),
            32,
        );
        const decipher = createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(payload.iv, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(payload.data, 'base64')),
            decipher.final(),
        ]).toString('utf8');
        const parsed = JSON.parse(plaintext);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        // A missing/changed key must not prevent mock mode from starting.
        return {};
    }
}
