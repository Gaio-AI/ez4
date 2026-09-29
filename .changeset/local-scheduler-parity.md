---
'@ez4/local-scheduler': patch
---

The local scheduler runs schedules the way EventBridge Scheduler does. `cron()`, `rate()` and `at()` are evaluated in the service `timezone`, UTC by default, instead of the machine's zone, and days of the week follow the AWS numbering (1 is Sunday), steps included. `nW`, `LW`, a lone `L` in the day of the week and the year field work, and a static schedule doesn't run outside its `startDate`/`endDate`. Any delay works, where Node ran a timer over 24.8 days at once. `createEvent` for an identifier that exists throws `ConflictException`, `updateEvent` for a missing one throws `ResourceNotFoundException`, and an event is deleted once it completes, as `ActionAfterCompletion.DELETE` does. A failed run is retried up to `maxRetries` within `maxAge`: 0 retries by default for a static schedule, and 185 within 24 hours for a dynamic event without a policy. The delay between retries is local.
