import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { SERVICE_START_UTC } from "./lib/dates";

// 12:30 Nairobi (UTC+3) — real service-window start. The sweep is not a cron:
// startSchoolDay schedules it at the resolved cutoff via runAt.
const SERVICE_START_UTC_CRON = `${SERVICE_START_UTC.minute} ${SERVICE_START_UTC.hour} * * *`;

// 15:00 Nairobi on Fridays — after the last service window of the week.
const WEEKLY_DIGEST_UTC_CRON = "0 12 * * 5";

// 21:00 Nairobi — tomorrow's portion forecast, before the cooking cycle (SU-01).
const FORECAST_UTC_CRON = "0 18 * * *";

// 18:00 Nairobi — after the last cutoff, reconcile today's dispatch/confirm/consume.
const RECONCILIATION_UTC_CRON = "0 15 * * *";

// 12:00 Nairobi — half an hour before the window opens, flag readers that
// have not synced since the last service day (SC-04).
const READER_CHECK_UTC_CRON = "0 9 * * *";

const crons = cronJobs();

crons.cron("flag silent readers before service", READER_CHECK_UTC_CRON, internal.readers.flagSilentReaders, {});

crons.cron(
  "materialise meal expectations at service start",
  SERVICE_START_UTC_CRON,
  internal.expectations.startServiceDayForAllSchools,
  {},
);

crons.cron("weekly guardian digest", WEEKLY_DIGEST_UTC_CRON, internal.digest.sendWeeklyDigest, {});

crons.cron("publish tomorrow's portion forecasts", FORECAST_UTC_CRON, internal.deliveries.publishForecastsForAllSchools, {});

crons.cron("daily reconciliation", RECONCILIATION_UTC_CRON, internal.deliveries.reconcileAllSchools, {});

export default crons;
