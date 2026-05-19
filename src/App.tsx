import { AppBridgePlatformApp, appContext, appSettings, appUserState } from '@frontify/app-bridge-app';
import { Badge, Button, Flex, Heading, TextInput } from '@frontify/fondue/components';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Section = 'context' | 'graphql' | 'state' | 'network' | 'settings' | 'push';

type AppSettingsType = {
    'marketo-folder-name': string;
};

type TestResult = {
    status: 'idle' | 'loading' | 'ok' | 'error';
    detail: string;
};

const GRAPHQL_QUERY = `
query GetAsset($id: ID!) {
  asset(id: $id) {
    id
    title
    __typename
    status
    workflowTask { title status { name } }
    ... on Image { previewUrl width height }
  }
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function extractAssetIds(selection: unknown): string[] {
    if (!selection) return [];
    const sel = selection as Record<string, unknown>;
    if (sel.assets && typeof sel.assets === 'object') {
        const assets = sel.assets as { ids?: string[] };
        if (Array.isArray(assets.ids)) return assets.ids;
    }
    if (Array.isArray(sel.ids)) return sel.ids as string[];
    if (typeof sel.id === 'string') return [sel.id];
    if (Array.isArray(selection)) {
        return (selection as unknown[]).map((item) =>
            typeof item === 'string' ? item : (item as Record<string, string>).id ?? ''
        ).filter(Boolean);
    }
    return [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const App = () => {
    const context = appContext();
    const appBridge = new AppBridgePlatformApp();
    const bridge = appBridge as unknown as { api: (a: unknown) => Promise<unknown> };

    const [activeSection, setActiveSection] = useState<Section>('context');
    const [currentUser, setCurrentUser] = useState<Record<string, unknown> | null>(null);
    const [rawContext, setRawContext] = useState<Record<string, unknown> | null>(null);

    // Settings — server-side after deploy, localStorage in dev
    const [liveSettings, setLiveSettings] = appSettings<AppSettingsType>();

    // Q1 — user state persistence probe
    const [userState, setUserState] = appUserState<{ probe_value: string; probe_written_at: string }>();
    const [stateInput, setStateInput] = useState('');
    const [readBackValue, setReadBackValue] = useState<string | null>(null);

    // Test results
    const [assetInfoResult, setAssetInfoResult] = useState<TestResult>({ status: 'idle', detail: '' });
    const [graphqlResult, setGraphqlResult] = useState<TestResult>({ status: 'idle', detail: '' });
    const [fetchResult, setFetchResult] = useState<TestResult>({ status: 'idle', detail: '' });
    const [secureResult, setSecureResult] = useState<TestResult>({ status: 'idle', detail: '' });

    // Push tab — Step 1: stored Marketo token
    const [mktoToken, setMktoToken] = useState('');
    const [mktoTokenFetchedAt, setMktoTokenFetchedAt] = useState<number | null>(null);
    const [mktoTokenStatus, setMktoTokenStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [mktoTokenError, setMktoTokenError] = useState('');
    const [mktoTokenDebugLog, setMktoTokenDebugLog] = useState<string[]>([]);
    const [manualToken, setManualToken] = useState('');
    // Push tab — Step 2: push result
    const [pushFolderId, setPushFolderId] = useState('');
    const [pushResult, setPushResult] = useState<TestResult>({ status: 'idle', detail: '' });

    useEffect(() => {
        // getCurrentUser — confirmed works
        bridge.api({ name: 'getCurrentUser' })
            .then((user) => setCurrentUser(user as Record<string, unknown>))
            .catch(() => setCurrentUser({}));

        // appBridge.context().get() — extra fields vs appContext() hook
        try {
            const obs = appBridge.context() as unknown as { get?: () => unknown };
            if (typeof obs.get === 'function') {
                Promise.resolve(obs.get())
                    .then((c) => setRawContext(c as Record<string, unknown>))
                    .catch(() => {});
            }
        } catch { /* ignore */ }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const ctx = context as Record<string, unknown>;
    const selectedIds = extractAssetIds(ctx.selection);

    // ---------------------------------------------------------------------------
    // Q1: User state write/read
    // ---------------------------------------------------------------------------
    const handleWriteState = () => {
        setUserState({ probe_value: stateInput, probe_written_at: new Date().toISOString() });
        setReadBackValue(null);
    };

    const handleReadState = () => {
        setReadBackValue(
            userState
                ? `value="${userState.probe_value}" written_at="${userState.probe_written_at}"`
                : '(state is empty)'
        );
    };

    // ---------------------------------------------------------------------------
    // GraphQL via executeGraphQl (App Bridge — no manual token needed)
    // ---------------------------------------------------------------------------
    const handleAssetInfo = async () => {
        const assetId = extractAssetIds(ctx.selection)[0];
        if (!assetId) {
            setAssetInfoResult({ status: 'error', detail: 'No asset in selection.' });
            return;
        }
        setAssetInfoResult({ status: 'loading', detail: `Calling getAssetResourceInformation(${assetId})…` });
        try {
            const result = await bridge.api({ name: 'getAssetResourceInformation', payload: { assetId } });
            setAssetInfoResult({ status: 'ok', detail: JSON.stringify(result, null, 2) });
        } catch (err) {
            setAssetInfoResult({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
    };

    const handleGraphQL = async () => {
        const assetId = (ctx.assetId as string | undefined) ?? extractAssetIds(ctx.selection)[0];
        if (!assetId) {
            setGraphqlResult({ status: 'error', detail: 'No assetId — trigger the app from an asset.' });
            return;
        }
        setGraphqlResult({ status: 'loading', detail: 'Calling executeGraphQl via App Bridge…' });
        try {
            const result = await bridge.api({
                name: 'executeGraphQl',
                payload: { query: GRAPHQL_QUERY, variables: { id: assetId }, beta: true },
            });
            setGraphqlResult({ status: 'ok', detail: JSON.stringify(result, null, 2) });
        } catch (err) {
            setGraphqlResult({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
    };

    // ---------------------------------------------------------------------------
    // Network: direct fetch() CORS probe
    // ---------------------------------------------------------------------------
    const handleDirectFetch = async () => {
        setFetchResult({ status: 'loading', detail: 'Probing httpbin…' });
        try {
            const res = await fetch('https://httpbin.org/get', { headers: { Accept: 'application/json' } });
            const data = await res.json() as { headers?: { Origin?: string }; origin?: string };
            setFetchResult({
                status: 'ok',
                detail: `HTTP ${res.status} ✓\nOrigin seen by server: "${data.headers?.Origin ?? '(none)'}"\nRequest IP: ${data.origin ?? '?'}`,
            });
        } catch (err) {
            setFetchResult({ status: 'error', detail: String(err) });
        }
    };

    // ---------------------------------------------------------------------------
    // Secure Request: executeSecureRequest → Marketo OAuth token
    // All credentials come from manifest secrets (%%SECRET%% substitution).
    // ---------------------------------------------------------------------------
    const handleSecureRequest = async () => {
        setSecureResult({ status: 'loading', detail: 'Calling marketo-get-token via Frontify proxy…' });
        try {
            const result = await bridge.api({
                name: 'executeSecureRequest',
                payload: { endpoint: 'marketo-get-token' },
            });
            setSecureResult({ status: 'ok', detail: JSON.stringify(result, null, 2) });
        } catch (err) {
            setSecureResult({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
    };

    // ---------------------------------------------------------------------------
    // Push — Step 1: fetch and store Marketo access token via executeSecureRequest
    // All credentials (identity URL, client ID, secret) come from manifest secrets —
    // .secret.json in dev, Marketplace Access Keys in prod.
    // ---------------------------------------------------------------------------
    const handleFetchToken = async () => {
        const log: string[] = [];
        const addLog = (msg: string) => { log.push(`[${new Date().toISOString()}] ${msg}`); setMktoTokenDebugLog([...log]); };

        setMktoTokenStatus('loading');
        setMktoTokenError('');
        setMktoTokenDebugLog([]);

        addLog(`endpoint: marketo-get-token`);
        addLog(`calling executeSecureRequest…`);

        const TIMEOUT_MS = 30_000;
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`executeSecureRequest timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
        );

        try {
            const output = await Promise.race([
                bridge.api({
                    name: 'executeSecureRequest',
                    payload: { endpoint: 'marketo-get-token' },
                }),
                timeout,
            ]) as { data: Record<string, unknown>; status: number; statusText: string };
            addLog(`bridge resolved — HTTP ${output.status} ${output.statusText}`);
            addLog(`response: ${JSON.stringify(output.data)}`);
            if (!output.data?.access_token) throw new Error(`No access_token in response: ${JSON.stringify(output.data)}`);
            setMktoToken(output.data.access_token as string);
            setMktoTokenFetchedAt(Date.now());
            setMktoTokenStatus('ok');
            addLog('access_token stored successfully');
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
        setMktoTokenDebugLog(['Token set manually — bypasses executeSecureRequest']);
    };

    // ---------------------------------------------------------------------------
    // Push — Step 2: push selected asset CDN URL → Marketo My Token
    // ---------------------------------------------------------------------------
    const handlePush = async () => {
        if (!mktoToken) {
            setPushResult({ status: 'error', detail: 'Fetch the Marketo token first (Step 1 above).' });
            return;
        }
        if (!pushFolderId.trim()) {
            setPushResult({ status: 'error', detail: 'Enter the target Programme or Folder ID.' });
            return;
        }

        const assetId = (ctx.assetId as string | undefined) ?? extractAssetIds(ctx.selection)[0];
        if (!assetId) {
            setPushResult({ status: 'error', detail: 'No asset selected — open the app from an asset or select one first.' });
            return;
        }

        // 1. Get asset CDN URL from Frontify via App Bridge
        setPushResult({ status: 'loading', detail: 'Step 1/3 — getting asset info from Frontify…' });
        let previewUrl: string;
        let tokenName: string;
        try {
            const info = await bridge.api({ name: 'getAssetResourceInformation', payload: { assetId } }) as Record<string, unknown>;
            previewUrl = (info.previewUrl ?? info.src ?? '') as string;
            const rawTitle = ((info.title ?? info.filename ?? assetId) as string)
                .replace(/[^a-zA-Z0-9-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .toLowerCase();
            tokenName = `frontify-${rawTitle}`;
            if (!previewUrl) throw new Error('previewUrl missing from asset info — asset may not be an image');
        } catch (err) {
            setPushResult({ status: 'error', detail: `Step 1 failed: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }

        // 2. Create My Token via executeSecureRequest
        setPushResult({ status: 'loading', detail: `Step 2/3 — writing {{my.${tokenName}}} to folder ${pushFolderId}…` });

        let createData: Record<string, unknown>;
        try {
            const createOutput = await bridge.api({
                name: 'executeSecureRequest',
                payload: {
                    endpoint: 'marketo-create-token',
                    requestParams: {
                        folder_id:   pushFolderId.trim(),
                        token_name:  tokenName,
                        token_value: previewUrl,
                        access_token: mktoToken,
                    },
                },
            }) as { data: Record<string, unknown>; status: number; statusText: string };
            createData = createOutput.data;
            if (!createOutput.data?.success) {
                setPushResult({ status: 'error', detail: `Step 2 failed — HTTP ${createOutput.status}\n${JSON.stringify(createOutput.data, null, 2)}` });
                return;
            }
        } catch (err) {
            setPushResult({ status: 'error', detail: `Step 2 error: ${String(err)}` });
            return;
        }

        // 3. Read back to confirm via executeSecureRequest
        setPushResult({ status: 'loading', detail: 'Step 3/3 — reading token back to verify…' });
        let allTokens: Array<{ name: string; value: string }> = [];
        try {
            const listOutput = await bridge.api({
                name: 'executeSecureRequest',
                payload: {
                    endpoint: 'marketo-list-tokens',
                    requestParams: { folder_id: pushFolderId.trim(), access_token: mktoToken },
                },
            }) as { data: { result?: Array<{ name: string; value: string }> }; status: number };
            allTokens = listOutput.data?.result ?? [];
        } catch { /* non-fatal */ }

        const match = allTokens.find((t) => t.name === tokenName);
        setPushResult({
            status: 'ok',
            detail: [
                `✓ Token created: {{my.${tokenName}}}`,
                `  CDN URL: ${match?.value ?? previewUrl}`,
                `  Folder ID: ${pushFolderId}`,
                '',
                'Full create response:',
                JSON.stringify(createData, null, 2),
            ].join('\n'),
        });
    };

    // ---------------------------------------------------------------------------
    // Render helpers
    // ---------------------------------------------------------------------------
    const statusBadge = (result: TestResult) => {
        if (result.status === 'idle') return null;
        if (result.status === 'loading') return <Badge emphasis="strong">Running…</Badge>;
        if (result.status === 'ok') return <Badge emphasis="strong">OK</Badge>;
        return <Badge emphasis="strong">Error</Badge>;
    };

    const contextEntries = Object.entries(ctx).map(([k, v]) => ({ key: k, value: safeStringify(v) }));

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (
        <div className="tw-font-body tw-min-h-screen tw-bg-base tw-p-6">
            <Heading size="large" weight="strong">Frontify → Marketo Diagnostic App</Heading>
            <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-4">
                Surface: <strong>{String(ctx.surface ?? 'unknown')}</strong>
            </p>

            <Flex gap="8px" className="tw-mb-6">
                {(['context', 'graphql', 'state', 'network', 'settings', 'push'] as Section[]).map((s) => (
                    <Button key={s} emphasis={activeSection === s ? 'strong' : 'default'} onPress={() => setActiveSection(s)}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Button>
                ))}
            </Flex>

            {/* ----------------------------------------------------------------
                CONTEXT TAB
            ---------------------------------------------------------------- */}
            {activeSection === 'context' && (
                <section>
                    <Heading size="medium" weight="strong">App Context</Heading>
                    <Flex gap="8px" className="tw-mb-4 tw-mt-2">
                        <Badge emphasis="strong">surface: {String(ctx.surface ?? '?')}</Badge>
                        <Badge emphasis={selectedIds.length > 0 ? 'strong' : 'default'}>
                            {selectedIds.length} asset{selectedIds.length !== 1 ? 's' : ''} selected
                        </Badge>
                    </Flex>

                    <table className="tw-w-full tw-text-body-small tw-mb-6">
                        <thead>
                            <tr className="tw-border-b tw-border-line">
                                <th className="tw-text-left tw-py-1 tw-pr-4 tw-text-text-weak">Field</th>
                                <th className="tw-text-left tw-py-1 tw-text-text">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {contextEntries.map(({ key, value }) => (
                                <tr key={key} className="tw-border-b tw-border-line-weak">
                                    <td className="tw-py-1 tw-pr-4 tw-text-text-weak tw-font-mono tw-align-top">{key}</td>
                                    <td className="tw-py-1 tw-text-text tw-font-mono tw-break-all tw-whitespace-pre-wrap">{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {currentUser !== null && (
                        <div className="tw-mb-4">
                            <p className="tw-font-medium tw-text-text tw-mb-1">getCurrentUser()</p>
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-48">
                                {JSON.stringify(currentUser, null, 2)}
                            </pre>
                        </div>
                    )}

                    {rawContext && (
                        <div>
                            <p className="tw-font-medium tw-text-text tw-mb-1">appBridge.context() — extra fields</p>
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-48">
                                {JSON.stringify(Object.fromEntries(Object.entries(rawContext).filter(([k]) => !(k in ctx))), null, 2)}
                            </pre>
                        </div>
                    )}
                </section>
            )}

            {/* ----------------------------------------------------------------
                GRAPHQL TAB
            ---------------------------------------------------------------- */}
            {activeSection === 'graphql' && (
                <section>
                    <Heading size="medium" weight="strong">Asset / GraphQL Tests</Heading>
                    <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-4">
                        Both calls go through App Bridge — no manual token required.
                        <code className="tw-ml-1">executeGraphQl</code> handles Frontify auth internally.
                    </p>

                    <div className="tw-mb-6">
                        <p className="tw-font-medium tw-text-text tw-mb-1">A — getAssetResourceInformation()</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-2">
                            Returns type, id, title, previewUrl, downloadUrl, filename. No token needed.
                        </p>
                        <Flex gap="8px" className="tw-mb-2">
                            <Button onPress={handleAssetInfo}>Run</Button>
                            {statusBadge(assetInfoResult)}
                        </Flex>
                        {assetInfoResult.detail && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-48">
                                {assetInfoResult.detail}
                            </pre>
                        )}
                    </div>

                    <div>
                        <p className="tw-font-medium tw-text-text tw-mb-1">B — executeGraphQl (title, workflowTask, status)</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-2">
                            Queries asset title, <code>workflowTask.status.name</code>, and previewUrl via App Bridge.
                            Auth handled internally — no stored token needed.
                        </p>
                        <Flex gap="8px" className="tw-mb-2">
                            <Button onPress={handleGraphQL}>Run</Button>
                            {statusBadge(graphqlResult)}
                        </Flex>
                        {graphqlResult.detail && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-64">
                                {graphqlResult.detail}
                            </pre>
                        )}
                    </div>
                </section>
            )}

            {/* ----------------------------------------------------------------
                STATE TAB
            ---------------------------------------------------------------- */}
            {activeSection === 'state' && (
                <section>
                    <Heading size="medium" weight="strong">User State Persistence (Q1)</Heading>
                    <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-4">
                        <strong>Confirmed:</strong> <code>appUserState</code> is browser localStorage —
                        not shared across users or devices. Write a value, open the app in a different browser,
                        click Read — you should get <em>undefined</em>.
                    </p>

                    <Flex direction="column" gap="12px">
                        <Flex gap="8px" alignItems="center">
                            <TextInput
                                id="state-input"
                                value={stateInput}
                                onChange={(e) => setStateInput(e.target.value)}
                                placeholder="Enter a test value…"
                            />
                            <Button onPress={handleWriteState}>Write state</Button>
                        </Flex>
                        <Flex gap="8px">
                            <Button onPress={handleReadState}>Read state</Button>
                        </Flex>
                        {readBackValue !== null && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small">
                                {readBackValue}
                            </pre>
                        )}
                    </Flex>
                </section>
            )}

            {/* ----------------------------------------------------------------
                NETWORK TAB — direct fetch + executeSecureRequest
            ---------------------------------------------------------------- */}
            {activeSection === 'network' && (
                <section>
                    <Heading size="medium" weight="strong">Network Tests</Heading>

                    <div className="tw-mb-8">
                        <p className="tw-font-medium tw-text-text tw-mb-1">A — Direct fetch() to httpbin</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-2">
                            Confirms the app iframe can reach external HTTPS. The Origin header in the response
                            is what Marketo must whitelist in Admin → Web Services → Allowed Hosts.
                        </p>
                        <Flex gap="8px" className="tw-mb-2">
                            <Button onPress={handleDirectFetch}>Run</Button>
                            {statusBadge(fetchResult)}
                        </Flex>
                        {fetchResult.detail && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-40">
                                {fetchResult.detail}
                            </pre>
                        )}
                    </div>

                    <div>
                        <p className="tw-font-medium tw-text-text tw-mb-1">B — executeSecureRequest → Marketo OAuth</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-2">
                            Calls <code>marketo-get-token</code> endpoint via Frontify proxy (server-side).
                            All credentials substituted from <code>%%SECRET%%</code> — identity URL, client ID,
                            and client secret are never sent to the browser.
                        </p>
                        <Flex gap="8px" className="tw-mb-2">
                            <Button onPress={handleSecureRequest}>Run</Button>
                            {statusBadge(secureResult)}
                        </Flex>
                        {secureResult.detail && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-48">
                                {secureResult.detail}
                            </pre>
                        )}
                    </div>
                </section>
            )}

            {/* ----------------------------------------------------------------
                PUSH TAB — e2e: Frontify asset → Marketo My Token
            ---------------------------------------------------------------- */}
            {activeSection === 'push' && (
                <section>
                    <Heading size="medium" weight="strong">Push Asset to Marketo</Heading>
                    <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-6">
                        Two steps: connect to Marketo (fetch + store a token), then push the selected asset as a My Token.
                    </p>

                    {/* Step 1 — Connect */}
                    <div className="tw-border tw-border-line tw-rounded tw-p-4 tw-mb-6">
                        <p className="tw-font-medium tw-text-text tw-mb-1">Step 1 — Connect to Marketo</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-3">
                            Fetches a token via Frontify&apos;s secure proxy (<code>executeSecureRequest</code>) — avoids browser CORS.
                            Instance URL + Client ID come from Settings. Client Secret comes from{' '}
                            <code>.secret.json</code> (dev) or Marketplace Access Keys (prod). Token is stored in memory for this session (valid 60 min).
                        </p>

                        {/* Connection status */}
                        <div className="tw-mb-3 tw-text-body-small">
                            {mktoTokenStatus === 'idle' && (
                                <span className="tw-text-text-weak">Not connected</span>
                            )}
                            {mktoTokenStatus === 'loading' && (
                                <Badge emphasis="strong">Fetching…</Badge>
                            )}
                            {mktoTokenStatus === 'ok' && mktoTokenFetchedAt && (() => {
                                const ageMin = Math.floor((Date.now() - mktoTokenFetchedAt) / 60000);
                                const remaining = 60 - ageMin;
                                return (
                                    <Flex gap="8px" alignItems="center">
                                        <Badge emphasis="strong">Connected</Badge>
                                        <span className="tw-text-text-weak">
                                            {remaining > 0
                                                ? `Token expires in ~${remaining} min`
                                                : 'Token may have expired — re-fetch'}
                                        </span>
                                    </Flex>
                                );
                            })()}
                            {mktoTokenStatus === 'error' && (
                                <span className="tw-text-danger tw-text-body-small">{mktoTokenError}</span>
                            )}
                        </div>

                        <div className="tw-mb-2 tw-text-body-small tw-text-text-weak">
                            All credentials from <strong>.secret.json</strong> (dev) / Marketplace Access Keys (prod)
                        </div>

                        <Flex gap="8px" className="tw-mb-4">
                            <Button onPress={handleFetchToken}>
                                {mktoTokenStatus === 'ok' ? 'Re-fetch Token' : 'Fetch Token'}
                            </Button>
                        </Flex>

                        {mktoTokenDebugLog.length > 0 && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-40 tw-mb-4">
                                {mktoTokenDebugLog.join('\n')}
                            </pre>
                        )}

                        <p className="tw-text-text-weak tw-text-body-small tw-mb-2">
                            — or paste a token directly (use your existing working token) —
                        </p>
                        <Flex gap="8px" alignItems="center">
                            <TextInput
                                id="manual-token"
                                value={manualToken}
                                onChange={(e) => setManualToken(e.target.value)}
                                placeholder="Paste access_token…"
                            />
                            <Button onPress={handleUseManualToken}>Use This Token</Button>
                        </Flex>
                    </div>

                    {/* Step 2 — Push */}
                    <div className={`tw-border tw-rounded tw-p-4 ${mktoTokenStatus === 'ok' ? 'tw-border-line' : 'tw-border-line-weak tw-opacity-60'}`}>
                        <p className="tw-font-medium tw-text-text tw-mb-1">Step 2 — Push Asset</p>
                        <p className="tw-text-text-weak tw-text-body-small tw-mb-3">
                            Gets the selected asset&apos;s CDN URL from Frontify and writes it as a{' '}
                            <code>My Token (type=URL)</code> in the target Programme.
                        </p>

                        <div className="tw-mb-3 tw-text-body-small tw-text-text-weak">
                            Selected asset:{' '}
                            <strong>
                                {extractAssetIds(ctx.selection)[0] ?? (ctx.assetId as string | undefined) ?? '(none — select an asset first)'}
                            </strong>
                        </div>

                        <Flex gap="8px" alignItems="center" className="tw-mb-4">
                            <span className="tw-text-body-small tw-text-text-weak tw-w-36 tw-flex-shrink-0">Programme / Folder ID</span>
                            <TextInput
                                id="push-folder"
                                value={pushFolderId}
                                onChange={(e) => setPushFolderId(e.target.value)}
                                placeholder="Numeric Marketo Programme ID (e.g. 1234)"
                            />
                        </Flex>

                        <Flex gap="8px" className="tw-mb-3">
                            <Button onPress={handlePush} emphasis="strong">
                                Push to Marketo
                            </Button>
                            {pushResult.status === 'loading' && <Badge emphasis="strong">Running…</Badge>}
                            {pushResult.status === 'ok'      && <Badge emphasis="strong">✓ Done</Badge>}
                            {pushResult.status === 'error'   && <Badge emphasis="strong">Error</Badge>}
                        </Flex>

                        {pushResult.detail && (
                            <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-72">
                                {pushResult.detail}
                            </pre>
                        )}
                    </div>
                </section>
            )}

            {/* ----------------------------------------------------------------
                SETTINGS TAB
            ---------------------------------------------------------------- */}
            {activeSection === 'settings' && (
                <section>
                    <Heading size="medium" weight="strong">App Settings</Heading>
                    <p className="tw-text-text-weak tw-text-body-small tw-mt-1 tw-mb-4">
                        Read via <code>appSettings()</code> hook. In dev: set via gear icon (bottom-right) → stored in
                        localStorage. After deploy: set by admin in Marketplace → Settings tab → shared across all users.
                    </p>

                    <div className="tw-mb-4">
                        <p className="tw-font-medium tw-text-text tw-mb-2">Live values from appSettings()</p>
                        <pre className="tw-bg-box tw-rounded tw-p-3 tw-text-body-small tw-overflow-auto tw-max-h-32">
                            {JSON.stringify(liveSettings ?? '(null — not yet populated)', null, 2)}
                        </pre>
                    </div>

                    <div className="tw-mb-6">
                        <p className="tw-font-medium tw-text-text tw-mb-2">Settings</p>
                        <Flex gap="8px" alignItems="center">
                            <span className="tw-text-body-small tw-text-text-weak tw-w-32 tw-flex-shrink-0">Folder Name</span>
                            <TextInput
                                id="marketo-folder-name"
                                value={liveSettings?.['marketo-folder-name'] ?? ''}
                                onChange={(e) => setLiveSettings({ 'marketo-folder-name': e.target.value })}
                                placeholder="Frontify Assets"
                            />
                        </Flex>
                    </div>

                    <div>
                        <p className="tw-font-medium tw-text-text tw-mb-1">Secrets (set in .secret.json for dev, Marketplace → Access Keys for prod)</p>
                        <table className="tw-w-full tw-text-body-small">
                            <thead>
                                <tr className="tw-border-b tw-border-line">
                                    <th className="tw-text-left tw-py-1 tw-pr-4 tw-text-text-weak">Key</th>
                                    <th className="tw-text-left tw-py-1 tw-text-text-weak">Label</th>
                                    <th className="tw-text-left tw-py-1 tw-text-text-weak">Used in</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { key: 'MARKETO_CLIENT_ID',    label: 'Marketo Client ID',    used: 'marketo-get-token' },
                                    { key: 'MARKETO_CLIENT_SECRET', label: 'Marketo Client Secret', used: 'marketo-get-token' },
                                    { key: 'MARKETO_IDENTITY_URL',  label: 'Marketo Identity URL',  used: 'marketo-get-token' },
                                    { key: 'MARKETO_INSTANCE_URL',  label: 'Marketo REST API URL',  used: 'marketo-create-token, marketo-list-tokens' },
                                ].map(({ key, label, used }) => (
                                    <tr key={key} className="tw-border-b tw-border-line-weak">
                                        <td className="tw-py-1 tw-pr-4 tw-font-mono tw-text-text-weak">{key}</td>
                                        <td className="tw-py-1 tw-pr-4 tw-text-text">{label}</td>
                                        <td className="tw-py-1 tw-text-text-weak">{used}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
};
