import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAMES = {
  statementAnalysis: "statement-analysis",
  inboundParsing: "inbound-parsing",
  sequences: "sequences",
  nightly: "nightly",
} as const;

export interface StatementAnalysisJob {
  tenantId: string;
  dealId: string;
  documentIds: string[];
}

export function createRedis(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function statementAnalysisQueue(connection: Redis) {
  return new Queue<StatementAnalysisJob>(QUEUE_NAMES.statementAnalysis, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}
