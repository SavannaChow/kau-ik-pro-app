import type { TradeProviderName } from './backend';

export type BrokerName = Exclude<TradeProviderName, 'mock'>;

export interface BrokerSetupForm {
    idNo: string;
    password: string;
    apiKey: string;
    apiSecret: string;
    certPath: string;
    certPass: string;
    apiUrl?: string;
    account: string;
    branchId: string;
    bridgeToken: string;
}

export interface BrokerSecretPayload {
    idNo: string;
    password: string;
    apiKey: string;
    apiSecret: string;
    certPass: string;
    account: string;
    branchId: string;
    bridgeToken: string;
}

export interface BrokerMetadataPayload {
    provider: BrokerName;
    cert_path: string;
    api_url: string;
}

export function brokerSecretsFromSetupForm(
    form: BrokerSetupForm,
): BrokerSecretPayload {
    return {
        idNo: form.idNo,
        password: form.password,
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
        certPass: form.certPass,
        account: form.account,
        branchId: form.branchId,
        bridgeToken: form.bridgeToken,
    };
}

export function brokerMetadataFromSetupForm(
    broker: BrokerName,
    form: BrokerSetupForm,
): BrokerMetadataPayload {
    return {
        provider: broker,
        cert_path: form.certPath,
        api_url: form.apiUrl ?? '',
    };
}
