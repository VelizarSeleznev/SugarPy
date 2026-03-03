# Current Deployment State (seggver)

This file records the current working deployment shape for SugarPy demo hosting.
It intentionally excludes secrets (passwords, private keys, tokens, account data).

## Host and paths
- Host: `seggver` (Debian Linux)
- App root: `/opt/sugarpy/SugarPy`
- Runtime user: `sugarpy`

## Network layout
- Jupyter server: `127.0.0.1:8888` with `base_url=/jupyter/` (not exposed directly)
- Nginx: `:18081` (used because `:80` and `:8080` are occupied by other services)
- Cloudflare Quick Tunnel: forwards external HTTPS traffic to `http://localhost:18081`

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
2. `GET /jupyter/api/status` returns 200 (with token).
3. Creating multiple kernels via `/jupyter/api/kernels` succeeds.
4. Deleting created kernels succeeds.

## Notes
- Quick Tunnel URL is ephemeral and changes on restart.
- This setup is demo-oriented (shared token, no per-user account isolation).
