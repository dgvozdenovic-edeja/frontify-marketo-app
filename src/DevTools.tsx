import { AppBridgePlatformApp, appContext, appSettings, appUserState } from '@frontify/app-bridge-app';
import { Badge, Button, Flex, TextInput } from '@frontify/fondue/components';
import { useEffect, useState } from 'react';
import { extractAssetIds, safeStringify } from './utils';

type DevTab = 'context' | 'graphql' | 'state' | 'network' | 'settings';
type AppSettingsType = { 'marketo-folder-name': string };
type TestResult = { status: 'idle' | 'loading' | 'ok' | 'error'; detail: string };

const GRAPHQL_QUERY = `
query GetAsset($id: ID!) {
  asset(id: $id) {
    id title __typename status
    workflowTask { title status { name } }
    ... on Image { previewUrl width height }
  }
}`;

export const DevTools = () => {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<DevTab>('context');

    const context = appContext();
    const appBridge = new AppBridgePlatformApp();
    const bridge = appBridge as unknown as { api: (a: unknown) => Promise<unknown> };
    const ctx = context as Record<string, unknown>;

    const [liveSettings, setLiveSettings] = appSettings<AppSettingsType>();
    const [userState, setUserState] = appUserState<{ probe_value: string; probe_written_at: string }>();

    const [currentUser, setCurrentUser] = useState<Record<string, unknown> | null>(null);
    const [stateInput, setStateInput] = useState('');
    const [readBackValue, setReadBackValue] = useState<string | null>(null);

    const [assetInfoResult, setAssetInfoResult] = useState<TestResult>({ status: 'idle', detail: '' });
    const [graphqlResult, setGraphqlResult]     = useState<TestResult>({ status: 'idle', detail: '' });
    const [fetchResult, setFetchResult]         = useState<TestResult>({ status: 'idle', detail: '' });
    const [secureResult, setSecureResult]       = useState<TestResult>({ status: 'idle', detail: '' });

    useEffect(() => {
        bridge.api({ name: 'getCurrentUser' })
            .then(user => setCurrentUser(user as Record<string, unknown>))
            .catch(() => setCurrentUser({}));
    }, []);

    const statusBadge = (r: TestResult) => {
        if (r.status === 'idle')    return null;
        if (r.status === 'loading') return <Badge emphasis="strong">Running…</Badge>;
        if (r.status === 'ok')      return <Badge emphasis="strong">OK</Badge>;
        return <Badge emphasis="strong">Error</Badge>;
    };

    // ── Handlers ────────────────────────────────────────────────────────────────

    const handleAssetInfo = async () => {
        const assetId = extractAssetIds(ctx.selection)[0];
        if (!assetId) { setAssetInfoResult({ status: 'error', detail: 'No asset selected.' }); return; }
        setAssetInfoResult({ status: 'loading', detail: '' });
        try {
            const result = await bridge.api({ name: 'getAssetResourceInformation', payload: { assetId } });
            setAssetInfoResult({ status: 'ok', detail: JSON.stringify(result, null, 2) });
        } catch (err) {
            setAssetInfoResult({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
    };

    const handleGraphQL = async () => {
        const assetId = (ctx.assetId as string | undefined) ?? extractAssetIds(ctx.selection)[0];
        if (!assetId) { setGraphqlResult({ status: 'error', detail: 'No assetId — trigger app from an asset.' }); return; }
        setGraphqlResult({ status: 'loading', detail: '' });
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

    const handleDirectFetch = async () => {
        setFetchResult({ status: 'loading', detail: '' });
        try {
            const res = await fetch('https://httpbin.org/get', { headers: { Accept: 'application/json' } });
            const data = await res.json() as { headers?: { Origin?: string }; origin?: string };
            setFetchResult({
                status: 'ok',
                detail: `HTTP ${res.status}\nOrigin seen by server: "${data.headers?.Origin ?? '(none)'}"\nRequest IP: ${data.origin ?? '?'}`,
            });
        } catch (err) {
            setFetchResult({ status: 'error', detail: String(err) });
        }
    };

    const handleSecureRequest = async () => {
        setSecureResult({ status: 'loading', detail: '' });
        try {
            const res = await bridge.api({
                name: 'executeSecureRequest',
                payload: { endpoint: 'marketo-get-token' },
            }) as Response;
            const result = await res.json();
            setSecureResult({ status: 'ok', detail: JSON.stringify(result, null, 2) });
        } catch (err) {
            setSecureResult({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
        }
    };

    // ── Collapsed toggle ─────────────────────────────────────────────────────────

    if (!open) {
        return (
            <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}>
                <button
                    onClick={() => setOpen(true)}
                    style={{
                        background: '#f59e0b', color: '#000', border: 'none',
                        borderRadius: 6, padding: '5px 12px', fontSize: 12,
                        fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    }}
                >
                    DEV ▲
                </button>
            </div>
        );
    }

    // ── Expanded panel ───────────────────────────────────────────────────────────

    const selectedIds = extractAssetIds(ctx.selection);
    const contextEntries = Object.entries(ctx).map(([k, v]) => ({ key: k, value: safeStringify(v) }));
    const tabs: DevTab[] = ['context', 'graphql', 'state', 'network', 'settings'];

    return (
        <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
            maxHeight: '72vh', display: 'flex', flexDirection: 'column',
            background: 'var(--f-color-base, #fff)',
            borderTop: '2px solid #f59e0b',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                borderBottom: '1px solid var(--f-color-line, #e5e7eb)',
                background: '#fefce8', flexShrink: 0,
            }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#b45309' }}>DEV</span>
                <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {tabs.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            style={{
                                padding: '3px 10px', fontSize: 12, border: 'none', borderRadius: 4,
                                cursor: 'pointer', fontFamily: 'inherit',
                                background: activeTab === tab ? '#f59e0b' : 'transparent',
                                color: activeTab === tab ? '#000' : '#6b7280',
                                fontWeight: activeTab === tab ? 700 : 400,
                            }}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => setOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280', padding: '0 4px' }}
                >
                    ▼
                </button>
            </div>

            {/* Tab content */}
            <div style={{ overflow: 'auto', padding: '12px 16px', flex: 1 }} className="tw-font-body tw-text-body-small">

                {/* ── Context ── */}
                {activeTab === 'context' && (
                    <div>
                        <Flex gap="8px" className="tw-mb-3">
                            <Badge emphasis="strong">surface: {String(ctx.surface ?? '?')}</Badge>
                            <Badge emphasis={selectedIds.length > 0 ? 'strong' : 'default'}>
                                {selectedIds.length} asset{selectedIds.length !== 1 ? 's' : ''} selected
                            </Badge>
                        </Flex>

                        <table className="tw-w-full tw-mb-4">
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
                            <div>
                                <p className="tw-font-medium tw-text-text tw-mb-1">getCurrentUser()</p>
                                <pre className="tw-bg-box tw-rounded tw-p-3 tw-overflow-auto tw-max-h-40">
                                    {JSON.stringify(currentUser, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                )}

                {/* ── GraphQL ── */}
                {activeTab === 'graphql' && (
                    <div>
                        <div className="tw-mb-5">
                            <p className="tw-font-medium tw-text-text tw-mb-2">getAssetResourceInformation()</p>
                            <Flex gap="8px" className="tw-mb-2">
                                <Button onPress={handleAssetInfo}>Run</Button>
                                {statusBadge(assetInfoResult)}
                            </Flex>
                            {assetInfoResult.detail && (
                                <pre className="tw-bg-box tw-rounded tw-p-3 tw-overflow-auto tw-max-h-40">
                                    {assetInfoResult.detail}
                                </pre>
                            )}
                        </div>

                        <div>
                            <p className="tw-font-medium tw-text-text tw-mb-2">executeGraphQl (title, workflowTask, previewUrl)</p>
                            <Flex gap="8px" className="tw-mb-2">
                                <Button onPress={handleGraphQL}>Run</Button>
                                {statusBadge(graphqlResult)}
                            </Flex>
                            {graphqlResult.detail && (
                                <pre className="tw-bg-box tw-rounded tw-p-3 tw-overflow-auto tw-max-h-40">
                                    {graphqlResult.detail}
                                </pre>
                            )}
                        </div>
                    </div>
                )}

                {/* ── State ── */}
                {activeTab === 'state' && (
                    <div>
                        <p className="tw-text-text-weak tw-mb-3">
                            <code>appUserState</code> — browser localStorage, not shared across users/devices.
                        </p>
                        <Flex direction="column" gap="12px">
                            <Flex gap="8px" alignItems="center">
                                <TextInput
                                    id="dev-state-input"
                                    value={stateInput}
                                    onChange={(e) => setStateInput(e.target.value)}
                                    placeholder="Enter a test value…"
                                />
                                <Button onPress={() => { setUserState({ probe_value: stateInput, probe_written_at: new Date().toISOString() }); setReadBackValue(null); }}>
                                    Write
                                </Button>
                            </Flex>
                            <Flex gap="8px">
                                <Button onPress={() => setReadBackValue(userState ? `"${userState.probe_value}" @ ${userState.probe_written_at}` : '(empty)')}>
                                    Read
                                </Button>
                            </Flex>
                            {readBackValue !== null && (
                                <pre className="tw-bg-box tw-rounded tw-p-3">{readBackValue}</pre>
                            )}
                        </Flex>
                    </div>
                )}

                {/* ── Network ── */}
                {activeTab === 'network' && (
                    <div>
                        <div className="tw-mb-5">
                            <p className="tw-font-medium tw-text-text tw-mb-1">A — Direct fetch() → httpbin</p>
                            <p className="tw-text-text-weak tw-mb-2">Confirms iframe can reach external HTTPS and shows Origin header.</p>
                            <Flex gap="8px" className="tw-mb-2">
                                <Button onPress={handleDirectFetch}>Run</Button>
                                {statusBadge(fetchResult)}
                            </Flex>
                            {fetchResult.detail && (
                                <pre className="tw-bg-box tw-rounded tw-p-3 tw-overflow-auto tw-max-h-32">{fetchResult.detail}</pre>
                            )}
                        </div>

                        <div>
                            <p className="tw-font-medium tw-text-text tw-mb-1">B — executeSecureRequest → Marketo OAuth</p>
                            <p className="tw-text-text-weak tw-mb-2">
                                Calls <code>marketo-get-token</code> via Frontify proxy. Only works on deployed app — expected to fail locally.
                            </p>
                            <Flex gap="8px" className="tw-mb-2">
                                <Button onPress={handleSecureRequest}>Run</Button>
                                {statusBadge(secureResult)}
                            </Flex>
                            {secureResult.detail && (
                                <pre className="tw-bg-box tw-rounded tw-p-3 tw-overflow-auto tw-max-h-40">{secureResult.detail}</pre>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Settings ── */}
                {activeTab === 'settings' && (
                    <div>
                        <div className="tw-mb-5">
                            <p className="tw-font-medium tw-text-text tw-mb-2">Settings (appSettings hook)</p>
                            <Flex gap="8px" alignItems="center">
                                <span className="tw-text-text-weak tw-w-28 tw-flex-shrink-0">Folder Name</span>
                                <TextInput
                                    id="dev-folder-name"
                                    value={liveSettings?.['marketo-folder-name'] ?? ''}
                                    onChange={(e) => setLiveSettings({ 'marketo-folder-name': e.target.value })}
                                    placeholder="Frontify Assets"
                                />
                            </Flex>
                        </div>

                        <div>
                            <p className="tw-font-medium tw-text-text tw-mb-2">Secrets (.secret.json / Marketplace Access Keys)</p>
                            <table className="tw-w-full">
                                <thead>
                                    <tr className="tw-border-b tw-border-line">
                                        <th className="tw-text-left tw-py-1 tw-pr-4 tw-text-text-weak">Key</th>
                                        <th className="tw-text-left tw-py-1 tw-text-text-weak">Used in</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { key: 'MARKETO_CLIENT_ID',     used: 'marketo-get-token' },
                                        { key: 'MARKETO_CLIENT_SECRET', used: 'marketo-get-token' },
                                        { key: 'MARKETO_IDENTITY_URL',  used: 'marketo-get-token' },
                                        { key: 'MARKETO_INSTANCE_URL',  used: 'marketo-create-token, marketo-list-tokens' },
                                    ].map(({ key, used }) => (
                                        <tr key={key} className="tw-border-b tw-border-line-weak">
                                            <td className="tw-py-1 tw-pr-4 tw-font-mono tw-text-text-weak">{key}</td>
                                            <td className="tw-py-1 tw-text-text-weak">{used}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
