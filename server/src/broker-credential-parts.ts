import type { BrokerCreds } from './config.ts';

export type BrokerMetadata = Pick<BrokerCreds, 'certPath' | 'apiUrl'>;

export type BrokerSecrets = Pick<
    BrokerCreds,
    | 'idNo'
    | 'password'
    | 'apiKey'
    | 'apiSecret'
    | 'certPass'
    | 'account'
    | 'branchId'
    | 'bridgeToken'
>;

export function splitBrokerCreds(creds: BrokerCreds): {
    metadata: BrokerMetadata;
    secrets: BrokerSecrets;
} {
    return {
        metadata: {
            certPath: creds.certPath,
            apiUrl: creds.apiUrl,
        },
        secrets: {
            idNo: creds.idNo,
            password: creds.password,
            apiKey: creds.apiKey,
            apiSecret: creds.apiSecret,
            certPass: creds.certPass,
            account: creds.account,
            branchId: creds.branchId,
            bridgeToken: creds.bridgeToken,
        },
    };
}

export function assembleBrokerCreds(
    metadata: Partial<BrokerMetadata> | undefined | null,
    secrets: Partial<BrokerSecrets> | undefined | null,
): BrokerCreds | null {
    if (!secrets) return null;
    return {
        idNo: secrets.idNo ?? '',
        password: secrets.password ?? '',
        apiKey: secrets.apiKey ?? '',
        apiSecret: secrets.apiSecret ?? '',
        certPath: metadata?.certPath ?? '',
        certPass: secrets.certPass ?? '',
        apiUrl: metadata?.apiUrl ?? '',
        account: secrets.account ?? '',
        branchId: secrets.branchId ?? '',
        bridgeToken: secrets.bridgeToken ?? '',
    };
}
