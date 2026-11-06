import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { outboxEvents, rallies } from '../db/schema/index.js';
import { isSensitive, type Category } from '../domain/catalog.js';
import { TERMINAL } from '../domain/rally-state.js';
import type { Db } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { enqueue } from '../lib/outbox.js';
import type { Rally } from '../repositories/rallies.js';
import { mapDialogueText } from '../schemas/formation.js';

type DialogueRally = Pick<Rally, 'id' | 'goal' | 'category'>;
export function dialogueKey(rally: DialogueRally): string {
  const revision = createHash('sha256').update(JSON.stringify([rally.goal, rally.category])).digest('hex');
  return `map.dialogue:${rally.id}:${revision}`;
}

export async function queueMapDialogue(db: Db, rally: DialogueRally): Promise<void> {
  const key = dialogueKey(rally);
  await enqueue(db, { type: 'map.dialogue', dedupeKey: key, payload: { rallyId: rally.id, key } });
}

/** Cache the completed job's generated result; normal outbox retention can safely expire it. */
export async function cachedMapDialogues(db: Db, items: readonly DialogueRally[]): Promise<Map<string, string | null>> {
  if (!items.length) return new Map();
  const jobs = await db.select({ key: outboxEvents.dedupeKey, payload: outboxEvents.payload })
    .from(outboxEvents).where(inArray(outboxEvents.dedupeKey, items.map(dialogueKey)));
  const byKey = new Map(jobs.map((job) => [job.key, job]));
  const missing = items.filter((rally) => !byKey.has(dialogueKey(rally)));
  if (missing.length) await db.insert(outboxEvents).values(missing.map((rally) => ({
    type: 'map.dialogue', dedupeKey: dialogueKey(rally), payload: { rallyId: rally.id, key: dialogueKey(rally) },
  }))).onConflictDoNothing();
  const result = new Map<string, string | null>();
  for (const rally of items) {
    const job = byKey.get(dialogueKey(rally));
    const parsed = mapDialogueText.safeParse(job?.payload.dialogue);
    result.set(rally.id, parsed.success ? parsed.data : null);
  }
  return result;
}

export async function generateMapDialogue(deps: Deps, rallyId: string, key: string): Promise<void> {
  const [rally] = await deps.db.select().from(rallies).where(eq(rallies.id, rallyId));
  if (!rally || rally.visibility !== 'public_coarse' || isSensitive(rally.category as Category)
    || !rally.publishedAt || rally.status === 'draft' || TERMINAL.includes(rally.status)
    || rally.expiresAt <= new Date() || key !== dialogueKey(rally)) return;
  const [job] = await deps.db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, key));
  if (!job || mapDialogueText.safeParse(job.payload.dialogue).success) return;
  const { result } = await deps.formation((engine, requestId) => engine.generateMapDialogue({
    requestId, title: rally.goal, category: rally.category as Category,
  }));
  if ('status' in result) throw new Error(`Map dialogue generation failed: ${result.status}`);
  await deps.db.update(outboxEvents).set({ payload: { ...job.payload, dialogue: result.dialogue } })
    .where(eq(outboxEvents.id, job.id));
}
