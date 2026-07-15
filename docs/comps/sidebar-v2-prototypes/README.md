# Sidebar v2 — prototypes

Interactive HTML prototypes for the recency-first hybrid sidebar.

Continues the look from <https://hsyscdqldmk5.postplan.dev/>.

## Current focus

```bash
cd docs/comps/sidebar-v2-prototypes
./serve.sh            # durable nohup server (survives agent restarts)
# → http://127.0.0.1:8765/c-attention-session.html
# ./serve.sh 8765 stop | restart
```

**`c-attention-session.html`** — working bet

- Attention tiers: Waiting / Working / Blocked / Idle (idle collapsed until click)
- Project picker (no chips)
- Multi-env under one repo name (Local · Sandbox · Remote)
- New session: `+` → project accordion → click env to start (no confirm)
- Single-env: inline **Start**; **+ New project** at bottom of same panel

## Archive

| File | What |
|---|---|
| `project-identity.html` | A (picker) · first C · B (Projects+Agents) · 0 (baseline) |
| `source-postplan.html` | Cached original five-concept demo |
| `shot-*.png` | Browser captures from iteration |
