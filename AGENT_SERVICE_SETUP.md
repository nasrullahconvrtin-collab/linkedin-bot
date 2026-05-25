# LinkedFlow Agent Service Setup

The Railway backend can now create durable jobs even when the local LinkedIn
agent is offline. Jobs stay `pending` in Supabase until the local agent
connects, heartbeats, claims them, runs Playwright, and reports completion or
failure.

The agent must still be running on the employee PC for LinkedIn automation to
execute. The dashboard and backend can queue work, but only the local agent can
open LinkedIn and click buttons.

## Installed app

Preferred install:

```text
LinkedFlow-Agent-Setup.exe
```

The installer creates `LinkedFlowAgent.exe`, Start Menu/Desktop shortcuts, and
Windows login auto-start. No terminal is needed after install.

## Tray app

The preferred local experience is the tray app:

```text
LinkedFlowAgent.exe
```

The tray menu includes:

- Start Agent
- Stop Agent
- Pause Jobs
- Resume Jobs
- Open Logs
- Open Dashboard
- Backup Browser Profile
- Export Agent Config
- Status
- Exit

Logs are stored in:

```text
%LOCALAPPDATA%\LinkedFlowAgent\logs
```

The tray app starts the worker without a terminal window. Jobs can be paused
safely without losing pending backend jobs.

## Browser isolation

The agent uses isolated Playwright persistent browser profiles:

```text
%LOCALAPPDATA%\LinkedFlowAgent\profiles\profile_1
```

This is separate from your normal Chrome profile. LinkedIn cookies remain local
on the machine and are not uploaded to the backend. You can keep using your
regular browser normally while automation runs in the isolated agent browser.

## Windows auto-start

The installer registers `LinkedFlow Agent` to start on Windows login. If
scheduler jobs were created while the laptop was off, they run after the agent
reconnects.

## Local backups

Use the tray menu:

- `Backup Browser Profile`
- `Export Agent Config`
- `Open Backups`

Backups are stored in:

```text
%LOCALAPPDATA%\LinkedFlowAgent\backups
```

## How status works

- **Scheduler Active**: dashboard schedule is enabled and creates backend jobs.
- **Agent Online**: local agent heartbeated recently.
- **Pending Jobs**: jobs waiting for this profile.
- **Running/Completed/Failed**: job lifecycle in Supabase.
- **Daily Sent X/25**: profile usage limit.

If the agent is offline, jobs remain pending. Nothing is lost.

## VPS preparation

A VPS is a cloud Windows computer that stays online 24/7. Later, LinkedFlow can
run the same local agent on a Windows VPS instead of your personal laptop.

Benefits:

- automation keeps running while your laptop is off
- scheduling is more reliable
- less interruption on your personal device
- the same isolated browser profile model still applies

Do not store LinkedIn passwords centrally. The VPS would still keep LinkedIn
sessions local to its isolated browser profile.
