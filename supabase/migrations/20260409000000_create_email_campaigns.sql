-- Email campaigns table for admin mass email feature
CREATE TABLE IF NOT EXISTS "public"."email_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "subject" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'draft',
  "audience_type" text NOT NULL,
  "event_id" uuid REFERENCES "public"."events"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "include_hero_card" boolean NOT NULL DEFAULT false,
  "sent_at" timestamptz,
  "sent_by" text,
  "recipient_count" bigint,
  "created_by" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_campaigns_status_idx" ON "public"."email_campaigns" ("status");
CREATE INDEX IF NOT EXISTS "email_campaigns_created_at_idx" ON "public"."email_campaigns" ("created_at");
