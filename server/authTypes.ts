export interface AuthenticatedSocket {
  callsign: string;
  role: "admin" | "regular";
  connectedAt: number;
  ip: string;
  /** Persistent per-browser/app id (localStorage `client-id`); tabs of one browser share it. */
  clientId: string;
}

export interface UserRecord {
  callsign: string;
  passwordHash: string;
  role: "admin" | "regular";
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string;
  preferencesClearedAt?: string;
}

export interface AuditEntry {
  ts: string;
  event: string;
  callsign: string;
  ip: string;
  detail: string;
}

export interface SessionInfo {
  socketId: string;
  callsign: string;
  role: string;
  ip: string;
  connectedAt: number;
}

export interface UserSummary {
  callsign: string;
  role: "admin" | "regular";
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string;
}
