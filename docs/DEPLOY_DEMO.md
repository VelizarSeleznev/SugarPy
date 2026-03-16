# Demo Deployment (Multi-user, Single Host)

This document describes a demo setup for multiple concurrent users on one server.

## Overview
- Frontend (`web/dist`) is served by Nginx.
- Jupyter Server runs locally on `127.0.0.1:8888` under `/jupyter/` as an internal runtime only.
- Browsers connect only to the frontend and SugarPy-owned `/api/` routes.
- Public HTTPS can be exposed either by Cloudflare Tunnel (custom domain) or Tailscale Funnel (`*.ts.net`).

## Why this setup
- Keeps Jupyter off the public interface directly.
- Avoids mixed-content issues on iPad Safari by keeping browser origin and websocket scheme aligned.
- Adds basic CPU/RAM limits in systemd to reduce blast radius from heavy code.

## Build frontend
```bash
cd /opt/sugarpy/current/web
npm ci
npm run build
```

## Release layout
The demo host uses a stable symlink plus immutable release directories:
- `/opt/sugarpy/current` -> active release symlink used by services
- `/opt/sugarpy/releases/<git-sha>` -> uploaded release contents
- `/opt/sugarpy/shared/.venv` -> shared Python environment
- `/opt/sugarpy/shared/.ipython` -> shared IPython profile
- `/opt/sugarpy/shared/notebooks` -> shared notebooks and autosaves

Deploys build a fresh release under `releases/`, sync tracked notebooks into
`shared/notebooks`, then atomically switch the `current` symlink.

## Install Nginx config
Use `deploy/nginx-sugarpy.conf` as a base.
It should publish only the static frontend and `/api/`, not `/jupyter/`.

Typical flow:
```bash
sudo cp /opt/sugarpy/current/deploy/nginx-sugarpy.conf /etc/nginx/sites-available/sugarpy.conf
sudo ln -s /etc/nginx/sites-available/sugarpy.conf /etc/nginx/sites-enabled/sugarpy.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Install Jupyter systemd service
Use `deploy/systemd/sugarpy-jupyter.service`.

Typical flow:
```bash
sudo cp /opt/sugarpy/current/deploy/systemd/sugarpy-jupyter.service /etc/systemd/system/sugarpy-jupyter.service
sudo systemctl daemon-reload
sudo systemctl enable --now sugarpy-jupyter.service
sudo systemctl status sugarpy-jupyter.service
```

## Public HTTPS via Cloudflare Tunnel (custom domain)
This is the preferred setup when you own a custom domain and do not want to open
router ports.

Typical flow:
1. Add the zone to Cloudflare and update the registrar nameservers to the values
   assigned by Cloudflare.
2. Log in locally once with:
   ```bash
   cloudflared tunnel login
   ```
3. Create a named tunnel and DNS routes:
   ```bash
   cloudflared tunnel create sugarpy
   cloudflared tunnel route dns sugarpy sugarpy.tech
   cloudflared tunnel route dns sugarpy www.sugarpy.tech
   ```
4. Run `cloudflared` on the server as a systemd service that forwards to
   `http://127.0.0.1:80`.
5. Optionally add an Nginx redirect so `www.sugarpy.tech` redirects to
   `https://sugarpy.tech$request_uri`.

Current demo host uses a named Cloudflare Tunnel and keeps the origin private.

## Optional fallback: Tailscale Funnel
Run on the server:
```bash
sudo tailscale funnel --bg --yes http://127.0.0.1:80
```

This exposes a stable HTTPS URL on the server's `*.ts.net` name, for example:
`https://seggver.tailcfa96c.ts.net`

Check status at any time:
```bash
sudo tailscale funnel status
```

## GitHub Actions deployment via self-hosted runner
This repository uses a split CI/CD flow in `.github/workflows/deploy.yml`:
- `checks` run on GitHub-hosted `ubuntu-latest`.
- `deploy` runs on a self-hosted runner on `seggver` with label `sugarpy-prod`.

Why:
- `seggver` is reachable only from the Tailnet/local environment, not from GitHub-hosted runners.
- The self-hosted runner performs a local release build and atomic symlink switch on the server.

Runner requirements on `seggver`:
- Install the GitHub Actions runner under user `egg`.
- Register it to this repo with labels `self-hosted,sugarpy-prod`.
- Keep the runner service enabled.
- Allow user `egg` to run the local deploy path non-interactively:
  - `sudo -u sugarpy /bin/bash -lc ...`
  - `sudo systemctl restart sugarpy-jupyter.service`
  - `sudo systemctl reload nginx`

The deploy job now uses:
```bash
./scripts/deploy-local.sh
```

This script:
- builds a fresh release under `/opt/sugarpy/releases/<sha>`
- reuses `/opt/sugarpy/shared/.venv` and `/opt/sugarpy/shared/notebooks`
- atomically switches `/opt/sugarpy/current`
- reloads `sugarpy-jupyter.service` and `nginx`
- verifies local health endpoints after deploy
- emits a plain tar archive on macOS so deploy output is not polluted by Apple extended-attribute warnings

Manual deploy from local terminal (same mechanism as CI):
```bash
DEPLOY_HOST=seggver \
DEPLOY_USER=sugarpy \
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_PORT=22 \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-remote.sh
```

Manual local deploy directly on `seggver`:
```bash
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-local.sh
```

Deploy health checks use two different local endpoints on purpose:
- Frontend/public shell: `http://127.0.0.1:18081/`
- Internal Jupyter runtime: `http://127.0.0.1:8888/jupyter/api/status?token=...`

Do not probe `/jupyter/` through Nginx on port `18081`; the bundled Nginx config intentionally returns `404` there.

## Shared assistant keys on the demo host
To let the deployed site use the assistant without asking each browser for its own key,
store the shared provider keys in the Jupyter service environment instead of in
`notebooks/`.

Recommended file:
```bash
sudo mkdir -p /etc/sugarpy
sudo chmod 700 /etc/sugarpy
sudo tee /etc/sugarpy/assistant.env >/dev/null <<'EOF'
SUGARPY_ASSISTANT_OPENAI_API_KEY=your-openai-key
SUGARPY_ASSISTANT_MODEL=gpt-5.1-codex-mini
EOF
sudo chmod 600 /etc/sugarpy/assistant.env
```

The bundled `deploy/systemd/sugarpy-jupyter.service` reads that file with:
- `EnvironmentFile=-/etc/sugarpy/assistant.env`

If you cannot edit the systemd unit yet, SugarPy also supports a user-owned fallback file:
```bash
mkdir -p ~/.config/sugarpy
chmod 700 ~/.config/sugarpy
cat > ~/.config/sugarpy/assistant.env <<'EOF'
SUGARPY_ASSISTANT_OPENAI_API_KEY=your-openai-key
SUGARPY_ASSISTANT_MODEL=gpt-5.1-codex-mini
EOF
chmod 600 ~/.config/sugarpy/assistant.env
```

After updating the env file:
```bash
sudo systemctl restart sugarpy-jupyter.service
```

SugarPy will then expose only provider availability and default model to the browser,
while the actual OpenAI/Gemini key stays on the server and model calls are proxied
through Jupyter under `/jupyter/sugarpy/assistant/*`.

## Notes and limitations
- This is still a demo configuration (no full per-user account isolation).
- Shared/demo access is acceptable only through the restricted SugarPy API; do not publish raw Jupyter contents or kernel endpoints.
- For production multi-user separation, migrate to JupyterHub/TLJH or a stronger execution boundary.
