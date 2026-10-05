import { Worker } from "bullmq";
import { processStatementAnalysis } from "./jobs/statementAnalysis";
import { createRedis, QUEUE_NAMES, type StatementAnalysisJob } from "./queues";

const connection = createRedis();

// Object storage is wired in Phase 1; until then the worker refuses to run analysis jobs
// rather than silently doing nothing.
const fetchDocument = async (storageKey: string): Promise<Buffer> => {
  throw new Error(`document fetch not configured (key ${storageKey}); set up S3 in Phase 1`);
};

const statementWorker = new Worker<StatementAnalysisJob>(
  QUEUE_NAMES.statementAnalysis,
  (job) => processStatementAnalysis(job, { fetchDocument }),
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

statementWorker.on("completed", (job) => {
  console.log(`[${QUEUE_NAMES.statementAnalysis}] completed job ${job.id} deal=${job.data.dealId}`);
});
statementWorker.on("failed", (job, err) => {
  console.error(`[${QUEUE_NAMES.statementAnalysis}] failed job ${job?.id}: ${err.message}`);
});

console.log("mca worker started");

async function shutdown() {
  await statementWorker.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
