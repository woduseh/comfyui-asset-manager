export interface LatestRequest<Query> {
  request(query: Query): Promise<void>
  refreshIfRunning(): void
  cancel(): void
}

/** One active read and one latest pending read; superseded results and errors never commit. */
export function createLatestRequest<Query, Result>(options: {
  read(query: Query): Promise<Result>
  commit(result: Result, query: Query): void
  loading(value: boolean): void
  error(error: unknown): void
}): LatestRequest<Query> {
  let revision = 0
  let target: { query: Query; revision: number } | null = null
  let pending: { query: Query; revision: number } | null = null
  let flight: Promise<void> | null = null

  async function drain(): Promise<void> {
    try {
      while (pending) {
        const current = pending
        pending = null
        try {
          const result = await options.read(current.query)
          if (current.revision === revision) options.commit(result, current.query)
        } catch (error) {
          if (current.revision !== revision) continue
          options.error(error)
          throw error
        }
      }
    } finally {
      flight = null
      options.loading(false)
    }
  }

  function request(query: Query): Promise<void> {
    target = pending = { query, revision: ++revision }
    if (!flight) {
      options.loading(true)
      flight = Promise.resolve().then(drain)
    }
    return flight
  }

  return {
    request,
    refreshIfRunning(): void {
      // The original caller still receives failures; retain them through options.error as well.
      if (flight && target) void request(target.query).catch(() => {})
    },
    cancel(): void {
      revision++
      pending = target = null
    }
  }
}
