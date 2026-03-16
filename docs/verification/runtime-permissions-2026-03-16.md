# Runtime Permissions Verification

- Impacted path: `src/sugarpy/runtime_manager.py`
- Verification type: targeted runtime reliability checks plus runtime-control browser checks
- Regression tests added:
  - `test_runtime_manager_recovers_when_attaching_to_unreadable_connection_file_fails`
  - `test_docker_runtime_attach_returns_false_on_connection_file_permission_error`
  - `test_docker_runtime_uses_host_uid_gid_for_container_user`
- Commands run:
  - `./scripts/check runtime`
