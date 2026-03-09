# Demo Deployment (Multi-user, Single Host)

This document describes a demo setup for multiple concurrent users on one server.

## Overview
- Frontend (`web/dist`) is served by Nginx.
- Jupyter Server runs locally on `127.0.0.1:8888` under `/jupyter/`.
- Browsers connect to one URL, and each user gets their own kernel session.
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

## GitHub Actions deployment (no browser flow required)
This repository includes CI/CD in `.github/workflows/deploy.yml`:
- Runs backend tests (`pytest tests/backend/`) and frontend build.
- Deploys to a remote host over SSH only after checks pass.

Set required GitHub repository secrets from terminal:
```bash
./scripts/setup-gh-deploy-secrets.sh seggver sugarpy /opt/sugarpy/current 22 sugarpy
```

Required secrets:
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_PORT`
- `DEPLOY_SSH_KEY` (private key used by Actions)
- `DEPLOY_SSH_KNOWN_HOSTS`
- `DEPLOY_JUPYTER_TOKEN` (for post-deploy API health check)

Manual deploy from local terminal (same mechanism as CI):
```bash
DEPLOY_HOST=seggver \
DEPLOY_USER=sugarpy \
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_PORT=22 \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-remote.sh
```

## Notes and limitations
- This is a demo configuration (shared token, no per-user account isolation).
- `/jupyter/` is publicly reachable through the same origin and currently relies on
  a shared token. Treat this as a demo-only exposure until access controls are tightened.
- For production multi-user separation, migrate to JupyterHub/TLJH.
