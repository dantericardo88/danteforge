// supervisor-keepalive.ts — host-sleep survival (CH-011). A pure in-process supervisor dies with the laptop:
// when the host sleeps or reboots, the campaign silently freezes. This generates an OS-level keepalive that
// re-launches the (idempotent, singleton-by-state) supervisor — a Windows Task Scheduler task, a macOS
// launchd agent, or a Linux systemd user timer.
//
// Registering a system scheduled task is outward-facing and hard to reverse, so installKeepalive does NOT
// silently register it: it WRITES the artifact to `.danteforge/keepalive/` and prints the exact one-line
// command for the operator to run. `buildKeepalivePlan` is pure and exported so the generated artifacts are
// unit-tested without touching the real scheduler.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import type { Posture } from './loop-exit-classifier.js';

export interface KeepaliveOptions {
  cwd: string;
  goal: string;
  target: number;
  engine: string;
  posture: Posture;
  /** Re-launch cadence in minutes (Task Scheduler repetition / systemd OnUnitActiveSec). Default 10. */
  everyMinutes?: number;
  /** Absolute node binary + CLI entry to run (defaults to the current process). */
  nodePath?: string;
  entryPath?: string;
}

export interface KeepalivePlan {
  platform: NodeJS.Platform;
  /** File to write under .danteforge/keepalive/. */
  filename: string;
  /** Artifact contents (Task Scheduler XML / launchd plist / systemd units). */
  content: string;
  /** The one-line command the operator runs to register it. */
  registerCmd: string;
  /** The one-line command to remove it. */
  unregisterCmd: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** The `supervise` argv the keepalive launches. */
export function keepaliveArgs(o: KeepaliveOptions): string[] {
  const args = ['supervise', '--engine', o.engine, '--target', String(o.target), '--posture', o.posture];
  if (o.goal) args.push('--goal', o.goal);
  return args;
}

/**
 * PURE: build the platform-appropriate keepalive artifact + register/unregister commands. Deterministic given
 * the options and an explicit platform (so tests cover win32/darwin/linux regardless of the host).
 */
export function buildKeepalivePlan(platform: NodeJS.Platform, o: KeepaliveOptions): KeepalivePlan {
  const every = Math.max(1, o.everyMinutes ?? 10);
  const node = o.nodePath ?? process.execPath;
  const entry = o.entryPath ?? process.argv[1] ?? 'danteforge';
  const args = keepaliveArgs(o);
  const cmdLine = `"${node}" "${entry}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;

  if (platform === 'win32') {
    const argLine = `"${entry}" ${args.map((a) => (a.includes(' ') ? `\"${a}\"` : a)).join(' ')}`;
    const content = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DanteForge auto-reengage Supervisor (host-sleep survival)</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><Repetition><Interval>PT${every}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <WakeToRun>false</WakeToRun>
  </Settings>
  <Actions>
    <Exec>
      <Command>${escapeXml(node)}</Command>
      <Arguments>${escapeXml(argLine)}</Arguments>
      <WorkingDirectory>${escapeXml(o.cwd)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
    const xmlPath = path.join(o.cwd, '.danteforge/keepalive/danteforge-supervisor.xml');
    return {
      platform, filename: 'danteforge-supervisor.xml', content,
      registerCmd: `schtasks /Create /TN DanteForgeSupervisor /XML "${xmlPath}" /F`,
      unregisterCmd: `schtasks /Delete /TN DanteForgeSupervisor /F`,
    };
  }

  if (platform === 'darwin') {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.danteforge.supervisor</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(node)}</string><string>${escapeXml(entry)}</string>${args.map((a) => `<string>${escapeXml(a)}</string>`).join('')}
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(o.cwd)}</string>
  <key>StartInterval</key><integer>${every * 60}</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
`;
    const plistPath = path.join(o.cwd, '.danteforge/keepalive/com.danteforge.supervisor.plist');
    return {
      platform, filename: 'com.danteforge.supervisor.plist', content,
      registerCmd: `cp "${plistPath}" ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.danteforge.supervisor.plist`,
      unregisterCmd: `launchctl unload ~/Library/LaunchAgents/com.danteforge.supervisor.plist`,
    };
  }

  // linux (systemd user units)
  const content = `# danteforge-supervisor.service
[Unit]
Description=DanteForge auto-reengage Supervisor

[Service]
Type=oneshot
WorkingDirectory=${o.cwd}
ExecStart=${cmdLine}

# danteforge-supervisor.timer
[Unit]
Description=Re-launch DanteForge Supervisor every ${every}m

[Timer]
OnBootSec=1min
OnUnitActiveSec=${every}min
Persistent=true

[Install]
WantedBy=timers.target
`;
  return {
    platform, filename: 'danteforge-supervisor.units', content,
    registerCmd: `# split into ~/.config/systemd/user/danteforge-supervisor.{service,timer}, then: systemctl --user enable --now danteforge-supervisor.timer`,
    unregisterCmd: `systemctl --user disable --now danteforge-supervisor.timer`,
  };
}

/** Write the keepalive artifact and instruct the operator how to register it. Does NOT auto-register. */
export async function installKeepalive(o: KeepaliveOptions): Promise<KeepalivePlan> {
  const plan = buildKeepalivePlan(process.platform, o);
  const dir = path.join(o.cwd, '.danteforge/keepalive');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, plan.filename);
  await fs.writeFile(file, plan.content, 'utf8');
  logger.info(`[supervise] keepalive artifact written: ${path.relative(o.cwd, file)}`);
  logger.info('[supervise] To survive host sleep/reboot, register it (one time):');
  logger.info(`           ${plan.registerCmd}`);
  logger.info(`[supervise] To remove later: ${plan.unregisterCmd}`);
  logger.info('[supervise] The task is idempotent — only one supervisor runs at a time (state-singleton); it resumes the saved campaign.');
  return plan;
}
