from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Annotated, Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from . import db
from .config import resolve_db_path

app = FastAPI(title='bubus event monitor', version='0.1.0')


def _format_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    # SQLite timestamp string -> ISO 8601
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).isoformat()
    except ValueError:
        return value


async def _fetch_events(limit: int) -> list[dict[str, Any]]:
    rows = await db.fetch_events(limit)
    for row in rows:
        row['inserted_at'] = _format_timestamp(row.get('inserted_at'))
    return rows


async def _fetch_results(limit: int) -> list[dict[str, Any]]:
    rows = await db.fetch_results(limit)
    for row in rows:
        row['inserted_at'] = _format_timestamp(row.get('inserted_at'))
    return rows


@app.get('/', response_class=HTMLResponse)
async def index() -> str:
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>bubus Event Monitor</title>
        <style>
            :root {
                color-scheme: dark;
                font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 15px;
                line-height: 1.45;
            }
            body { margin: 0; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; }
            header { padding: 1.35rem 1.8rem 1rem; border-bottom: 1px solid rgba(148, 163, 184, 0.22); }
            h1 { margin: 0 0 0.55rem; font-size: 1.7rem; font-weight: 600; }
            .meta { font-size: 0.92rem; display: flex; gap: 0.85rem; flex-wrap: wrap; align-items: center; opacity: 0.92; }
            .status-indicator { padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.82rem; background: rgba(148, 163, 184, 0.24); }
            main { flex: 1; overflow-y: auto; padding: 1.1rem 1.8rem 1.5rem; }
            .toolbar { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-bottom: 0.75rem; align-items: center; font-size: 0.86rem; }
            .toolbar input,
            .toolbar select { background: rgba(15,23,42,0.72); border: 1px solid rgba(148,163,184,0.35); color: inherit; border-radius: 0.5rem; padding: 0.4rem 0.65rem; font-size: 0.86rem; min-width: 9.5rem; }
            .toolbar label { display: flex; align-items: center; gap: 0.35rem; }
            #events-tree { display: grid; gap: 0.45rem; }
            .tree-node { position: relative; background: rgba(15,23,42,0.34); border: 1px solid rgba(148,163,184,0.26); border-radius: 0.6rem; padding: 0.45rem 0.75rem 0.55rem 1.2rem; }
            .tree-node::before { content: ''; position: absolute; left: 0.55rem; top: 0.6rem; bottom: 0.6rem; border-left: 2px solid rgba(94,234,212,0.25); }
            .tree-node details { padding-top: 0; }
            .tree-node details > summary { list-style: none; cursor: pointer; padding: 0; outline: none; }
            .tree-node details > summary::-webkit-details-marker { display: none; }
            .event-summary { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; font-size: 0.9rem; }
            .pill { display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px; padding: 0.2rem 0.6rem; border: 1px solid rgba(148,163,184,0.32); background: rgba(15,23,42,0.68); font-size: 0.85rem; }
            .pill-type { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; background: rgba(94,234,212,0.12); border-color: rgba(94,234,212,0.42); }
            .pill-muted { color: rgba(226,232,240,0.88); }
            .pill-status { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
            .pill-status.pill-completed { background: rgba(16,185,129,0.2); border-color: rgba(16,185,129,0.5); color: #34d399; }
            .pill-status.pill-started { background: rgba(250,204,21,0.2); border-color: rgba(250,204,21,0.45); color: #facc15; }
            .pill-status.pill-pending { background: rgba(59,130,246,0.24); border-color: rgba(59,130,246,0.45); color: #60a5fa; }
            .pill-status.pill-error { background: rgba(239,68,68,0.24); border-color: rgba(239,68,68,0.5); color: #f87171; }
            .event-meta { margin-top: 0.5rem; padding: 0.45rem 0.55rem 0.3rem; background: rgba(15,23,42,0.46); border-radius: 0.55rem; border: 1px solid rgba(148,163,184,0.2); }
            .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.35rem 0.55rem; }
            .meta-item { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 0.35rem; font-size: 0.84rem; padding: 0.18rem 0.45rem; background: rgba(15,23,42,0.6); border-radius: 0.45rem; }
            .meta-icon { opacity: 0.85; font-size: 0.88rem; }
            .meta-label { color: rgba(203,213,225,0.78); font-weight: 500; }
            .meta-value { color: rgba(226,232,240,0.95); font-weight: 600; overflow-wrap: anywhere; }
            .meta-value code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; padding: 0.05rem 0.35rem; background: rgba(15,23,42,0.72); border-radius: 0.35rem; border: 1px solid rgba(148,163,184,0.26); }
            .results-section { margin-top: 0.5rem; }
            .results-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
            .results-table th { text-align: left; padding: 0.3rem 0.45rem; color: rgba(148,163,184,0.9); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.74rem; }
            .results-table td { padding: 0.32rem 0.45rem; color: rgba(226,232,240,0.93); vertical-align: top; border-top: 1px solid rgba(148,163,184,0.16); }
            .results-table td pre { margin: 0; font-size: 0.78rem; white-space: pre-wrap; background: none; }
            .results-table details { font-size: 0.74rem; }
            .results-table details summary { cursor: pointer; color: rgba(125,211,252,0.92); }
            .children { list-style: none; margin: 0.4rem 0 0.2rem 0.9rem; padding: 0; display: grid; gap: 0.3rem; }
            .event-json { margin-top: 0.45rem; padding: 0.4rem 0.45rem; font-size: 0.78rem; }
            .event-json summary { cursor: pointer; color: rgba(125,211,252,0.92); }
            .event-json pre { margin-top: 0.35rem; max-height: 220px; overflow: auto; padding: 0.5rem; background: rgba(15,23,42,0.78); border-radius: 0.45rem; border: 1px solid rgba(148,163,184,0.24); }
            .empty { text-align: center; padding: 2rem 0; color: rgba(148,163,184,0.7); font-size: 0.88rem; }
            @media (max-width: 900px) {
                header, main { padding: 1rem 1.2rem; }
                .toolbar input, .toolbar select { min-width: 0; flex: 1 1 140px; }
            }
        </style>
    </head>
    <body>
        <header>
            <h1>bubus Event Monitor</h1>
            <div class="meta">
                <span>Database: <code id="db-path"></code></span>
                <span class="status-indicator" id="ws-status">connecting…</span>
                <span id="counts"></span>
            </div>
        </header>
        <main>
            <div id="db-warning" class="empty" style="display:none;">No SQLite history file found yet. Dispatch events to see activity here.</div>
            <div class="toolbar">
                <label>
                    🔍
                    <input id="search-input" type="search" placeholder="Search events and results…" />
                </label>
                <label>
                    Status
                    <select id="filter-status">
                        <option value="all">All statuses</option>
                        <option value="completed">Completed</option>
                        <option value="started">Started</option>
                        <option value="pending">Pending</option>
                        <option value="error">Error</option>
                    </select>
                </label>
                <label>
                    EventBus
                    <select id="filter-bus">
                        <option value="all">All buses</option>
                    </select>
                </label>
            </div>
            <div id="events-tree"></div>
        </main>
        <script>
            const state = {
                events: new Map(),
                results: new Map(),
                busNames: new Set(),
                filters: { search: '', status: 'all', bus: 'all' },
            };

            const dbPathEl = document.getElementById('db-path');
            const wsStatus = document.getElementById('ws-status');
            const countsEl = document.getElementById('counts');
            const warningEl = document.getElementById('db-warning');
            const treeContainer = document.getElementById('events-tree');
            const searchInput = document.getElementById('search-input');
            const statusSelect = document.getElementById('filter-status');
            const busSelect = document.getElementById('filter-bus');

            const SAFE_DEFAULT = Object.freeze({});

            function escapeHtml(value) {
                if (value === null || value === undefined) return '';
                return value.toString().replace(/[&<>"']/g, (char) => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;',
                })[char]);
            }

            function safeJsonParse(raw) {
                if (!raw || typeof raw !== 'string') return SAFE_DEFAULT;
                try { return JSON.parse(raw); } catch { return SAFE_DEFAULT; }
            }

            function renderMetaItem(icon, label, value, options = {}) {
                const { code = false } = options;
                const safeValue = value !== undefined && value !== null && value !== '' ? String(value) : '—';
                const formatted = code ? `<code>${escapeHtml(safeValue)}</code>` : escapeHtml(safeValue);
                return `<div class="meta-item"><span class="meta-icon">${icon}</span><span class="meta-label">${escapeHtml(label)}</span><span class="meta-value">${formatted}</span></div>`;
            }

            function ingestEvents(rows) {
                rows.forEach((row) => {
                    const current = state.events.get(row.event_id);
                    const currentRowId = current && typeof current._row_id === 'number' ? current._row_id : -Infinity;
                    if (row.id <= currentRowId) {
                        return;
                    }

                    const data = safeJsonParse(row.event_json);
                    const record = { ...row, data, _row_id: row.id };
                    state.events.set(row.event_id, record);
                    if (record.eventbus_name) state.busNames.add(record.eventbus_name);
                });
            }

            function ingestResults(rows) {
                rows.forEach((row) => {
                    const list = state.results.get(row.event_id) || [];
                    const idx = list.findIndex((item) => item.id === row.id);
                    if (idx >= 0) {
                        list[idx] = { ...list[idx], ...row };
                    } else {
                        list.push({ ...row });
                    }
                    list.sort((a, b) => (b.id || 0) - (a.id || 0));
                    state.results.set(row.event_id, list);
                });
            }

            function updateBusOptions() {
                const previous = busSelect.value;
                const options = ['all', ...Array.from(state.busNames).sort()];
                busSelect.innerHTML = options.map((name) => {
                    const label = name === 'all' ? 'All buses' : name;
                    return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
                }).join('');
                if (options.includes(previous)) {
                    busSelect.value = previous;
                } else {
                    state.filters.bus = 'all';
                }
            }

            function buildTree() {
                const nodes = new Map();
                state.events.forEach((event) => {
                    const results = aggregateResults(state.results.get(event.event_id) || []);
                    nodes.set(event.event_id, { ...event, children: [], results });
                });
                const roots = [];
                nodes.forEach((node) => {
                    const parentId = node.data?.event_parent_id;
                    if (parentId && nodes.has(parentId)) {
                        nodes.get(parentId).children.push(node);
                    } else {
                        roots.push(node);
                    }
                });
                function sortNodes(list) {
                    list.sort((a, b) => {
                        const timeA = Date.parse(a.inserted_at || '') || 0;
                        const timeB = Date.parse(b.inserted_at || '') || 0;
                        return timeB - timeA;
                    });
                    list.forEach((child) => sortNodes(child.children));
                }
                sortNodes(roots);
                return roots;
            }

            function matchesFilters(node) {
                const statusMatch = state.filters.status === 'all' || (node.event_status || '').toLowerCase() === state.filters.status;
                const busMatch = state.filters.bus === 'all' || node.eventbus_name === state.filters.bus;
                if (!statusMatch || !busMatch) return false;
                if (!state.filters.search) return true;
                const haystack = [
                    node.event_type,
                    node.event_id,
                    node.eventbus_name,
                    node.phase,
                    JSON.stringify(node.data || SAFE_DEFAULT),
                ].join(' ').toLowerCase();
                return haystack.includes(state.filters.search);
            }

            function filterResults(results) {
                if (!state.filters.search) return results;
                return results.filter((result) =>
                    JSON.stringify(result || SAFE_DEFAULT).toLowerCase().includes(state.filters.search)
                );
            }

            function filterTree(nodes) {
                const filtered = [];
                for (const node of nodes) {
                    const children = filterTree(node.children);
                    const results = filterResults(node.results);
                    const matches = matchesFilters(node);
                    if (matches || children.length || results.length) {
                        filtered.push({ ...node, children, results });
                    }
                }
                return filtered;
            }

            function aggregateResults(rawResults) {
                const groups = new Map();
                rawResults.forEach((row) => {
                    const key = row.event_result_id || `${row.handler_name}-${row.event_id}`;
                    const group = groups.get(key) || {
                        handler_name: row.handler_name,
                        event_result_id: row.event_result_id,
                        attempts: [],
                        final_status: row.status || row.phase,
                        error_repr: row.error_repr,
                        result_repr: row.result_repr,
                        started_at: null,
                        completed_at: null,
                    };

                    if (row.status === 'started' || row.phase === 'started') {
                        group.started_at = row.inserted_at;
                    }
                    if (row.status === 'completed' || row.status === 'error') {
                        group.completed_at = row.inserted_at;
                        group.final_status = row.status;
                        group.error_repr = row.error_repr;
                        group.result_repr = row.result_repr;
                    }
                    group.attempts.push({
                        status: row.status || row.phase,
                        inserted_at: row.inserted_at,
                        result_repr: row.result_repr,
                        error_repr: row.error_repr,
                    });
                    groups.set(key, group);
                });

                return Array.from(groups.values()).sort((a, b) => {
                    const timeA = Date.parse(a.completed_at || a.started_at || '') || 0;
                    const timeB = Date.parse(b.completed_at || b.started_at || '') || 0;
                    return timeB - timeA;
                });
            }

            function renderResults(results) {
                return `
                <div class="results-section">
                    <h3>Handler Results</h3>
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>Handler</th>
                                <th>Status</th>
                                <th>Started</th>
                                <th>Completed</th>
                                <th>Result</th>
                                <th>Error</th>
                                <th>Log entries</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${results.map((result) => `
                                <tr>
                                    <td>${escapeHtml(result.handler_name || '—')}</td>
                                    <td>${escapeHtml(result.final_status || '—')}</td>
                                    <td>${escapeHtml(result.started_at || '—')}</td>
                                    <td>${escapeHtml(result.completed_at || '—')}</td>
                                    <td><pre>${escapeHtml(result.result_repr || '')}</pre></td>
                                    <td><pre>${escapeHtml(result.error_repr || '')}</pre></td>
                                    <td>
                                        <details>
                                            <summary>${result.attempts.length} log entry(ies)</summary>
                                            <ul>
                                                ${result.attempts.map((attempt) => `
                                                    <li>
                                                        <strong>${escapeHtml(attempt.status || '—')}</strong>
                                                        @ ${escapeHtml(attempt.inserted_at || '—')}
                                                        ${attempt.result_repr ? `<pre>${escapeHtml(attempt.result_repr)}</pre>` : ''}
                                                        ${attempt.error_repr ? `<pre>${escapeHtml(attempt.error_repr)}</pre>` : ''}
                                                    </li>
                                                `).join('')}
                                            </ul>
                                        </details>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
            }

            function renderNode(node) {
                const data = node.data || SAFE_DEFAULT;
                const shortId = (node.event_id || '').slice(-8) || '—';
                const rawStatus = (node.event_status || node.phase || 'unknown');
                const normalizedStatus = rawStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const timeoutDisplay = data.event_timeout != null ? `${data.event_timeout}s` : '—';
                const insertedAt = node.inserted_at || '—';
                const path = Array.isArray(data.event_path) ? data.event_path.join(' → ') : '';
                const parentId = data.event_parent_id || '—';
                const schema = data.event_schema || '—';
                const resultType = data.event_result_type || '—';
                const createdAt = data.event_created_at || '—';
                const processedAt = data.event_processed_at || '—';

                const summaryBadges = [
                    `<span class="pill pill-type">${escapeHtml(node.event_type || 'UnknownEvent')}</span>`,
                    `<span class="pill pill-status pill-${escapeHtml(normalizedStatus)}">${escapeHtml(rawStatus)}</span>`,
                    `<span class="pill pill-muted">🚌 ${escapeHtml(node.eventbus_name || '—')}</span>`,
                    `<span class="pill pill-muted">ID ${escapeHtml(shortId)}</span>`,
                    `<span class="pill pill-muted">⏱ ${escapeHtml(timeoutDisplay)}</span>`,
                    `<span class="pill pill-muted">🕒 ${escapeHtml(insertedAt)}</span>`,
                ].join('');

                const metaItems = [
                    renderMetaItem('🆔', 'Event ID', node.event_id || '—', { code: true }),
                    renderMetaItem('👪', 'Parent ID', parentId, { code: true }),
                    renderMetaItem('🧭', 'Path', path || '—'),
                    renderMetaItem('📦', 'Schema', schema, { code: true }),
                    renderMetaItem('🎯', 'Result type', resultType, { code: true }),
                    renderMetaItem('⏱', 'Timeout', timeoutDisplay),
                    renderMetaItem('🕒', 'Created', createdAt),
                    renderMetaItem('✅', 'Processed', processedAt),
                ].join('');

                const resultsSection = node.results.length ? renderResults(node.results) : '';
                const childrenSection = node.children.length ? `<ul class="children">${node.children.map(renderNode).join('')}</ul>` : '';
                const eventJson = data && Object.keys(data).length
                    ? `<details class="event-json"><summary>View full payload</summary><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>`
                    : '';

                return `
                <li class="tree-node">
                    <details open>
                        <summary>
                            <div class="event-summary">${summaryBadges}</div>
                        </summary>
                        <div class="event-meta"><div class="meta-grid">${metaItems}</div></div>
                        ${resultsSection}
                        ${eventJson}
                        ${childrenSection}
                    </details>
                </li>`;
            }


            function render() {
                updateBusOptions();
                const tree = filterTree(buildTree());
                const totalResults = Array.from(state.results.values()).reduce((acc, list) => acc + list.length, 0);
                countsEl.textContent = `Events: ${state.events.size} · Results: ${totalResults}`;
                if (!tree.length) {
                    treeContainer.innerHTML = '<div class="empty">No matching events yet.</div>';
                    return;
                }
                treeContainer.innerHTML = `<ul class="tree-root">${tree.map(renderNode).join('')}</ul>`;
            }

            function setupFilters() {
                searchInput.addEventListener('input', (event) => {
                    state.filters.search = event.target.value.trim().toLowerCase();
                    render();
                });
                statusSelect.addEventListener('change', (event) => {
                    state.filters.status = event.target.value;
                    render();
                });
                busSelect.addEventListener('change', (event) => {
                    state.filters.bus = event.target.value;
                    render();
                });
            }

            async function loadInitial() {
                const [events, results, meta] = await Promise.all([
                    fetch('/events?limit=120').then((r) => r.json()),
                    fetch('/results?limit=200').then((r) => r.json()),
                    fetch('/meta').then((r) => r.json()),
                ]);
                dbPathEl.textContent = meta.db_path;
                warningEl.style.display = meta.db_exists ? 'none' : 'block';
                ingestEvents(events);
                ingestResults(results);
                render();
            }

            function connectWebSocket() {
                const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
                const ws = new WebSocket(`${protocol}://${location.host}/ws/events`);
                wsStatus.textContent = 'connected';

                ws.onmessage = (event) => {
                    const payload = JSON.parse(event.data);
                    if (payload.events && payload.events.length) {
                        ingestEvents(payload.events);
                    }
                    if (payload.results && payload.results.length) {
                        ingestResults(payload.results);
                    }
                    render();
                };
                ws.onclose = () => {
                    wsStatus.textContent = 'disconnected – retrying…';
                    setTimeout(connectWebSocket, 2000);
                };
                ws.onerror = () => {
                    ws.close();
                };
            }

            setupFilters();
            loadInitial().then(connectWebSocket);
        </script>
    </body>
    </html>
    """


@app.get('/events')
async def list_events(limit: Annotated[int, Query(ge=1, le=200)] = 20) -> JSONResponse:
    rows = await _fetch_events(limit)
    return JSONResponse(rows)


@app.get('/results')
async def list_results(limit: Annotated[int, Query(ge=1, le=200)] = 20) -> JSONResponse:
    rows = await _fetch_results(limit)
    return JSONResponse(rows)


@app.get('/meta')
async def meta() -> dict[str, Any]:
    db_path = resolve_db_path()
    exists = db_path.exists()
    return {
        'db_path': str(db_path),
        'db_exists': exists,
    }


@app.websocket('/ws/events')
async def websocket_events(socket: WebSocket) -> None:
    await socket.accept()
    state = db.HistoryStreamState()
    try:
        # Prime with latest IDs so we only broadcast new rows
        latest_events = await _fetch_events(1)
        latest_results = await _fetch_results(1)
        if latest_events:
            state.last_event_id = latest_events[0]['id']
        if latest_results:
            state.last_result_id = latest_results[0]['id']

        while True:
            updates = await db.stream_new_rows(state)
            if updates['events'] or updates['results']:
                for key in ('events', 'results'):
                    for row in updates[key]:
                        row['inserted_at'] = _format_timestamp(row.get('inserted_at'))
                await socket.send_text(json.dumps(updates))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover - surface to client
        await socket.send_text(json.dumps({'error': str(exc)}))
        await asyncio.sleep(0.5)
