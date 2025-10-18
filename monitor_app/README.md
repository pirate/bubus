# bubus Monitor App

Minimal FastAPI application that reads the `events_log` and `event_results_log` tables produced by the `SQLiteHistoryMirrorMiddleware` and exposes them over HTTP/WebSocket for live monitoring.

Install dependencies (once):

```bash
pip install fastapi uvicorn
```

## Quick start

```bash
cd monitor_app
uvicorn monitor_app.main:app --reload
```

The app assumes the history database lives at `../events.sqlite`. Override via:

```bash
EVENT_HISTORY_DB=/path/to/history.sqlite uvicorn monitor_app.main:app --reload
```

Then visit [http://localhost:8000](http://localhost:8000) for a simple dashboard that shows recent events and handler results updating in near real-time through a WebSocket stream.

## Endpoints

- `GET /events?limit=20` – latest events (JSON)
- `GET /results?limit=20` – latest handler results (JSON)
- `GET /meta` – database path + existence flag
- `GET /` – minimal HTML dashboard
- `WS /ws/events` – pushes new rows as they arrive (`{"events": [...], "results": [...]}`)

This app is intentionally small so you can extend it with additional metrics, authentication, or richer UI as needed.
