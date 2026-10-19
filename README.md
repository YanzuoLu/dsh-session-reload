# dsh-session-reload

Type `/reload` in a dsh session to rebuild that one session without restarting `dsh web`.

## Behavior

`/reload` tears down the session's live agent through the same ordered teardown dsh runs when its owner unloads or the process exits.
It stops and drains the loop, unwinds the agent's scope and preset composition, closes the session log, and unregisters the agent and session.
The next message resumes the session from its log, exactly as after a restart:

- the agent preset is composed from its current definition, so changed tools, prompts, and preset plugins take effect;
- dsh appends its usual "tool added/removed" notice when the tool catalog changed;
- model selection, compaction state, and the rest of the session state are rebuilt from the log;
- an active goal resumes disarmed, so send a message to continue it.

The command refuses while the session has a running turn, running subagents, or running background jobs, and names them.
Scheduled reminders do not block a reload: they are durable host records and fire into the session again after it resumes.
Subagent sessions reload with their top-level session.

## Limits

A session reload rebuilds what belongs to that session. Plugins shared by every session, and plugin code itself, are process-wide.
Configuration changes to shared plugins already reload live, but a changed or newly linked plugin module still needs a `dsh web` restart.

The teardown is located by its `agentLoop.lifecycle(<session id>)` effect label on the owning fiber, which is internal to dsh.
Re-check the plugin after dsh upgrades.

## Install

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-session-reload
```

## Requirements

- dsh `>=0.2.0-rc.2 <0.3.0`, with the commands service (included in the web and TUI profiles)
