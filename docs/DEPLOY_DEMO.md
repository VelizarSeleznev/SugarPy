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

## Notes and limitations
- This is a demo configuration (shared token, no per-user account isolation).
- For production multi-user separation, migrate to JupyterHub/TLJH.
