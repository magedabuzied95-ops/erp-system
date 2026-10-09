-- Telegram catalog channels: broadcast the storefront catalogue into one
-- Telegram channel per audience (men / women / kids) and keep the available
-- sizes in each post's caption current.
--
-- Additive only: no existing table, column, index, or data is removed or
-- rewritten. The services call ensureTelegramCatalogSchema() at boot with the
-- same statements, so applying this file by hand is optional.

CREATE TABLE IF NOT EXISTS telegram_channels (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  channel_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  -- Numeric chat id (-100...) or @username. Telegram accepts both.
  chat_id TEXT NOT NULL DEFAULT '',
  -- The storefront `gender` classification value this channel mirrors. Empty
  -- means the whole catalogue.
  audience TEXT NOT NULL DEFAULT '',
  invite_url TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, channel_key)
);

-- One row per (channel, product colour). message_id is the post Telegram owns:
-- it is written once and then only edited, so this row is the only record of
-- which post belongs to which colour.
CREATE TABLE IF NOT EXISTS telegram_catalog_posts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  product_id BIGINT NULL,
  color_key TEXT NOT NULL DEFAULT '',
  message_id BIGINT NULL,
  -- Hash of the rendered caption. An edit is only sent when this changes, which
  -- is what keeps a 2,000-colour catalogue inside Telegram's edit rate limit.
  caption_hash TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  -- Short opaque token for the t.me/<bot>?start=<token> deep link. A Telegram
  -- start payload allows only [A-Za-z0-9_-] and 64 characters, so an Arabic
  -- colour key can never travel in it directly.
  deeplink_token TEXT NOT NULL DEFAULT '',
  -- The facts the caption was last rendered from (name, price, colour, tags,
  -- code). A colour that sells out LEAVES the catalogue, so without this there
  -- is nothing left to render its "sold out" caption from.
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT NOT NULL DEFAULT '',
  posted_at TIMESTAMPTZ NULL,
  last_synced_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, channel_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_catalog_posts_channel
  ON telegram_catalog_posts (tenant_id, channel_id, state);

-- The deep link resolves a shopper's /start payload back to one colour. The
-- token is derived from the card id, so the same colour in two channels shares
-- it: not unique, only indexed.
CREATE INDEX IF NOT EXISTS idx_telegram_catalog_posts_deeplink
  ON telegram_catalog_posts (tenant_id, deeplink_token)
  WHERE deeplink_token <> '';

-- The paced outbound queue. Telegram allows roughly 20 messages a minute to one
-- channel, so publishing and editing both go through here rather than straight
-- at the API.
CREATE TABLE IF NOT EXISTS telegram_catalog_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telegram_catalog_jobs_pending
  ON telegram_catalog_jobs (status, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

-- One pending job per (channel, card, action): a sweep that runs while the queue
-- is still draining must not stack a second edit for the same colour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_catalog_jobs_open
  ON telegram_catalog_jobs (tenant_id, channel_id, card_id, action)
  WHERE status IN ('pending', 'failed');
