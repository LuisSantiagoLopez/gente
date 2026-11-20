// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A worker that lost its database connections can stay alive and never take another job, while
// the API keeps accepting messages: the app looks fine and nothing runs. This watchdog checks
// every 30 s that the database answers and that no ready job has waited more than 20 s. If either
// fails twice in a row, the worker exits so its supervisor (Gente's desktop app) starts a fresh
// one, with fresh connections.
/** The one pool method the watchdog needs (a pg Pool fits). */
type Queryable = {
  query: <Row>(sql: string, params: unknown[]) => Promise<{ rows: Row[] }>;
};

export interface WatchdogOptions {
  intervalMs?: number;
  /** A ready job older than this, not taken, counts as stuck. */
  stuckAfterSeconds?: number;
  /** Consecutive bad checks before exiting. */
  strikes?: number;
  onUnhealthy: (reason: string) => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

/** Ready jobs (not locked, due, not exhausted) whose queue is free, waiting too long. */
export const STUCK_JOBS_SQL = `
  select count(*)::int as stuck
    from graphile_worker._private_jobs as jobs
    left join graphile_worker._private_job_queues as queues on queues.id = jobs.job_queue_id
   where jobs.locked_at is null
     and jobs.attempts < jobs.max_attempts
     and jobs.run_at < now() - make_interval(secs => $1)
     and (jobs.job_queue_id is null or queues.locked_at is null)`;

export function startJobPickupWatchdog(pool: Queryable, options: WatchdogOptions) {
  const intervalMs = options.intervalMs ?? 30_000;
  const strikesNeeded = options.strikes ?? 2;
  let strikes = 0;
  let fired = false;
  const check = async () => {
    let reason: string | null = null;
    try {
      const result = await Promise.race([
        pool.query<{ stuck: number }>(STUCK_JOBS_SQL, [options.stuckAfterSeconds ?? 20]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("database check timed out")), 10_000)),
      ]);
      const stuck = result.rows[0]?.stuck ?? 0;
      if (stuck > 0) reason = `${stuck} ready job(s) not picked up`;
    } catch (error) {
      reason = `database check failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (reason === null) {
      strikes = 0;
      return;
    }
    strikes += 1;
    options.log?.("worker.watchdog.strike", { reason, strikes });
    if (strikes >= strikesNeeded && !fired) {
      fired = true;
      options.onUnhealthy(reason);
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), check };
}
