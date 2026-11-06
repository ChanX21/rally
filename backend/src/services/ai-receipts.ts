import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../lib/db-types.js';

export const aiReceiptSchema = z.object({
  task: z.string(), requestId: z.string(), outcome: z.string(), createdAt: z.string(),
});

/** Only provider request IDs; no prompts, candidate identities or internal trace UUIDs. */
export async function listAiReceipts(db: Db, rallyId: string) {
  const rows = await db.execute(sql`
    select task, request_id as "requestId", outcome, created_at::text as "createdAt"
    from model_runs m
    where request_id is not null and (
      m.rally_id = ${rallyId}::uuid
      or m.id in (select model_run_id from intents where id = (select intent_id from rallies where id = ${rallyId}::uuid))
      or m.id in (select model_run_id from match_proposals where rally_id = ${rallyId}::uuid)
      or m.id in (select model_run_id from rally_proofs where rally_id = ${rallyId}::uuid)
    )
    order by created_at desc, id desc limit 50
  `);
  return z.array(aiReceiptSchema).parse([...rows]);
}
