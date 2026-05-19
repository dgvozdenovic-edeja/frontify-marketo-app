import { AppBridgePlatformApp, appContext, appSettings } from '@frontify/app-bridge-app';
import { Badge, Button, Flex, Heading, TextInput } from '@frontify/fondue/components';
import { useState } from 'react';
import { DevTools } from './DevTools';
import { extractAssetIds } from './utils';

type AppSettingsType = { 'marketo-folder-name': string };
type Programme = { id: number; name: string; type: string };

export const App = () => {
    const context = appContext();
    const appBridge = new AppBridgePlatformApp();
    const bridge = appBridge as unknown as { api: (a: unknown) => Promise<unknown> };
    const ctx = context as Record<string, unknown>;

    const [liveSettings] = appSettings<AppSettingsType>();

    // Token
    const [mktoToken, setMktoToken] = useState('');
    const [mktoTokenFetchedAt, setMktoTokenFetchedAt] = useState<number | null>(null);
    const [mktoTokenStatus, setMktoTokenStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [mktoTokenError, setMktoTokenError] = useState('');
    const [mktoTokenLog, setMktoTokenLog] = useState<string[]>([]);
    const [manualToken, setManualToken] = useState('');

    // Programmes
    const [programmes, setProgrammes] = useState<Programme[]>([]);
    const [programmesStatus, setProgrammesStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [programmesError, setProgrammesError] = useState('');
    const [selectedProgrammeId, setSelectedProgrammeId] = useState('');

    // Push
    const [pushStatus, setPushStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [pushDetail, setPushDetail] = useState('');

    const fetchProgrammes = async (token: string) => {
        setProgrammesStatus('loading');
        setProgrammesError('');
        setSelectedProgrammeId('');
        try {
            const res = await bridge.api({
                name: 'executeSecureRequest',
                payload: { endpoint: 'marketo-list-programmes', requestParams: { access_token: token } },
            }) as Response;
            const output = await res.json() as { success: boolean; result?: Programme[] };
            if (!output.success) throw new Error(JSON.stringify(output));
            setProgrammes(output.result ?? []);
            setProgrammesStatus('ok');
        } catch (err) {
            setProgrammesStatus('error');
            setProgrammesError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleFetchToken = async () => {
        const log: string[] = [];
        const addLog = (msg: string) => { log.push(`[${new Date().toISOString()}] ${msg}`); setMktoTokenLog([...log]); };

        setMktoTokenStatus('loading');
        setMktoTokenError('');
        setMktoTokenLog([]);
        addLog('calling executeSecureRequest (marketo-get-token)…');

        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timed out after 15s')), 15_000)
        );

        try {
            const res = await Promise.race([
                bridge.api({ name: 'executeSecureRequest', payload: { endpoint: 'marketo-get-token' } }),
                timeout,
            ]) as Response;
            const output = await res.json() as Record<string, unknown>;
            addLog(`response: ${JSON.stringify(output)}`);
            if (!output.access_token) throw new Error(`No access_token: ${JSON.stringify(output)}`);
            const token = output.access_token as string;
            setMktoToken(token);
            setMktoTokenFetchedAt(Date.now());
            setMktoTokenStatus('ok');
            addLog('connected');
            void fetchProgrammes(token);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            addLog(`ERROR: ${msg}`);
            setMktoTokenStatus('error');
            setMktoTokenError(msg);
        }
    };

    const handleUseManualToken = () => {
        const t = manualToken.trim();
        if (!t) return;
        setMktoToken(t);
        setMktoTokenFetchedAt(Date.now());
        setMktoTokenStatus('ok');
        setMktoTokenError('');
        setMktoTokenLog(['Token set manually']);
        void fetchProgrammes(t);
    };

    const handlePush = async () => {
        if (!mktoToken) { setPushStatus('error'); setPushDetail('Connect first.'); return; }
        if (!selectedProgrammeId) { setPushStatus('error'); setPushDetail('Select a programme first.'); return; }

        const assetId = (ctx.assetId as string | undefined) ?? extractAssetIds(ctx.selection)[0];
        if (!assetId) { setPushStatus('error'); setPushDetail('No asset selected.'); return; }

        setPushStatus('loading');
        setPushDetail('Getting asset info from Frontify…');

        let previewUrl: string;
        let tokenName: string;
        try {
            const info = await bridge.api({ name: 'getAssetResourceInformation', payload: { assetId } }) as Record<string, unknown>;
            previewUrl = (info.previewUrl ?? info.src ?? '') as string;
            const rawTitle = ((info.title ?? info.filename ?? assetId) as string)
                .replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
            tokenName = `frontify-${rawTitle}`;
            if (!previewUrl) throw new Error('previewUrl missing from asset info');
        } catch (err) {
            setPushStatus('error');
            setPushDetail(`Failed to get asset: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }

        setPushStatus('loading');
        setPushDetail(`Writing {{my.${tokenName}}} to folder ${selectedProgrammeId}…\ntoken_name="${tokenName}"\ntoken_value="${previewUrl}"`);

        let createData: Record<string, unknown>;
        try {
            const createOutput = await bridge.api({
                name: 'executeSecureRequest',
                payload: {
                    endpoint: 'marketo-create-token',
                    requestParams: {
                        folder_id: selectedProgrammeId.trim(),
                        token_name: tokenName,
                        token_value: previewUrl,
                        access_token: mktoToken,
                    },
                },
            }) as Response;
            createData = await createOutput.json() as Record<string, unknown>;
            if (!createData.success) {
                setPushStatus('error');
                setPushDetail(`Create failed:\n${JSON.stringify(createData, null, 2)}`);
                return;
            }
        } catch (err) {
            setPushStatus('error');
            setPushDetail(`Create error: ${String(err)}`);
            return;
        }

        setPushStatus('loading');
        setPushDetail('Verifying…');

        let allTokens: Array<{ name: string; value: string }> = [];
        try {
            const listOutput = await bridge.api({
                name: 'executeSecureRequest',
                payload: {
                    endpoint: 'marketo-list-tokens',
                    requestParams: { folder_id: selectedProgrammeId.trim(), access_token: mktoToken },
                },
            }) as Response;
            const listData = await listOutput.json() as { result?: Array<{ name: string; value: string }> };
            allTokens = listData.result ?? [];
        } catch { /* non-fatal */ }

        const match = allTokens.find(t => t.name === tokenName);
        setPushStatus('ok');
        setPushDetail([
            `✓ {{my.${tokenName}}}`,
            `  Value: ${match?.value ?? previewUrl}`,
            `  Folder: ${selectedProgrammeId}`,
            '',
            JSON.stringify(createData, null, 2),
        ].join('\n'));
    };

    const selectedAssetId = (ctx.assetId as string | undefined) ?? extractAssetIds(ctx.selection)[0];
    const tokenAgeMin = mktoTokenFetchedAt ? Math.floor((Date.now() - mktoTokenFetchedAt) / 60000) : null;

    return (
        <div className="tw-font-body tw-min-h-screen tw-bg-base tw-p-6">
            <Heading size="large" weight="strong">Sync to Marketo</Heading>
            <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-4">
                Folder: <strong>{liveSettings?.['marketo-folder-name'] || 'Frontify Assets'}</strong>
            </p>

            {/* ── Step 1: Connect ── */}
            <div className="tw-border tw-border-line tw-rounded tw-p-4 tw-mb-4">
                <p className="tw-font-medium tw-text-text tw-mb-3">Step 1 — Connect</p>

                <div className="tw-mb-3 tw-text-body-small">
                    {mktoTokenStatus === 'idle' && <span className="tw-text-text-weak">Not connected</span>}
                    {mktoTokenStatus === 'loading' && <Badge emphasis="strong">Connecting…</Badge>}
                    {mktoTokenStatus === 'ok' && tokenAgeMin !== null && (
                        <Flex gap="8px" alignItems="center">
                            <Badge emphasis="strong">Connected</Badge>
                            <span className="tw-text-text-weak">
                                {60 - tokenAgeMin > 0 ? `~${60 - tokenAgeMin} min remaining` : 'Token may have expired — reconnect'}
                            </span>
                        </Flex>
                    )}
                    {mktoTokenStatus === 'error' && (
                        <span className="tw-text-danger tw-text-body-small">{mktoTokenError}</span>
                    )}
                </div>

                <Button onPress={handleFetchToken}>{mktoTokenStatus === 'ok' ? 'Re-connect' : 'Connect'}</Button>

                {mktoTokenLog.length > 0 && (
                    <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-28 tw-mt-3">
                        {mktoTokenLog.join('\n')}
                    </pre>
                )}

                {process.env.NODE_ENV === 'development' && (
                    <div className="tw-mt-4 tw-pt-4 tw-border-t tw-border-line-weak">
                        <p className="tw-text-body-small tw-text-text-weak tw-mb-2">Dev — paste token manually</p>
                        <Flex gap="8px" alignItems="center">
                            <TextInput
                                id="manual-token"
                                value={manualToken}
                                onChange={(e) => setManualToken(e.target.value)}
                                placeholder="Paste access_token…"
                            />
                            <Button onPress={handleUseManualToken}>Use</Button>
                        </Flex>
                    </div>
                )}
            </div>

            {/* ── Step 2: Push ── */}
            <div className={`tw-border tw-rounded tw-p-4 ${mktoTokenStatus === 'ok' ? 'tw-border-line' : 'tw-border-line-weak tw-opacity-60'}`}>
                <p className="tw-font-medium tw-text-text tw-mb-3">Step 2 — Push Asset</p>

                <div className="tw-mb-3 tw-text-body-small tw-text-text-weak">
                    Asset: <strong>{selectedAssetId ?? '(none — select an asset first)'}</strong>
                </div>

                <div className="tw-mb-4">
                    {programmesStatus === 'idle' && (
                        <p className="tw-text-text-weak tw-text-body-small">Connect to Marketo to load programmes.</p>
                    )}
                    {programmesStatus === 'loading' && (
                        <p className="tw-text-text-weak tw-text-body-small">Loading programmes…</p>
                    )}
                    {programmesStatus === 'error' && (
                        <p className="tw-text-danger tw-text-body-small">{programmesError}</p>
                    )}
                    {programmesStatus === 'ok' && (
                        <Flex gap="8px" alignItems="center">
                            <span className="tw-text-body-small tw-text-text-weak tw-w-36 tw-flex-shrink-0">Programme</span>
                            <select
                                value={selectedProgrammeId}
                                onChange={(e) => setSelectedProgrammeId(e.target.value)}
                                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--f-color-line, #d1d5db)', fontSize: 14, background: 'var(--f-color-base, #fff)', color: 'var(--f-color-text, #111)' }}
                            >
                                <option value="">Select a programme…</option>
                                {programmes.map(p => (
                                    <option key={p.id} value={String(p.id)}>
                                        {p.name} ({p.type})
                                    </option>
                                ))}
                            </select>
                        </Flex>
                    )}
                </div>

                <Flex gap="8px" className="tw-mb-3">
                    <Button onPress={handlePush} emphasis="strong">Push to Marketo</Button>
                    {pushStatus === 'loading' && <Badge emphasis="strong">Running…</Badge>}
                    {pushStatus === 'ok'      && <Badge emphasis="strong">✓ Done</Badge>}
                    {pushStatus === 'error'   && <Badge emphasis="strong">Error</Badge>}
                </Flex>

                {pushDetail && (
                    <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-72">
                        {pushDetail}
                    </pre>
                )}
            </div>

            {process.env.NODE_ENV === 'development' && <DevTools />}
        </div>
    );
};
