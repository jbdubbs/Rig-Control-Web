# Authentication

RigControl Web requires every browser client to log in before the rig controls, audio, or any other functionality becomes available. Authentication is JWT-based, and all user accounts are managed through the built-in Admin panel.

---

## First Launch — Default Credentials

When the server starts for the first time with no existing user database, it creates a default admin account:

| Field | Value |
|-------|-------|
| Callsign | `ADMIN` |
| Password | `admin` |

You will be forced to choose a new password before you can access any controls. **Change this password immediately** — the default credential is well-known and the server is accessible to anyone who can reach it on your network.

---

## Logging In

When you open RigControl Web in a browser, the login screen appears automatically. Enter your callsign (case-insensitive — it is normalized to upper-case internally) and password, then press **Login** or hit Enter.

If the login succeeds and your account requires a password change, the password-change dialog appears next. You must complete the change before accessing the dashboard.

A valid login issues a JWT token stored in `localStorage`. The token is valid for **7 days**. On reconnect (e.g. after a page refresh or a network drop), the stored token is sent automatically and the dashboard loads without re-entering credentials if the token is still valid.

---

## Roles

| Role | Capabilities |
|------|-------------|
| **admin** | Full access to all controls and the Admin panel in General Settings |
| **regular** | Full access to all rig controls, audio, and video; no Admin panel |

Both roles have identical access to the radio controls, audio, and spots features.

---

## Changing Your Password

Any logged-in user can change their own password:

1. Open **General Settings** (gear icon).
2. Click **Change Password** in the header area (shown next to your callsign and the Logout button).
3. Enter your current password, then your new password (minimum 8 characters, maximum 72 characters).

Passwords are hashed with bcrypt (cost factor 12). The 72-character limit is enforced explicitly because bcrypt silently truncates at 72 bytes — enforcing it prevents two distinct passwords from being treated as identical.

---

## Logging Out

Click the **Logout** button in the top-right corner of the app header. Your JWT token is removed from `localStorage` and the login screen appears immediately.

---

## Admin Panel

The **Admin** tab is available in General Settings for users with the `admin` role. It is organized into several sections:

### Users

Lists all registered user accounts with their callsign, role, and whether a forced password change is pending.

| Action | Description |
|--------|-------------|
| **Add User** | Create a new account. Specify callsign, initial password, and role. The callsign is normalized to upper-case. |
| **Reset Password** | Set a new temporary password for any user. The user will be required to change it on next login. |
| **Change Role** | Toggle a user between `admin` and `regular`. |
| **Clear Preferences** | Wipe the user's `localStorage` layout and panel state on their next login (or immediately if they are currently connected). Useful when a layout becomes corrupted or you want to restore defaults for a user. |
| **Delete User** | Permanently remove the account. All active sessions for that user are immediately kicked. You cannot delete your own account. |

### Active Sessions

Lists all currently authenticated connections with their callsign, role, IP address, and connection time.

**Force Logout** disconnects a specific session. The affected client is sent an `auth:kicked` event and returns to the login screen.

### Audit Log

A timestamped log of authentication events (newest first). Events recorded:

| Event | When |
|-------|------|
| `login_success` | Successful login |
| `login_failed` | Failed login attempt (bad credentials or non-existent user) |
| `logout` | User-initiated logout |
| `force_logout` | Admin-forced session termination |
| `password_changed` | Successful self-service password change |
| `user_created` | Admin created a new user |
| `user_deleted` | Admin deleted a user |
| `user_modified` | Admin changed a user's role or reset their password |
| `preferences_cleared` | Admin cleared a user's stored preferences |
| `lockout_cleared` | Admin manually unlocked a locked-out callsign |
| `factory_reset` | Factory reset executed |

Each entry shows its full date and time. The audit log is capped at the most recent 1000 entries. The log defaults to showing the 50 most recent; use the limit input to request more.

### Lockouts

Displays callsigns that are currently locked out due to repeated failed login or password-change attempts.

**Unlock** clears the rate-limit counter for a callsign immediately, restoring login access without waiting for the 15-minute window to expire.

### System Info

Shows the application version, server uptime, Node.js version, and TLS certificate expiry date.

### Factory Reset

Deletes the user database (`users.json`) and rotates the JWT secret (`auth.json`). All currently connected sessions are kicked immediately (including yours). The server re-creates the default `ADMIN / admin` account. You must type `RESET` in the confirmation field and click **Factory Reset** to proceed.

> **Warning:** This action is irreversible. All user accounts and their preference namespaces are permanently deleted.

---

## Resetting Accounts on Reinstall

User accounts (`users.json`), the JWT secret (`auth.json`), the audit log (`audit.json`), and your settings (`settings.json`) are stored in the application's data directory, **outside** the program folder:

| Platform | Data directory |
|----------|----------------|
| Windows | `%APPDATA%\RigControl Web` |
| Linux | `~/.config/RigControl Web` |
| macOS | `~/Library/Application Support/RigControl Web` |

Because this directory lives outside the installed program, it **survives a normal uninstall/reinstall**. This is why, after reinstalling, your previous login still works and old settings reappear.

To reset login accounts and settings, use one of these approaches:

- **In-app (any platform):** Log in with the existing admin account and use the Admin panel's [Factory Reset](#factory-reset), or reset individual passwords.
- **Windows uninstaller:** When you uninstall RigControl Web, the uninstaller asks **"Also delete RigControl Web user data (saved settings and login accounts)?"** Choose **Yes** to remove the data directory along with the app. The prompt defaults to **No**, so your data is preserved across an upgrade unless you explicitly opt in.
- **Manual:** With the app fully closed, delete the platform data directory listed above.

After the data is removed, the next launch reseeds the default `ADMIN` / `admin` account (with a forced password change), exactly as on first launch.

---

## Rate Limiting

The server enforces rate limits to resist brute-force attacks:

| Limit | Threshold | Window |
|-------|-----------|--------|
| Login failures per IP | 5 attempts | 15 minutes |
| Login failures per callsign | 10 attempts | 15 minutes |
| Password-change failures per callsign | 5 attempts | 15 minutes |

When a rate limit is reached, the login form shows a countdown timer. The IP-based limit is a flood guard; the callsign-based limit is designed to survive proxies (where all clients share the same source IP) and can be cleared by an admin from the Lockouts section.

Timing-safe password comparison is used for all failed-user lookups to prevent user enumeration via response timing.

---

## Per-User Preferences

Each user's layout configuration and panel collapse state is stored in `localStorage` under a key namespace prefixed with their upper-case callsign (e.g. `W1AW:grid-layout-v1`). This means multiple users sharing the same browser will each have their own independent layout.

When an admin clears a user's preferences, the server sends an `auth:preferences-cleared` event to any currently connected sessions for that user, which triggers an immediate `localStorage` wipe and page reload. If the user is not currently connected, the cleared timestamp is stored in `users.json` and the wipe is applied on their next login.
