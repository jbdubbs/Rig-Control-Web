# Dev Notes — RigControl Web

## Current State
A full-stack web application (Express + Vite + Socket.io) designed to control amateur radio equipment via Hamlib's `rigctld`. It features a real-time dashboard with frequency, mode, and meter displays. Recent updates added the ability to automatically start and manage a local `rigctld` process directly from the web interface.

## Active Work
- [x] Implement `rigctld` auto-start logic in backend.
- [x] Create settings persistence (`settings.json`).
- [x] Build frontend settings modal for radio configuration.
- [x] Add status feedback for the `rigctld` process (is it actually running?).
- [x] Add manual "Start/Stop" controls for `rigctld` in the settings modal.
- [x] Implement a "Log" view in the settings modal to see `rigctld` output.
- [x] Add a "Test Connection" button in the settings modal to verify serial port access.
- [x] Implement split VFO mode functionality (UI, backend, visual feedback).
- [ ] Verify `rigctld` binary availability in the production environment.

## Decisions Log
| Decision | Rationale | Date |
|----------|-----------|------|
| Used `spawn` for `rigctld` | Provides better lifecycle management (PID tracking, stream handling) than `exec`. | 2026-03-18 |
| JSON for persistence | `settings.json` and `radios.json` are simple, human-readable, and don't require a database engine. | 2026-03-18 |
| Socket.io for settings | Ensures the backend and frontend stay in sync when auto-start is toggled or settings change. | 2026-03-18 |
| Combined VFO/Mode UI | In compact mode, grouping these saves vertical space for mobile/tablet use. | 2026-03-18 |
| Added `rigctld-status` event | Allows real-time UI feedback on the health of the background process. | 2026-03-18 |
| Manual Start/Stop buttons | Provides user control without needing to toggle the auto-start preference. | 2026-03-18 |
| Buffered Log View | Essential for debugging serial port issues or rigctld crashes without server access. | 2026-03-18 |
| Connection Test Logic | Spawns `rigctld` briefly to verify it can bind to the port and open the serial device. | 2026-03-18 |
| Split VFO Visuals | Used Amber/Red colors to clearly distinguish VFO A and B when in Split mode, matching common radio UI patterns. | 2026-03-19 |

## Known Issues / Tech Debt
- `rigctld` path is assumed to be in the system PATH.
- If `rigctld` is already running outside the app on the same port, the spawned process will fail with an error, which we now catch and display in the log view.
- Split VFO support depends on the specific radio model configured in `rigctld`.

## Architecture Notes
- **Server-as-Manager**: The Express server is not just a proxy but a process manager for `rigctld`.
- **Event-Driven**: All radio state changes flow through Socket.io to ensure low latency.
- **Graceful Shutdown**: The server listens for `SIGINT`/`SIGTERM` to kill the `rigctld` child process, preventing orphaned processes.
- **Log Buffering**: The server keeps the last 100 lines of `rigctld` output in memory to provide context to newly connected clients.
- **Split VFO State**: Managed as a boolean in the rig status, triggering specific UI color overrides.

## Breadcrumbs
> [2026-03-19 03:45 UTC] Split VFO mode is fully implemented. Added "SPLIT" buttons in both compact and full-size modes. Implemented amber/red color feedback for VFO A/B when split is active.
> **Next Step**: Test with real hardware to ensure `set_split_vfo` and `get_split_vfo` commands are correctly handled by various rig drivers.
