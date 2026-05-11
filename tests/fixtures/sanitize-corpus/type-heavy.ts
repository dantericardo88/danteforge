// Fixture: a file dominated by type/interface declarations + one main class.
// Expected outcome: -types.ts extracted; class retained.

export interface UserPreferences {
  theme: 'light' | 'dark';
  fontSize: number;
  notifications: boolean;
}

export interface UserSession {
  userId: string;
  startedAt: string;
  expiresAt: string;
  preferences: UserPreferences;
}

export interface UserActivityLog {
  sessionId: string;
  events: ActivityEvent[];
  lastSeenAt: string;
}

export interface ActivityEvent {
  ts: string;
  kind: 'click' | 'scroll' | 'submit' | 'navigate';
  target: string;
  payload?: Record<string, unknown>;
}

export type AuthState = 'anonymous' | 'authenticated' | 'expired' | 'banned';

export type Permission = 'read' | 'write' | 'admin';

export enum SessionEndReason {
  Logout = 'logout',
  Timeout = 'timeout',
  Revoked = 'revoked',
  System = 'system',
}

export enum ActivityCategory {
  Engagement = 'engagement',
  Transaction = 'transaction',
  Navigation = 'navigation',
}

export class UserManager {
  private sessions = new Map<string, UserSession>();
  private logs = new Map<string, UserActivityLog>();

  createSession(userId: string, prefs: UserPreferences): UserSession {
    const session: UserSession = {
      userId,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      preferences: prefs,
    };
    this.sessions.set(userId, session);
    return session;
  }

  endSession(userId: string, reason: SessionEndReason): boolean {
    void reason;
    return this.sessions.delete(userId);
  }

  recordEvent(userId: string, event: ActivityEvent): void {
    const existing = this.logs.get(userId);
    if (!existing) {
      this.logs.set(userId, { sessionId: userId, events: [event], lastSeenAt: event.ts });
    } else {
      existing.events.push(event);
      existing.lastSeenAt = event.ts;
    }
  }

  getAuthState(userId: string): AuthState {
    const session = this.sessions.get(userId);
    if (!session) return 'anonymous';
    if (new Date(session.expiresAt).getTime() < Date.now()) return 'expired';
    return 'authenticated';
  }
}
