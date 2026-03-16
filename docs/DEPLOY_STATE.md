# Current Deployment State (seggver)

This file records the current working deployment shape for SugarPy demo hosting.
It intentionally excludes secrets (passwords, private keys, tokens, account data).

## Host and paths
- Host: `seggver` (Debian Linux)
- App root: `/opt/sugarpy`
- Active release symlink: `/opt/sugarpy/current`
- Release directory root: `/opt/sugarpy/releases`
- Shared runtime state: `/opt/sugarpy/shared`
- Runtime user: `sugarpy`

## Network layout
- Jupyter server: `127.0.0.1:8888` with `base_url=/jupyter/`
- Nginx: listens on `:80` and `:18081`
- Cloudflare Tunnel: forwards external HTTPS traffic to `http://127.0.0.1:80`
- Public demo URL: `https://sugarpy.tech`
- Canonical host: `https://sugarpy.tech`
- Secondary host: `https://www.sugarpy.tech` (redirects to canonical host)

## Services
- `sugarpy-jupyter.service`
- `nginx.service`
- `sugarpy-cloudflared.service`

All three services are expected to be `active` in systemd.

## Jupyter runtime flags
- `--ServerApp.base_url=/jupyter/`
- `--IdentityProvider.token=...` (token value intentionally not stored here)
- `--ServerApp.allow_origin=*`
- `--ServerApp.allow_remote_access=True`
- `--MappingKernelManager.cull_idle_timeout=1800`
- `--MappingKernelManager.cull_interval=60`

## Resource limits (systemd cgroups)
- `MemoryMax=8G`
- `MemorySwapMax=0`
- `CPUQuota=200%`
- `Restart=on-failure`

## Verification checklist
1. UI returns 200 from the public tunnel URL.
2. `GET http://127.0.0.1:8888/jupyter/api/status` returns 200 (with token).
3. Creating multiple kernels via `http://127.0.0.1:8888/jupyter/api/kernels` succeeds.
4. Deleting created kernels succeeds.

## Notes
- `/jupyter/` is intentionally blocked at Nginx and remains internal-only on `127.0.0.1:8888`.
- This setup is demo-oriented (shared token, no per-user account isolation).
- Deploys should target `/opt/sugarpy/current` and build a fresh release under `/opt/sugarpy/releases/<sha>` before switching the symlink.
- Shared assistant keys, when used, should live in `/etc/sugarpy/assistant.env` and be consumed by the Jupyter service environment, not under `notebooks/`.
