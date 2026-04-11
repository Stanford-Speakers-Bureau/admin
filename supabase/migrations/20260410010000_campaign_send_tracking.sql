-- Track in-flight campaign sends and terminal partial-send counts.
ALTER TABLE "public"."email_campaigns"
ADD COLUMN IF NOT EXISTS "failed_count" bigint NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "send_batch_id" text;
