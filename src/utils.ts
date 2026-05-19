export function safeStringify(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function extractAssetIds(selection: unknown): string[] {
    if (!selection) return [];
    const sel = selection as Record<string, unknown>;
    if (sel.assets && typeof sel.assets === 'object') {
        const assets = sel.assets as { ids?: string[] };
        if (Array.isArray(assets.ids)) return assets.ids;
    }
    if (Array.isArray(sel.ids)) return sel.ids as string[];
    if (typeof sel.id === 'string') return [sel.id];
    if (Array.isArray(selection)) {
        return (selection as unknown[])
            .map((item) => typeof item === 'string' ? item : (item as Record<string, string>).id ?? '')
            .filter(Boolean);
    }
    return [];
}
