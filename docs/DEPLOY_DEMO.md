# Demo Deployment (Multi-user, Single Host)

This document describes a demo setup for multiple concurrent users on one server.

## Overview
- Frontend (`web/dist`) is served by Nginx.
- Jupyter Server runs locally on `127.0.0.1:8888` under `/jupyter/`.
- Browsers connect to one URL, and each user gets their own kernel session.
- Optional public HTTPS is exposed via Cloudflare Quick Tunnel.

## Why this setup
- Keeps Jupyter off the public interface directly.
- Avoids mixed-content issues on iPad Safari by keeping browser origin and websocket scheme aligned.
- Adds basic CPU/RAM limits in systemd to reduce blast radius from heavy code.

## Build frontend
```bash
cd /opt/sugarpy/SugarPy/web
npm ci
npm run build
```

## Install Nginx config
Use `deploy/nginx-sugarpy.conf` as a base.

Typical flow:
```bash
sudo cp /opt/sugarpy/SugarPy/deploy/nginx-sugarpy.conf /etc/nginx/sites-available/sugarpy.conf
sudo ln -s /etc/nginx/sites-available/sugarpy.conf /etc/nginx/sites-enabled/sugarpy.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Install Jupyter systemd service
Use `deploy/systemd/sugarpy-jupyter.service`.

Typical flow:
```bash
sudo cp /opt/sugarpy/SugarPy/deploy/systemd/sugarpy-jupyter.service /etc/systemd/system/sugarpy-jupyter.service
sudo systemctl daemon-reload
sudo systemctl enable --now sugarpy-jupyter.service
sudo systemctl status sugarpy-jupyter.service
```

## Optional: Cloudflare Quick Tunnel
Run on the server:
```bash
cloudflared tunnel --url http://localhost:8080
```

Cloudflared prints a temporary `https://...trycloudflare.com` URL.

## GitHub Actions deployment (no browser flow required)
This repository includes CI/CD in `.github/workflows/deploy.yml`:
- Runs backend tests (`pytest tests/backend/`) and frontend build.
- Deploys to a remote host over SSH only after checks pass.

Set required GitHub repository secrets from terminal:
```bash
./scripts/setup-gh-deploy-secrets.sh seggver sugarpy /opt/sugarpy/SugarPy 22 sugarpy
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
DEPLOY_PATH=/opt/sugarpy/SugarPy \
DEPLOY_PORT=22 \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-remote.sh
```

## Notes and limitations
- This is a demo configuration (shared token, no per-user account isolation).
- For production multi-user separation, migrate to JupyterHub/TLJH.
