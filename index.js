export const name = 'session-reload'
export const inject = ['commands']

/** Cordis tags each effect disposer with its metadata under this registered symbol. */
const EFFECT_META = Symbol.for('cordis.effect')

/**
 * Work a reload would cut off. Schedules are durable host records that fire
 * into the session again after it resumes, so they do not block a reload.
 */
const BLOCKING_ACTIVITY = new Set(['turn', 'subagent', 'job'])

/**
 * Find the owner-fiber effect that runs one agent's ordered teardown: stop and
 * drain the loop, unwind its scope and preset composition, close the session
 * log, then unregister the agent and session. The agent loop installs it as
 * `agentLoop.lifecycle(<id>)` on whichever fiber created or resumed the agent,
 * and it is the same teardown an owner unload or process exit performs.
 */
function lifecycleTeardown(ctx, sessionId) {
  const label = `agentLoop.lifecycle(${sessionId})`
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      for (const dispose of fiber._disposables) {
        if (dispose[EFFECT_META]?.label === label) return dispose
      }
    }
  }
}

function describeActivity(activity) {
  return activity.map(({ kind, items }) => {
    const labels = (items ?? []).map(item => item.label).filter(Boolean)
    return labels.length ? `${kind} (${labels.join(', ')})` : kind
  }).join('; ')
}

export function apply(ctx) {
  ctx.commands.register({
    name: 'reload',
    description: 'Rebuild this session from its log with the current preset and plugins, without restarting dsh',
    async handler({ agent, commandId }) {
      const sessionId = agent.id
      if (agent.session.header.origin === 'subagent') {
        return { kind: 'error', text: 'Subagent sessions reload with their top-level session.' }
      }
      const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
      const blocking = activity.filter(entry => BLOCKING_ACTIVITY.has(entry.kind))
      if (blocking.length) {
        return { kind: 'error', text: `Stop the running work first: ${describeActivity(blocking)}.` }
      }
      const teardown = lifecycleTeardown(ctx, sessionId)
      if (teardown === undefined) {
        return { kind: 'error', text: 'This session has no live agent to reload.' }
      }
      // The registry appends `command/done` to this session after the handler
      // returns, so tear down only once that event has been written.
      const stop = ctx.on('session/event', (session, event) => {
        if (session.id !== sessionId || event.type !== 'command/done' || event.data.commandId !== commandId) return
        stop()
        Promise.resolve(teardown()).catch((error) => {
          ctx.logger.warn(`session-reload: teardown of ${sessionId} failed`)
          ctx.logger.warn(error)
        })
      })
      return {
        kind: 'success',
        text: 'Reloading. The next message resumes this session from its log with the current preset and plugins. An active goal needs a message to continue.',
      }
    },
  })
}
