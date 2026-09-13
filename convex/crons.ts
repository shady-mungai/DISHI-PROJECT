import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// 12:30 Nairobi (UTC+3) — real service-window start. The sweep is not a cron:
// startSchoolDay schedules it at the resolved cutoff via runAt.
const SERVICE_START_UTC_CRON = "30 9 * * *";

const crons = cronJobs();

crons.cron(
  "materialise meal expectations at service start",
  SERVICE_START_UTC_CRON,
  internal.expectations.startServiceDayForAllSchools,
  {},
);

export default crons;
