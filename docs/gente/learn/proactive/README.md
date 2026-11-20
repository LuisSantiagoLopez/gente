# Proactive engine: 3-day simulation

Fake clock, one step per hour for 72 hours, time zone America/Mexico_City, seed 20261119. Scripted planner and person; the engine, caps, quiet hours, digest and approval hold are the real code.

## Totals

- Actions planned: 27 (done 23, held for approval 6, approved and started 2, skipped 4)
- Pings: 5
- Acceptance rate: 60%
- Undo rate: 4.3%

## Per goal

| Goal                      | Actions | Accepted | Rejected | Undone | Acceptance | Undo  | Progress | Dial    | Dial in use |
| ------------------------- | ------- | -------- | -------- | ------ | ---------- | ----- | -------- | ------- | ----------- |
| Grow my Etsy sales        | 16      | 10       | 3        | 0      | 76.9%      | 0%    | 50%      | go_hard | go_hard     |
| Land a product design job | 7       | 1        | 3        | 0      | 25%        | 0%    | 5%       | normal  | quiet       |
| Ship my habit app         | 4       | 1        | 1        | 1      | 33.3%      | 33.3% | 5%       | normal  | normal      |

## Per day

| Day        | Started | Held for approval | Approved | Pings (local time)                                            | Acceptance |
| ---------- | ------- | ----------------- | -------- | ------------------------------------------------------------- | ---------- |
| 2026-11-23 | 8       | 1                 | 0        | 08:00 1 waiting for your OK; 18:00 Did 8 things for you today | 50%        |
| 2026-11-24 | 8       | 2                 | 1        | 18:00 Did 6 things for you today                              | 50%        |
| 2026-11-25 | 7       | 3                 | 1        | 18:00 Did 6 things for you today; 19:00 1 waiting for your OK | 83.3%      |

## Checks

- everyActionLinkedToGoal: pass
- noPingInQuietHours: pass
- pingsPerDayWithinLimit: pass
- actionsPerDayWithinCap: pass
- minutesPerDayWithinBudget: pass
- riskyWorkOnlyAfterApproval: pass
