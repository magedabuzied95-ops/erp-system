--
-- PostgreSQL database dump
--

\restrict e6MNBSWtbDeaygkSFVHtXE9uUIEi1tAQmE1QH9VSXmKAIfkgYgGMwym789CPbcO

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: enforce_single_system_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_single_system_branch_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      keeper_id BIGINT;
    BEGIN
      SELECT id INTO keeper_id
      FROM branches
      WHERE name = 'فرع البشبيشي'
      ORDER BY id ASC
      LIMIT 1;

      IF keeper_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM keeper_id THEN
        NEW.branch_id := keeper_id;
      END IF;

      RETURN NEW;
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounting_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_audit_logs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint,
    action character varying(120) NOT NULL,
    entity_type character varying(120) NOT NULL,
    entity_id bigint,
    before_data jsonb,
    after_data jsonb,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: accounting_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounting_audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounting_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounting_audit_logs_id_seq OWNED BY public.accounting_audit_logs.id;


--
-- Name: accounting_order_item_cost_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_order_item_cost_overrides (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    order_item_id bigint NOT NULL,
    product_id bigint,
    variant_id bigint,
    unit_cost numeric(12,2) NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: accounting_order_item_cost_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounting_order_item_cost_overrides_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounting_order_item_cost_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounting_order_item_cost_overrides_id_seq OWNED BY public.accounting_order_item_cost_overrides.id;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    parent_id bigint,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id bigint
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id integer NOT NULL,
    user_id integer,
    action character varying(255),
    entity character varying(255),
    entity_id integer,
    details text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_logs_id_seq OWNED BY public.activity_logs.id;


--
-- Name: ai_agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_settings (
    tenant_id bigint NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_channel_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_channel_conversations (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    channel text NOT NULL,
    external_conversation_id text NOT NULL,
    external_customer_id text DEFAULT ''::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    customer_profile_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_message_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_message text DEFAULT ''::text NOT NULL,
    customer_avatar_url text DEFAULT ''::text NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL,
    is_group boolean DEFAULT false NOT NULL
);


--
-- Name: ai_channel_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_channel_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_channel_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_channel_conversations_id_seq OWNED BY public.ai_channel_conversations.id;


--
-- Name: ai_channel_event_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_channel_event_logs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    channel text NOT NULL,
    direction text NOT NULL,
    external_customer_id text DEFAULT ''::text NOT NULL,
    conversation_id text DEFAULT ''::text NOT NULL,
    message_preview text DEFAULT ''::text NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    external_message_id text DEFAULT ''::text NOT NULL,
    dedupe_key text DEFAULT ''::text NOT NULL
);


--
-- Name: ai_channel_event_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_channel_event_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_channel_event_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_channel_event_logs_id_seq OWNED BY public.ai_channel_event_logs.id;


--
-- Name: ai_channel_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_channel_settings (
    tenant_id bigint NOT NULL,
    channel text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    channel_id text,
    platform text,
    ai_mode text DEFAULT 'suggest_only'::text NOT NULL,
    tone text,
    debug jsonb DEFAULT '{}'::jsonb NOT NULL,
    safety jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: ai_conversation_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversation_memories (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    session_id text NOT NULL,
    customer_id bigint,
    customer_name text DEFAULT ''::text NOT NULL,
    customer_phone text DEFAULT ''::text NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    negative_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    shopping_intent text DEFAULT ''::text NOT NULL,
    last_products jsonb DEFAULT '[]'::jsonb NOT NULL,
    conversation_tone text DEFAULT 'friendly'::text NOT NULL,
    urgency_level text DEFAULT 'low'::text NOT NULL,
    preferred_category text DEFAULT ''::text NOT NULL,
    customer_state text DEFAULT 'browsing'::text NOT NULL,
    lead_quality_score integer DEFAULT 0 NOT NULL,
    engagement_score integer DEFAULT 0 NOT NULL,
    intent_score integer DEFAULT 0 NOT NULL,
    lead_capture_prompted_at timestamp without time zone,
    lead_captured_at timestamp without time zone,
    last_interaction_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_conversation_memories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_conversation_memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_conversation_memories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_conversation_memories_id_seq OWNED BY public.ai_conversation_memories.id;


--
-- Name: ai_customer_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_customer_interactions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    profile_id bigint,
    session_id text DEFAULT ''::text NOT NULL,
    source_channel text DEFAULT 'web_chat'::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    ai_response text DEFAULT ''::text NOT NULL,
    intent_type text DEFAULT ''::text NOT NULL,
    sentiment text DEFAULT 'neutral'::text NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    detected_intent text DEFAULT ''::text NOT NULL,
    intent_confidence numeric(5,2),
    detected_language text,
    handoff_to_human boolean DEFAULT false,
    resolution_status text DEFAULT 'open'::text,
    ai_response_time_ms integer,
    channel text DEFAULT 'web_chat'::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    last_message text DEFAULT ''::text NOT NULL
);


--
-- Name: ai_customer_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_customer_interactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_customer_interactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_customer_interactions_id_seq OWNED BY public.ai_customer_interactions.id;


--
-- Name: ai_customer_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_customer_memories (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    profile_id bigint,
    session_id text DEFAULT ''::text NOT NULL,
    memory_type text DEFAULT 'preference'::text NOT NULL,
    memory_key text DEFAULT ''::text NOT NULL,
    memory_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_customer_memories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_customer_memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_customer_memories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_customer_memories_id_seq OWNED BY public.ai_customer_memories.id;


--
-- Name: ai_customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_customer_profiles (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    first_name text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    preferred_size text DEFAULT ''::text NOT NULL,
    preferred_colors jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_models jsonb DEFAULT '[]'::jsonb NOT NULL,
    favorite_brands jsonb DEFAULT '[]'::jsonb NOT NULL,
    budget_range jsonb DEFAULT '{}'::jsonb NOT NULL,
    viewed_products jsonb DEFAULT '[]'::jsonb NOT NULL,
    abandoned_products jsonb DEFAULT '[]'::jsonb NOT NULL,
    order_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    support_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    city_area text DEFAULT ''::text NOT NULL,
    conversation_summary text DEFAULT ''::text NOT NULL,
    customer_sentiment text DEFAULT 'neutral'::text NOT NULL,
    memory_score integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_name text DEFAULT ''::text NOT NULL,
    source_channel text DEFAULT ''::text NOT NULL,
    external_customer_id text DEFAULT ''::text NOT NULL,
    profile_pic_url text DEFAULT ''::text NOT NULL,
    last_profile_sync_at timestamp without time zone
);


--
-- Name: ai_customer_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_customer_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_customer_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_customer_profiles_id_seq OWNED BY public.ai_customer_profiles.id;


--
-- Name: ai_followup_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_followup_tasks (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    profile_id bigint,
    session_id text DEFAULT ''::text NOT NULL,
    source_channel text DEFAULT 'web_chat'::text NOT NULL,
    trigger_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_at timestamp without time zone NOT NULL,
    last_sent_at timestamp without time zone,
    cooldown_until timestamp without time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    manual_message text DEFAULT ''::text NOT NULL,
    sent_internal_at timestamp without time zone,
    manual_ready_at timestamp without time zone,
    completed_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    snoozed_until timestamp without time zone,
    stopped_reason text DEFAULT ''::text NOT NULL,
    action_by bigint
);


--
-- Name: ai_followup_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_followup_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_followup_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_followup_tasks_id_seq OWNED BY public.ai_followup_tasks.id;


--
-- Name: ai_marketing_content_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_content_queue (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    content_type character varying(20) DEFAULT 'story'::character varying NOT NULL,
    strategy_type character varying(60) DEFAULT 'random_discovery'::character varying NOT NULL,
    department_id bigint,
    department_name text DEFAULT ''::text NOT NULL,
    segment_type character varying(80) DEFAULT ''::character varying NOT NULL,
    segment_id bigint,
    segment_name text DEFAULT ''::text NOT NULL,
    product_id bigint,
    variant_id bigint,
    title text DEFAULT ''::text NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    product_url text DEFAULT ''::text NOT NULL,
    design_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'generated'::character varying NOT NULL,
    scheduled_at timestamp without time zone,
    published_at timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    media_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    primary_image_url text DEFAULT ''::text NOT NULL,
    variant_image_url text DEFAULT ''::text NOT NULL,
    color text DEFAULT ''::text NOT NULL,
    size text DEFAULT ''::text NOT NULL,
    publish_status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    platform_post_id text,
    published_platforms jsonb DEFAULT '[]'::jsonb NOT NULL,
    platform_publish_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    publish_error text,
    rendered_image_url text DEFAULT ''::text NOT NULL,
    story_image_url text DEFAULT ''::text NOT NULL,
    final_asset_url text DEFAULT ''::text NOT NULL,
    platform_error_code text,
    platform_error_message text,
    publish_attempts integer DEFAULT 0 NOT NULL,
    last_publish_attempt_at timestamp without time zone
);


--
-- Name: ai_marketing_content_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_marketing_content_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_marketing_content_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_marketing_content_queue_id_seq OWNED BY public.ai_marketing_content_queue.id;


--
-- Name: ai_marketing_content_timeline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_content_timeline (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    queue_id bigint,
    user_id bigint,
    action character varying(60) NOT NULL,
    status character varying(30) DEFAULT ''::character varying NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_marketing_content_timeline_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_marketing_content_timeline_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_marketing_content_timeline_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_marketing_content_timeline_id_seq OWNED BY public.ai_marketing_content_timeline.id;


--
-- Name: ai_marketing_generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_generation_runs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    run_type character varying(20) DEFAULT 'daily'::character varying NOT NULL,
    status character varying(30) DEFAULT 'running'::character varying NOT NULL,
    requested_stories integer DEFAULT 0 NOT NULL,
    requested_posts integer DEFAULT 0 NOT NULL,
    generated_stories integer DEFAULT 0 NOT NULL,
    generated_posts integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at timestamp without time zone
);


--
-- Name: ai_marketing_generation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_marketing_generation_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_marketing_generation_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_marketing_generation_runs_id_seq OWNED BY public.ai_marketing_generation_runs.id;


--
-- Name: ai_marketing_insights_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_insights_cache (
    tenant_id bigint NOT NULL,
    best_hours jsonb DEFAULT '[]'::jsonb NOT NULL,
    best_days jsonb DEFAULT '[]'::jsonb NOT NULL,
    best_windows jsonb DEFAULT '[]'::jsonb NOT NULL,
    engagement_scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    timezone text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'fallback'::text NOT NULL,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_marketing_performance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_performance_snapshots (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    queue_id bigint,
    platform character varying(30) NOT NULL,
    platform_post_id text DEFAULT ''::text NOT NULL,
    reach integer,
    impressions integer,
    reactions integer,
    likes integer,
    comments integer,
    shares integer,
    saves integer,
    clicks integer,
    profile_visits integer,
    engagement_rate numeric(10,4),
    performance_score integer DEFAULT 0 NOT NULL,
    raw_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    synced_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_marketing_performance_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_marketing_performance_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_marketing_performance_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_marketing_performance_snapshots_id_seq OWNED BY public.ai_marketing_performance_snapshots.id;


--
-- Name: ai_marketing_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_marketing_settings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    planning_mode character varying(20) DEFAULT 'weekly'::character varying NOT NULL,
    stories_per_day integer DEFAULT 20 NOT NULL,
    posts_per_day integer DEFAULT 3 NOT NULL,
    auto_publish boolean DEFAULT false NOT NULL,
    require_approval boolean DEFAULT true NOT NULL,
    campaign_mode character varying(20) DEFAULT 'balanced'::character varying NOT NULL,
    active_strategies jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    daily_content_quotas jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    auto_archive_published_after_days integer DEFAULT 30 CONSTRAINT ai_marketing_settings_auto_archive_published_after_day_not_null NOT NULL,
    auto_delete_archived_after_days integer DEFAULT 90 NOT NULL
);


--
-- Name: ai_marketing_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_marketing_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_marketing_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_marketing_settings_id_seq OWNED BY public.ai_marketing_settings.id;


--
-- Name: ai_outbound_dedup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_outbound_dedup (
    id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
    channel text NOT NULL,
    instance text,
    conversation_id text NOT NULL,
    inbound_message_id text NOT NULL,
    outbound_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_product_image_visual_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_product_image_visual_index (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    product_id bigint NOT NULL,
    variant_id bigint,
    color text DEFAULT ''::text NOT NULL,
    image_url text NOT NULL,
    image_public_id text DEFAULT ''::text NOT NULL,
    image_hash text DEFAULT ''::text NOT NULL,
    visual_tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    detected_brand text DEFAULT ''::text NOT NULL,
    detected_model text DEFAULT ''::text NOT NULL,
    detected_category text DEFAULT ''::text NOT NULL,
    detected_colors text[] DEFAULT ARRAY[]::text[] NOT NULL,
    detected_silhouette text DEFAULT ''::text NOT NULL,
    detected_features text[] DEFAULT ARRAY[]::text[] NOT NULL,
    visual_text text DEFAULT ''::text NOT NULL,
    visual_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    image_embedding jsonb,
    source text DEFAULT 'erp'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    product_name text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    gender text DEFAULT ''::text NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    available_sizes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    text_aliases text[] DEFAULT ARRAY[]::text[] NOT NULL,
    visual_attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    aliases text[] DEFAULT ARRAY[]::text[] NOT NULL,
    last_indexed_at timestamp without time zone,
    embedding jsonb,
    embedding_model text DEFAULT ''::text NOT NULL,
    embedding_updated_at timestamp without time zone
);


--
-- Name: ai_product_image_visual_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_product_image_visual_index_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_product_image_visual_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_product_image_visual_index_id_seq OWNED BY public.ai_product_image_visual_index.id;


--
-- Name: ai_reply_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_reply_traces (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    session_id text DEFAULT ''::text NOT NULL,
    inbound_message_id bigint,
    external_message_id text DEFAULT ''::text NOT NULL,
    trace jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    error jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at timestamp without time zone
);


--
-- Name: ai_reply_traces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_reply_traces_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_reply_traces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_reply_traces_id_seq OWNED BY public.ai_reply_traces.id;


--
-- Name: ai_sales_conversation_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_sales_conversation_states (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    conversation_id text NOT NULL,
    customer_id text DEFAULT ''::text NOT NULL,
    channel text DEFAULT 'web_chat'::text NOT NULL,
    current_state text DEFAULT 'DISCOVERY'::text NOT NULL,
    previous_state text DEFAULT ''::text NOT NULL,
    state_reason text DEFAULT ''::text NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_sales_conversation_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_sales_conversation_states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_sales_conversation_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_sales_conversation_states_id_seq OWNED BY public.ai_sales_conversation_states.id;


--
-- Name: ai_sales_journey_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_sales_journey_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    conversation_id text NOT NULL,
    customer_id text DEFAULT ''::text NOT NULL,
    event_type text NOT NULL,
    product_id bigint,
    variant_id bigint,
    channel text DEFAULT 'web_chat'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_sales_journey_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_sales_journey_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_sales_journey_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_sales_journey_events_id_seq OWNED BY public.ai_sales_journey_events.id;


--
-- Name: ai_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_support_messages (
    id bigint NOT NULL,
    session_ref_id bigint,
    tenant_id bigint NOT NULL,
    user_id bigint,
    session_id text NOT NULL,
    customer_message text NOT NULL,
    ai_answer text DEFAULT ''::text NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    needs_human_support boolean DEFAULT true NOT NULL,
    sources_used jsonb DEFAULT '[]'::jsonb NOT NULL,
    suggested_products jsonb DEFAULT '[]'::jsonb NOT NULL,
    suggested_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    detected_intent text DEFAULT ''::text NOT NULL,
    fallback_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    message_text text DEFAULT ''::text NOT NULL,
    requested_product_terms jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_sizes jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_colors jsonb DEFAULT '[]'::jsonb NOT NULL,
    clicked_product_id bigint,
    added_to_cart_after_chat boolean,
    visual_attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    staff_message text DEFAULT ''::text NOT NULL,
    sender_type character varying(40) DEFAULT 'customer'::character varying NOT NULL,
    manual_message boolean DEFAULT false NOT NULL,
    staff_user_id bigint,
    staff_user_name text DEFAULT ''::text NOT NULL,
    intent_confidence numeric(5,2),
    sentiment text,
    detected_language text,
    handoff_to_human boolean DEFAULT false,
    resolution_status text DEFAULT 'open'::text,
    ai_response_time_ms integer,
    channel text DEFAULT 'web_chat'::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    last_message text DEFAULT ''::text NOT NULL,
    external_message_id text DEFAULT ''::text NOT NULL,
    dedupe_key text DEFAULT ''::text NOT NULL,
    delivery_status text DEFAULT ''::text NOT NULL,
    delivery_error text DEFAULT ''::text NOT NULL,
    customer_avatar_url text DEFAULT ''::text NOT NULL,
    provider_message_id text DEFAULT ''::text NOT NULL,
    whatsapp_instance text DEFAULT ''::text NOT NULL,
    remote_jid text DEFAULT ''::text NOT NULL,
    source_path text DEFAULT ''::text NOT NULL,
    insert_source text,
    resolved_reply_jid text DEFAULT ''::text NOT NULL,
    resolved_phone text DEFAULT ''::text NOT NULL
);


--
-- Name: ai_support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_support_messages_id_seq OWNED BY public.ai_support_messages.id;


--
-- Name: ai_support_product_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_support_product_aliases (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    alias text NOT NULL,
    mapped_product_id bigint,
    usage_count integer DEFAULT 0 NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_support_product_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_support_product_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_support_product_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_support_product_aliases_id_seq OWNED BY public.ai_support_product_aliases.id;


--
-- Name: ai_support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_support_sessions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint,
    session_id text NOT NULL,
    source character varying(80) DEFAULT 'admin_console'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status character varying(40) DEFAULT 'ai_active'::character varying NOT NULL,
    assigned_user_id bigint,
    assigned_user_name text DEFAULT ''::text NOT NULL,
    takeover_started_at timestamp without time zone,
    returned_to_ai_at timestamp without time zone,
    closed_at timestamp without time zone,
    detected_intent text,
    intent_confidence numeric(5,2),
    sentiment text,
    detected_language text,
    handoff_to_human boolean DEFAULT false,
    resolution_status text DEFAULT 'open'::text,
    ai_response_time_ms integer,
    channel text DEFAULT 'web_chat'::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    last_message text DEFAULT ''::text NOT NULL,
    escalation_reason text DEFAULT ''::text NOT NULL,
    last_escalation_keyword text DEFAULT ''::text NOT NULL,
    escalated_at timestamp without time zone,
    hot_lead boolean DEFAULT false NOT NULL,
    lead_score integer DEFAULT 0 NOT NULL,
    ai_insight text DEFAULT ''::text NOT NULL,
    customer_avatar_url text DEFAULT ''::text NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: ai_support_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_support_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_support_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_support_sessions_id_seq OWNED BY public.ai_support_sessions.id;


--
-- Name: attendance_device_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_device_bindings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    business_date date NOT NULL,
    device_key text NOT NULL,
    device_fingerprint text,
    user_agent text,
    ip_address text,
    first_attendance_log_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: attendance_device_bindings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_device_bindings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_device_bindings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_device_bindings_id_seq OWNED BY public.attendance_device_bindings.id;


--
-- Name: attendance_device_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_device_settings (
    tenant_id bigint NOT NULL,
    new_device_policy character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    require_checkin_to_view_tasks boolean DEFAULT true CONSTRAINT attendance_device_settings_require_checkin_to_view_tas_not_null NOT NULL,
    auto_redirect_after_checkin boolean DEFAULT true NOT NULL,
    require_device_approval boolean DEFAULT false NOT NULL,
    attendance_require_device_approval boolean DEFAULT false CONSTRAINT attendance_device_settings_attendance_require_device_a_not_null NOT NULL
);


--
-- Name: attendance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    attendance_log_id bigint,
    action_type character varying(30) NOT NULL,
    action_timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_agent text,
    ip_address text,
    latitude numeric,
    longitude numeric,
    source character varying(50) DEFAULT 'branch_qr'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gps_distance_meters numeric,
    gps_verification_result character varying(30),
    device_token text,
    device_id bigint,
    device_fingerprint text,
    device_key text
);


--
-- Name: attendance_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_events_id_seq OWNED BY public.attendance_events.id;


--
-- Name: attendance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_logs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    shift_id bigint,
    branch_id bigint,
    attendance_date date NOT NULL,
    check_in timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    check_out timestamp without time zone,
    attendance_source character varying(50) DEFAULT 'manual'::character varying NOT NULL,
    work_minutes integer DEFAULT 0 NOT NULL,
    late_minutes integer DEFAULT 0 NOT NULL,
    early_leave_minutes integer DEFAULT 0 NOT NULL,
    overtime_minutes integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    check_in_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    check_out_at timestamp without time zone,
    check_in_latitude numeric,
    check_in_longitude numeric,
    check_out_latitude numeric,
    check_out_longitude numeric,
    status character varying(30) DEFAULT 'checked_in'::character varying NOT NULL,
    next_opening_employee_id bigint,
    closed_by_user_id bigint,
    closed_at timestamp without time zone,
    check_in_gps_distance_meters numeric,
    check_in_gps_verification_result character varying(30),
    check_out_gps_distance_meters numeric,
    check_out_gps_verification_result character varying(30),
    device_fingerprint text,
    device_key text,
    user_agent text,
    ip_address text,
    worked_hours numeric(8,2) DEFAULT 0 NOT NULL,
    device_ip text,
    selected_shift_id bigint,
    resolved_shift_start_time timestamp without time zone,
    resolved_shift_end_time timestamp without time zone,
    shift_resolution_status character varying(40) DEFAULT 'unresolved'::character varying NOT NULL
);


--
-- Name: attendance_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_logs_id_seq OWNED BY public.attendance_logs.id;


--
-- Name: attendance_suspicious_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_suspicious_activity_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint,
    branch_id bigint,
    device_token text,
    event_type character varying(80) NOT NULL,
    severity character varying(20) DEFAULT 'warning'::character varying NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_agent text,
    ip_address text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: attendance_suspicious_activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_suspicious_activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_suspicious_activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_suspicious_activity_logs_id_seq OWNED BY public.attendance_suspicious_activity_logs.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    user_id bigint,
    action character varying(120) NOT NULL,
    entity_type character varying(120),
    entity_id bigint,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50),
    phone character varying(50),
    address text,
    manager character varying(255),
    default_warehouse_id bigint,
    is_active boolean DEFAULT true NOT NULL,
    latitude numeric,
    longitude numeric,
    allowed_radius_meters integer DEFAULT 100 NOT NULL,
    qr_token text DEFAULT (gen_random_uuid())::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    attendance_qr_token text DEFAULT encode(public.gen_random_bytes(32), 'hex'::text),
    attendance_radius_meters integer DEFAULT 100 NOT NULL,
    attendance_public_code character varying(32)
);


--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    logo_url text,
    image_url text,
    slug character varying(255) DEFAULT ''::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: brands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.brands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.brands_id_seq OWNED BY public.brands.id;


--
-- Name: cash_drawer_shift_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_drawer_shift_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    shift_id bigint NOT NULL,
    event_type character varying(50) NOT NULL,
    source_type character varying(100),
    source_id bigint,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint
);


--
-- Name: cash_drawer_shift_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_drawer_shift_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_drawer_shift_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_drawer_shift_events_id_seq OWNED BY public.cash_drawer_shift_events.id;


--
-- Name: cash_drawer_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_drawer_shifts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    opened_by bigint NOT NULL,
    closed_by bigint,
    opened_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at timestamp without time zone,
    opening_cash numeric(12,2) DEFAULT 0 NOT NULL,
    expected_cash numeric(12,2) DEFAULT 0 NOT NULL,
    actual_cash numeric(12,2),
    difference numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    financial_account_id bigint,
    opened_by_user_id bigint,
    closed_by_user_id bigint,
    closing_cash numeric(12,2),
    cash_difference numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: cash_drawer_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_drawer_shifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_drawer_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_drawer_shifts_id_seq OWNED BY public.cash_drawer_shifts.id;


--
-- Name: cashbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashbox (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    balance numeric(12,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id bigint,
    status character varying(50) DEFAULT 'open'::character varying NOT NULL,
    opened_by bigint,
    opened_at timestamp without time zone,
    closed_at timestamp without time zone,
    shift_summary text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    next_opening_employee_id bigint,
    closed_by_user_id bigint
);


--
-- Name: cashbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cashbox_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cashbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cashbox_id_seq OWNED BY public.cashbox.id;


--
-- Name: cashbox_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashbox_movements (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    cashbox_id bigint NOT NULL,
    movement_type character varying(50) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    note text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cashbox_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cashbox_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cashbox_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cashbox_movements_id_seq OWNED BY public.cashbox_movements.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    parent_id bigint,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_rules (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) NOT NULL,
    scope_type character varying(50) DEFAULT 'global'::character varying NOT NULL,
    scope_id bigint,
    rule_type character varying(50) DEFAULT 'percentage'::character varying NOT NULL,
    value numeric(12,2) DEFAULT 0 NOT NULL,
    apply_to character varying(50) DEFAULT 'sale'::character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: commission_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_rules_id_seq OWNED BY public.commission_rules.id;


--
-- Name: company_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_profiles (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    company_name character varying(255) NOT NULL,
    legal_name character varying(255),
    logo_url text,
    address text,
    phone character varying(50),
    email character varying(255),
    tax_number character varying(120),
    currency character varying(10) DEFAULT 'USD'::character varying NOT NULL,
    language character varying(20) DEFAULT 'en'::character varying NOT NULL,
    invoice_prefix character varying(30) DEFAULT 'INV'::character varying,
    invoice_footer text,
    branch_mode boolean DEFAULT false NOT NULL,
    pos_mode boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: company_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_profiles_id_seq OWNED BY public.company_profiles.id;


--
-- Name: coupon_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_campaigns (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) NOT NULL,
    code_prefix character varying(40) NOT NULL,
    discount_type character varying(20) NOT NULL,
    discount_value numeric(12,2) DEFAULT 0 NOT NULL,
    minimum_order_amount numeric(12,2) DEFAULT 0 NOT NULL,
    max_discount_amount numeric(12,2),
    usage_limit_per_coupon integer DEFAULT 1 NOT NULL,
    total_coupons integer DEFAULT 0 NOT NULL,
    starts_at timestamp without time zone,
    expires_at timestamp without time zone,
    channel character varying(20) DEFAULT 'all'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT coupon_campaigns_channel_check CHECK (((channel)::text = ANY ((ARRAY['offline'::character varying, 'website'::character varying, 'pos'::character varying, 'all'::character varying])::text[]))),
    CONSTRAINT coupon_campaigns_discount_type_check CHECK (((discount_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed'::character varying])::text[])))
);


--
-- Name: coupon_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupon_campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coupon_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupon_campaigns_id_seq OWNED BY public.coupon_campaigns.id;


--
-- Name: coupon_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_redemptions (
    id bigint NOT NULL,
    tenant_id bigint,
    coupon_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    order_id bigint,
    customer_id bigint,
    source character varying(20) NOT NULL,
    order_total numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    final_total numeric(12,2) DEFAULT 0 NOT NULL,
    used_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT coupon_redemptions_source_check CHECK (((source)::text = ANY ((ARRAY['pos'::character varying, 'website'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: coupon_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupon_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coupon_redemptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupon_redemptions_id_seq OWNED BY public.coupon_redemptions.id;


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id bigint NOT NULL,
    tenant_id bigint,
    campaign_id bigint NOT NULL,
    code character varying(80) NOT NULL,
    qr_value text NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    usage_limit integer DEFAULT 1 NOT NULL,
    assigned_customer_id bigint,
    used_by_customer_id bigint,
    used_order_id bigint,
    used_at timestamp without time zone,
    expires_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coupons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupons_id_seq OWNED BY public.coupons.id;


--
-- Name: customer_loyalty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_loyalty (
    id bigint NOT NULL,
    tenant_id bigint,
    customer_id bigint NOT NULL,
    tier character varying(50) DEFAULT 'Bronze'::character varying NOT NULL,
    total_points_earned numeric(12,2) DEFAULT 0 NOT NULL,
    total_points_redeemed numeric(12,2) DEFAULT 0 NOT NULL,
    available_points numeric(12,2) DEFAULT 0 NOT NULL,
    lifetime_points numeric(12,2) DEFAULT 0 NOT NULL,
    lifetime_spent numeric(12,2) DEFAULT 0 NOT NULL,
    last_order_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_loyalty_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_loyalty_history (
    id bigint NOT NULL,
    tenant_id bigint,
    customer_id bigint NOT NULL,
    order_id bigint,
    source character varying(50) DEFAULT 'pos'::character varying NOT NULL,
    points_change numeric(12,2) DEFAULT 0 NOT NULL,
    balance_after numeric(12,2) DEFAULT 0 NOT NULL,
    reason text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_loyalty_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_loyalty_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_loyalty_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_loyalty_history_id_seq OWNED BY public.customer_loyalty_history.id;


--
-- Name: customer_loyalty_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_loyalty_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_loyalty_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_loyalty_id_seq OWNED BY public.customer_loyalty.id;


--
-- Name: customer_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_wallets (
    id bigint NOT NULL,
    tenant_id bigint,
    customer_id bigint NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    total_cashback_earned numeric(12,2) DEFAULT 0 NOT NULL,
    total_redeemed numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_wallets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_wallets_id_seq OWNED BY public.customer_wallets.id;


--
-- Name: customer_wishlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_wishlist (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    customer_id bigint,
    phone character varying(80),
    product_id bigint NOT NULL,
    notify_price_drop boolean DEFAULT true NOT NULL,
    notify_back_in_stock boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_wishlist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_wishlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_wishlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_wishlist_id_seq OWNED BY public.customer_wishlist.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    phone character varying(50),
    email character varying(255),
    address text,
    balance numeric(10,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_trusted boolean DEFAULT false,
    cod_enabled boolean DEFAULT false,
    completed_orders integer DEFAULT 0,
    loyalty_points numeric(12,2) DEFAULT 0 NOT NULL,
    loyalty_tier character varying(50) DEFAULT 'Bronze'::character varying NOT NULL,
    total_spent numeric(12,2) DEFAULT 0 NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    loyalty_updated_at timestamp without time zone,
    wallet_balance numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    ai_customer_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_last_intent text DEFAULT ''::text NOT NULL,
    ai_last_seen_products jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_lead_quality_score integer DEFAULT 0 NOT NULL,
    ai_engagement_score integer DEFAULT 0 NOT NULL,
    ai_intent_score integer DEFAULT 0 NOT NULL,
    ai_last_interaction_at timestamp without time zone,
    registration_source character varying(80) DEFAULT ''::character varying NOT NULL,
    first_visit_at timestamp without time zone,
    last_visit_at timestamp without time zone,
    storefront_last_seen_at timestamp without time zone,
    is_storefront_customer boolean DEFAULT false NOT NULL,
    branch_id bigint,
    customer_source character varying(80),
    lead_source character varying(80),
    marketing_source character varying(80),
    marketing_platform character varying(80),
    attribution_type character varying(80),
    allow_personal_transactions boolean DEFAULT false NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: employee_admin_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_admin_rewards (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    reward_title character varying(160) NOT NULL,
    points_cost integer DEFAULT 0 NOT NULL,
    status character varying(40) DEFAULT 'granted'::character varying NOT NULL,
    admin_note text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_admin_rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_admin_rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_admin_rewards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_admin_rewards_id_seq OWNED BY public.employee_admin_rewards.id;


--
-- Name: employee_advances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_advances (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    deducted_amount numeric(12,2) DEFAULT 0 NOT NULL,
    deduction_month character varying(7) NOT NULL,
    deduction_status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    expense_id bigint,
    payroll_reference character varying(120),
    created_by bigint,
    deducted_by bigint,
    deducted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    remaining_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(40) DEFAULT 'active'::character varying NOT NULL,
    money_account_id bigint,
    employee_portal_request_id bigint
);


--
-- Name: employee_advances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_advances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_advances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_advances_id_seq OWNED BY public.employee_advances.id;


--
-- Name: employee_attendance_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_attendance_devices (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    device_token text NOT NULL,
    user_agent text,
    status character varying(20) DEFAULT 'approved'::character varying NOT NULL,
    first_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    approved_at timestamp without time zone,
    approved_by_user_id bigint,
    rejected_at timestamp without time zone,
    rejected_by_user_id bigint,
    reset_at timestamp without time zone,
    reset_by_user_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    device_fingerprint text,
    ip_address text
);


--
-- Name: employee_attendance_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_attendance_devices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_attendance_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_attendance_devices_id_seq OWNED BY public.employee_attendance_devices.id;


--
-- Name: employee_badge_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_badge_awards (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    badge_code character varying(80) NOT NULL,
    badge_label character varying(160) NOT NULL,
    period character varying(7) NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_badge_awards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_badge_awards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_badge_awards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_badge_awards_id_seq OWNED BY public.employee_badge_awards.id;


--
-- Name: employee_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_chat_messages (
    id bigint NOT NULL,
    thread_id bigint NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_employee_id bigint,
    sender_user_id bigint,
    body text DEFAULT ''::text NOT NULL,
    attachment_url text,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    attachment_type character varying(40),
    attachment_name text,
    attachment_size bigint,
    attachment_mime text,
    reply_to_message_id bigint,
    attachment_duration_seconds double precision,
    CONSTRAINT employee_chat_messages_sender_type_check CHECK (((sender_type)::text = ANY ((ARRAY['employee'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: employee_chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_chat_messages_id_seq OWNED BY public.employee_chat_messages.id;


--
-- Name: employee_chat_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_chat_threads (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    branch_id bigint,
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    last_message_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_chat_threads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_chat_threads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_chat_threads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_chat_threads_id_seq OWNED BY public.employee_chat_threads.id;


--
-- Name: employee_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_commissions (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    order_id bigint NOT NULL,
    order_item_id bigint,
    product_id bigint,
    category_id bigint,
    commission_rule_id bigint,
    rule_type character varying(50) DEFAULT 'percentage'::character varying NOT NULL,
    scope_type character varying(50) DEFAULT 'global'::character varying NOT NULL,
    sale_amount numeric(12,2) DEFAULT 0 NOT NULL,
    commission_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'earned'::character varying NOT NULL,
    branch_id bigint,
    shift_id bigint,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source character varying(50) DEFAULT 'legacy'::character varying NOT NULL,
    returned_quantity integer DEFAULT 0 NOT NULL,
    net_sale_amount numeric(12,2) DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: employee_commissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_commissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_commissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_commissions_id_seq OWNED BY public.employee_commissions.id;


--
-- Name: employee_display_refill_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_display_refill_alerts (
    id bigint NOT NULL,
    employee_id bigint,
    order_id bigint,
    invoice_number character varying(160),
    product_id bigint,
    variant_id bigint,
    product_name text DEFAULT ''::text NOT NULL,
    color_name character varying(160) DEFAULT ''::character varying NOT NULL,
    sold_size character varying(80) DEFAULT ''::character varying NOT NULL,
    replacement_size character varying(80),
    remaining_stock integer DEFAULT 0 NOT NULL,
    image_url text,
    status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp without time zone,
    resolved_by_employee_id bigint,
    branch_id bigint,
    tenant_id bigint,
    updated_at timestamp without time zone,
    CONSTRAINT employee_display_refill_alerts_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'resolved'::character varying])::text[])))
);


--
-- Name: employee_display_refill_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_display_refill_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_display_refill_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_display_refill_alerts_id_seq OWNED BY public.employee_display_refill_alerts.id;


--
-- Name: employee_gamification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_gamification_settings (
    tenant_id bigint NOT NULL,
    attendance_weight numeric(5,2) DEFAULT 30 NOT NULL,
    sales_weight numeric(5,2) DEFAULT 30 NOT NULL,
    punctuality_weight numeric(5,2) DEFAULT 20 NOT NULL,
    customer_service_weight numeric(5,2) DEFAULT 10 NOT NULL,
    penalties_weight numeric(5,2) DEFAULT 10 NOT NULL,
    monthly_sales_target numeric(12,2) DEFAULT 0 NOT NULL,
    attendance_target_days integer DEFAULT 26 NOT NULL,
    branch_kpi_target numeric(12,2) DEFAULT 0 NOT NULL,
    points_per_attendance_day integer DEFAULT 5 CONSTRAINT employee_gamification_settin_points_per_attendance_day_not_null NOT NULL,
    points_per_1000_sales integer DEFAULT 2 NOT NULL,
    points_per_badge integer DEFAULT 50 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_goals (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    period character varying(7) NOT NULL,
    monthly_sales_target numeric(12,2) DEFAULT 0 NOT NULL,
    attendance_target_days integer DEFAULT 26 NOT NULL,
    branch_kpi_target numeric(12,2) DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_goals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_goals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_goals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_goals_id_seq OWNED BY public.employee_goals.id;


--
-- Name: employee_leaves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leaves (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    leave_type character varying(50) DEFAULT 'paid'::character varying NOT NULL,
    leave_date date,
    start_date date,
    end_date date,
    notes text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_leaves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_leaves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_leaves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_leaves_id_seq OWNED BY public.employee_leaves.id;


--
-- Name: employee_payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_payroll_runs (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    payroll_period character varying(7) NOT NULL,
    payroll_reference character varying(120) NOT NULL,
    base_salary numeric(12,2) DEFAULT 0 NOT NULL,
    commissions numeric(12,2) DEFAULT 0 NOT NULL,
    bonuses numeric(12,2) DEFAULT 0 NOT NULL,
    manual_deductions numeric(12,2) DEFAULT 0 NOT NULL,
    advance_deductions numeric(12,2) DEFAULT 0 NOT NULL,
    penalties_total numeric(12,2) DEFAULT 0 NOT NULL,
    attendance_deduction_total numeric(12,2) DEFAULT 0 NOT NULL,
    total_deductions numeric(12,2) DEFAULT 0 NOT NULL,
    net_pay numeric(12,2) DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    finalized_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_payroll_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_payroll_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_payroll_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_payroll_runs_id_seq OWNED BY public.employee_payroll_runs.id;


--
-- Name: employee_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_penalties (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    penalty_date date DEFAULT CURRENT_DATE NOT NULL,
    payroll_period_start date,
    payroll_period_end date,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    reason text NOT NULL,
    notes text,
    deduct_from_payroll boolean DEFAULT true NOT NULL,
    status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_penalties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_penalties_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_penalties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_penalties_id_seq OWNED BY public.employee_penalties.id;


--
-- Name: employee_portal_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_portal_audit_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint,
    action character varying(80) NOT NULL,
    status character varying(40) DEFAULT 'success'::character varying NOT NULL,
    ip_address text,
    user_agent text,
    device_id text,
    latitude numeric,
    longitude numeric,
    gps_accuracy_meters numeric,
    gps_distance_meters numeric,
    gps_verification_result character varying(40),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_portal_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_portal_audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_portal_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_portal_audit_logs_id_seq OWNED BY public.employee_portal_audit_logs.id;


--
-- Name: employee_portal_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_portal_notifications (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    type character varying(120) NOT NULL,
    order_id bigint,
    invoice_number character varying(160),
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    action_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_portal_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_portal_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_portal_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_portal_notifications_id_seq OWNED BY public.employee_portal_notifications.id;


--
-- Name: employee_portal_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_portal_push_subscriptions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    session_id bigint,
    endpoint text NOT NULL,
    p256dh text DEFAULT ''::text NOT NULL,
    auth text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    portal_url text DEFAULT ''::text NOT NULL
);


--
-- Name: employee_portal_push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_portal_push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_portal_push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_portal_push_subscriptions_id_seq OWNED BY public.employee_portal_push_subscriptions.id;


--
-- Name: employee_portal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_portal_requests (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    request_type character varying(40) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    request_date date,
    end_date date,
    message text,
    status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    admin_note text,
    reviewed_by bigint,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_portal_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_portal_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_portal_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_portal_requests_id_seq OWNED BY public.employee_portal_requests.id;


--
-- Name: employee_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_portal_sessions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    branch_id bigint,
    attendance_log_id bigint,
    token_hash text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp without time zone
);


--
-- Name: employee_portal_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_portal_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_portal_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_portal_sessions_id_seq OWNED BY public.employee_portal_sessions.id;


--
-- Name: employee_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_push_subscriptions (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    endpoint text NOT NULL,
    p256dh text DEFAULT ''::text NOT NULL,
    auth text DEFAULT ''::text NOT NULL,
    user_agent text,
    portal_url text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_push_subscriptions_id_seq OWNED BY public.employee_push_subscriptions.id;


--
-- Name: employee_reward_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_reward_points (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    source_type character varying(80) NOT NULL,
    source_ref character varying(160),
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_reward_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_reward_points_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_reward_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_reward_points_id_seq OWNED BY public.employee_reward_points.id;


--
-- Name: employee_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_sales (
    id bigint NOT NULL,
    tenant_id bigint,
    order_id bigint NOT NULL,
    cashier_id bigint,
    sales_employee_id bigint,
    shift_id bigint,
    branch_id bigint,
    total_sales numeric(12,2) DEFAULT 0 NOT NULL,
    total_orders integer DEFAULT 1 NOT NULL,
    commission_amount numeric(12,2) DEFAULT 0 NOT NULL,
    refund_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'recorded'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_sales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_sales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_sales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_sales_id_seq OWNED BY public.employee_sales.id;


--
-- Name: employee_sales_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_sales_profiles (
    employee_id bigint NOT NULL,
    tenant_id bigint,
    pos_alias character varying(20),
    is_sales_active boolean DEFAULT true NOT NULL,
    commission_type character varying(20) DEFAULT 'percent'::character varying NOT NULL,
    commission_value numeric(12,2) DEFAULT 0 NOT NULL,
    fixed_commission_mode character varying(30),
    excluded_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluded_category_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    migrated_sales_employee_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_shifts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    shift_name character varying(255) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    allowed_late_minutes integer DEFAULT 0 NOT NULL,
    overtime_after_minutes integer DEFAULT 0 NOT NULL,
    working_days jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    shift_type character varying(50) DEFAULT 'regular'::character varying NOT NULL,
    expected_hours numeric(5,2) DEFAULT 10 NOT NULL,
    check_in_window_start time without time zone,
    check_in_window_end time without time zone
);


--
-- Name: employee_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_shifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_shifts_id_seq OWNED BY public.employee_shifts.id;


--
-- Name: employee_vacations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_vacations (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint NOT NULL,
    vacation_type character varying(50) DEFAULT 'annual'::character varying NOT NULL,
    vacation_date date,
    start_date date,
    end_date date,
    notes text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employee_vacations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_vacations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_vacations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_vacations_id_seq OWNED BY public.employee_vacations.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    employee_code character varying(100) NOT NULL,
    full_name character varying(255) NOT NULL,
    phone character varying(50),
    email character varying(255),
    national_id character varying(120),
    role character varying(120),
    salary numeric(12,2) DEFAULT 0 NOT NULL,
    hire_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    department character varying(120),
    user_id bigint,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_user_id bigint,
    job_title character varying(120),
    "position" character varying(120),
    daily_work_hours numeric(5,2) DEFAULT 8 NOT NULL,
    working_days_per_month integer DEFAULT 26 NOT NULL,
    working_days_per_week integer DEFAULT 6 NOT NULL,
    work_start_time time without time zone,
    work_end_time time without time zone,
    absence_deduction_enabled boolean DEFAULT true NOT NULL,
    missing_hours_deduction_enabled boolean DEFAULT true NOT NULL,
    late_deduction_enabled boolean DEFAULT true NOT NULL,
    early_leave_deduction_enabled boolean DEFAULT true NOT NULL,
    employee_portal_token text,
    photo_url text,
    manager_portal_token text,
    manager_portal_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    manager_portal_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: expense_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_approvals (
    id bigint NOT NULL,
    tenant_id bigint,
    expense_id bigint,
    action character varying(40) NOT NULL,
    actor_id bigint,
    reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: expense_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expense_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expense_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expense_approvals_id_seq OWNED BY public.expense_approvals.id;


--
-- Name: expense_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_attachments (
    id bigint NOT NULL,
    tenant_id bigint,
    expense_id bigint,
    file_name character varying(255) NOT NULL,
    file_url text,
    mime_type character varying(120),
    file_size bigint,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: expense_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expense_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expense_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expense_attachments_id_seq OWNED BY public.expense_attachments.id;


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) NOT NULL,
    type_key character varying(80) DEFAULT 'other'::character varying NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: expense_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expense_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expense_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expense_categories_id_seq OWNED BY public.expense_categories.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    amount numeric(12,2) NOT NULL,
    category character varying(100),
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id bigint,
    expense_type character varying(80) DEFAULT 'other'::character varying NOT NULL,
    category_id bigint,
    branch_id bigint,
    warehouse_id bigint,
    employee_id bigint,
    supplier_id bigint,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    attachment_url text,
    attachment_name character varying(255),
    financial_account_id bigint,
    cashbox_id bigint,
    approved_by bigint,
    approved_at timestamp without time zone,
    rejected_by bigint,
    rejected_at timestamp without time zone,
    rejection_reason text,
    paid_at timestamp without time zone,
    paid_by bigint,
    recurring_expense_id bigint,
    journal_entry_id bigint,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    payment_method character varying(80) DEFAULT 'cash'::character varying,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    source character varying(50) DEFAULT 'expenses'::character varying NOT NULL,
    shift_id bigint,
    created_by bigint,
    money_account_id bigint
);


--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: financial_account_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_account_entries (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    financial_account_id bigint NOT NULL,
    entry_type character varying(50) NOT NULL,
    source_type character varying(100),
    source_id bigint,
    amount numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: financial_account_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_account_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_account_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_account_entries_id_seq OWNED BY public.financial_account_entries.id;


--
-- Name: financial_account_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_account_transfers (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    from_account_id bigint NOT NULL,
    to_account_id bigint NOT NULL,
    amount numeric(12,2) NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: financial_account_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_account_transfers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_account_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_account_transfers_id_seq OWNED BY public.financial_account_transfers.id;


--
-- Name: financial_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_accounts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    account_type character varying(50) NOT NULL,
    currency character varying(10) DEFAULT 'EGP'::character varying NOT NULL,
    branch_id bigint,
    opening_balance numeric(12,2) DEFAULT 0 NOT NULL,
    current_balance numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    allow_negative_balance boolean DEFAULT false NOT NULL
);


--
-- Name: financial_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_accounts_id_seq OWNED BY public.financial_accounts.id;


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    id bigint NOT NULL,
    tenant_id bigint,
    holiday_date date NOT NULL,
    name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: holidays_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holidays_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holidays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holidays_id_seq OWNED BY public.holidays.id;


--
-- Name: income; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.income (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    title character varying(255) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    category character varying(255),
    note text,
    status character varying(50) DEFAULT 'posted'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: income_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.income_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: income_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.income_id_seq OWNED BY public.income.id;


--
-- Name: inventory_count_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_items (
    id bigint NOT NULL,
    inventory_count_id bigint NOT NULL,
    product_id bigint,
    variant_id bigint,
    expected_qty integer DEFAULT 0 NOT NULL,
    actual_qty integer DEFAULT 0 NOT NULL,
    difference_qty integer DEFAULT 0 NOT NULL,
    notes text,
    inventory_count_session_id bigint,
    product_variant_id bigint,
    system_quantity integer DEFAULT 0 NOT NULL,
    counted_quantity integer DEFAULT 0 NOT NULL,
    difference_quantity integer DEFAULT 0 NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_count_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_count_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_count_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_count_items_id_seq OWNED BY public.inventory_count_items.id;


--
-- Name: inventory_count_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_sessions (
    id bigint NOT NULL,
    tenant_id bigint,
    branch_id bigint,
    warehouse_id bigint,
    title character varying(255) DEFAULT 'جرد جديد'::character varying NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    opened_at timestamp without time zone,
    completed_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    created_by bigint,
    opened_by bigint,
    completed_by bigint,
    cancelled_by bigint,
    submitted_by bigint,
    submitted_at timestamp without time zone,
    approved_by bigint,
    approved_at timestamp without time zone,
    rejected_by bigint,
    rejected_at timestamp without time zone,
    rejection_reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inventory_count_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_count_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_count_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_count_sessions_id_seq OWNED BY public.inventory_count_sessions.id;


--
-- Name: inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_counts (
    id bigint NOT NULL,
    tenant_id bigint,
    branch_id bigint,
    warehouse_id bigint,
    section_id bigint,
    count_type character varying(50) DEFAULT 'quick_scan'::character varying NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: inventory_counts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_counts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_counts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_counts_id_seq OWNED BY public.inventory_counts.id;


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id bigint NOT NULL,
    tenant_id bigint,
    product_id bigint,
    variant_id bigint,
    warehouse_id bigint,
    branch_id bigint,
    movement_type character varying(50) NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    quantity_before integer DEFAULT 0 NOT NULL,
    quantity_change integer DEFAULT 0 NOT NULL,
    quantity_after integer DEFAULT 0 NOT NULL,
    unit_cost numeric(12,2),
    total_cost numeric(12,2),
    reference_type character varying(100),
    reference_id bigint,
    notes text,
    note text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason text,
    undone_at timestamp without time zone,
    undone_by bigint,
    section_id bigint,
    before_qty integer DEFAULT 0 NOT NULL,
    after_qty integer DEFAULT 0 NOT NULL,
    customer_id bigint,
    quantity_delta integer DEFAULT 0 NOT NULL
);


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_movements_id_seq OWNED BY public.inventory_movements.id;


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    entry_number character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'posted'::character varying NOT NULL,
    reference_type character varying(100),
    reference_id bigint,
    description text,
    notes text,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_generated boolean DEFAULT false NOT NULL,
    entry_type character varying(100),
    source_key character varying(255),
    branch_id bigint
);


--
-- Name: journal_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.journal_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: journal_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.journal_entries_id_seq OWNED BY public.journal_entries.id;


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_lines (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    journal_entry_id bigint NOT NULL,
    account_id bigint NOT NULL,
    debit numeric(12,2) DEFAULT 0 NOT NULL,
    credit numeric(12,2) DEFAULT 0 NOT NULL,
    branch_id bigint,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: journal_entry_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.journal_entry_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: journal_entry_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.journal_entry_lines_id_seq OWNED BY public.journal_entry_lines.id;


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    journal_entry_id bigint NOT NULL,
    account_name character varying(255) NOT NULL,
    account_code character varying(100),
    debit numeric(12,2) DEFAULT 0 NOT NULL,
    credit numeric(12,2) DEFAULT 0 NOT NULL,
    note text
);


--
-- Name: journal_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.journal_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: journal_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.journal_lines_id_seq OWNED BY public.journal_lines.id;


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    entry_type character varying(50) NOT NULL,
    party_type character varying(50),
    party_id bigint,
    reference_type character varying(100),
    reference_id bigint,
    debit numeric(12,2) DEFAULT 0 NOT NULL,
    credit numeric(12,2) DEFAULT 0 NOT NULL,
    running_balance numeric(12,2) DEFAULT 0 NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledger_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledger_entries_id_seq OWNED BY public.ledger_entries.id;


--
-- Name: loyalty_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_rules (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) DEFAULT 'Default Loyalty Rule'::character varying NOT NULL,
    points_per_currency_amount numeric(12,4) DEFAULT 1 NOT NULL,
    minimum_order_amount numeric(12,2) DEFAULT 0 NOT NULL,
    redeem_value numeric(12,4) DEFAULT 1 NOT NULL,
    bronze_threshold numeric(12,2) DEFAULT 0 NOT NULL,
    silver_threshold numeric(12,2) DEFAULT 0 NOT NULL,
    gold_threshold numeric(12,2) DEFAULT 0 NOT NULL,
    platinum_threshold numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: loyalty_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_rules_id_seq OWNED BY public.loyalty_rules.id;


--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_transactions (
    id bigint NOT NULL,
    tenant_id bigint,
    customer_id bigint NOT NULL,
    order_id bigint,
    transaction_type character varying(50) NOT NULL,
    points numeric(12,2) DEFAULT 0 NOT NULL,
    amount_value numeric(12,2) DEFAULT 0 NOT NULL,
    description text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_transactions_id_seq OWNED BY public.loyalty_transactions.id;


--
-- Name: manufacturers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manufacturers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    contact_person character varying(255),
    phone character varying(50),
    email character varying(255),
    address text,
    country character varying(100),
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: manufacturers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.manufacturers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: manufacturers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.manufacturers_id_seq OWNED BY public.manufacturers.id;


--
-- Name: marketing_attribution_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_attribution_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    event_type character varying(50) NOT NULL,
    session_id text,
    source text,
    platform text,
    post_id bigint,
    campaign text,
    product_id bigint,
    order_id bigint,
    tracking_code text,
    tracking_link text,
    attribution_type text,
    referrer text,
    user_agent text,
    ip_address text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_attribution_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_attribution_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_attribution_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_attribution_events_id_seq OWNED BY public.marketing_attribution_events.id;


--
-- Name: marketing_auto_reply_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_auto_reply_rules (
    id bigint NOT NULL,
    business_id bigint NOT NULL,
    branch_id bigint,
    platform character varying(30) DEFAULT 'facebook'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    name character varying(255) NOT NULL,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    match_mode character varying(30) DEFAULT 'any'::character varying NOT NULL,
    public_reply_template text DEFAULT ''::text NOT NULL,
    private_reply_template text DEFAULT ''::text NOT NULL,
    like_comment boolean DEFAULT true NOT NULL,
    reply_publicly boolean DEFAULT true NOT NULL,
    send_private_reply boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_auto_reply_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_auto_reply_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_auto_reply_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_auto_reply_rules_id_seq OWNED BY public.marketing_auto_reply_rules.id;


--
-- Name: marketing_automation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_automation_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    event_type character varying(80) NOT NULL,
    status character varying(30) DEFAULT 'info'::character varying NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    draft_id bigint,
    product_id bigint,
    platform character varying(30),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_automation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_automation_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_automation_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_automation_logs_id_seq OWNED BY public.marketing_automation_logs.id;


--
-- Name: marketing_automation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_automation_settings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    weekly_generation_day integer DEFAULT 1 NOT NULL,
    weekly_generation_time character varying(5) DEFAULT '09:00'::character varying NOT NULL,
    default_platforms jsonb DEFAULT '["facebook", "instagram"]'::jsonb NOT NULL,
    default_intensity character varying(20) DEFAULT 'balanced'::character varying NOT NULL,
    default_approval_mode character varying(30) DEFAULT 'pending_approval'::character varying NOT NULL,
    auto_generate_next_week boolean DEFAULT true NOT NULL,
    auto_publish_enabled boolean DEFAULT false NOT NULL,
    auto_publish_requires_approval boolean DEFAULT true CONSTRAINT marketing_automation_settin_auto_publish_requires_appr_not_null NOT NULL,
    auto_publish_platforms jsonb DEFAULT '["facebook", "instagram"]'::jsonb NOT NULL,
    auto_publish_window_start time without time zone DEFAULT '10:00:00'::time without time zone CONSTRAINT marketing_automation_setting_auto_publish_window_start_not_null NOT NULL,
    auto_publish_window_end time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
    max_auto_posts_per_day integer DEFAULT 2 NOT NULL,
    auto_publish_failed_count integer DEFAULT 0 CONSTRAINT marketing_automation_setting_auto_publish_failed_count_not_null NOT NULL,
    last_auto_publish_at timestamp without time zone,
    last_generated_at timestamp without time zone,
    next_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_automation_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_automation_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_automation_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_automation_settings_id_seq OWNED BY public.marketing_automation_settings.id;


--
-- Name: marketing_brand_identity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_brand_identity (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    brand_name text DEFAULT ''::text NOT NULL,
    brand_tone text DEFAULT ''::text NOT NULL,
    audience text DEFAULT ''::text NOT NULL,
    language text DEFAULT ''::text NOT NULL,
    dialect text DEFAULT ''::text NOT NULL,
    primary_colors jsonb DEFAULT '[]'::jsonb NOT NULL,
    forbidden_words jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_cta text DEFAULT ''::text NOT NULL,
    hashtag_style text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_brand_identity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_brand_identity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_brand_identity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_brand_identity_id_seq OWNED BY public.marketing_brand_identity.id;


--
-- Name: marketing_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_campaigns (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    start_date date,
    end_date date,
    budget numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_campaigns_id_seq OWNED BY public.marketing_campaigns.id;


--
-- Name: marketing_comment_dm_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_comment_dm_logs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    rule_id bigint,
    post_id bigint,
    platform character varying(30) DEFAULT 'facebook'::character varying NOT NULL,
    platform_post_id text,
    platform_comment_id text NOT NULL,
    commenter_id text,
    commenter_name text,
    comment_text text DEFAULT ''::text NOT NULL,
    response_message text DEFAULT ''::text NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    meta_response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_comment_dm_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_comment_dm_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_comment_dm_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_comment_dm_logs_id_seq OWNED BY public.marketing_comment_dm_logs.id;


--
-- Name: marketing_comment_dm_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_comment_dm_rules (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    platform character varying(30) DEFAULT 'facebook'::character varying NOT NULL,
    post_id bigint,
    platform_post_id text,
    trigger_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluded_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    match_mode character varying(30) DEFAULT 'any'::character varying NOT NULL,
    response_message text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_checked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_comment_dm_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_comment_dm_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_comment_dm_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_comment_dm_rules_id_seq OWNED BY public.marketing_comment_dm_rules.id;


--
-- Name: marketing_comment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_comment_events (
    id bigint NOT NULL,
    business_id bigint NOT NULL,
    platform character varying(30) NOT NULL,
    post_id text DEFAULT ''::text NOT NULL,
    comment_id text NOT NULL,
    parent_comment_id text,
    user_platform_id text,
    username text,
    message text DEFAULT ''::text NOT NULL,
    matched_rule_id bigint,
    product_id bigint,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp without time zone,
    matched_keyword text,
    lead_score character varying(20) DEFAULT 'low'::character varying NOT NULL,
    automation_actions jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: marketing_comment_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_comment_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_comment_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_comment_events_id_seq OWNED BY public.marketing_comment_events.id;


--
-- Name: marketing_content_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_content_drafts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    product_id bigint,
    content_type character varying(50) DEFAULT 'Feed Post'::character varying NOT NULL,
    tone character varying(50) DEFAULT 'Luxury'::character varying NOT NULL,
    platforms jsonb DEFAULT '["facebook", "instagram"]'::jsonb NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    hook text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    hashtags text DEFAULT ''::text NOT NULL,
    media_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp without time zone,
    published_at timestamp without time zone,
    rejected_at timestamp without time zone,
    error_message text,
    created_by bigint,
    approved_by bigint,
    rejected_by bigint,
    ai_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_content_drafts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_content_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_content_drafts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_content_drafts_id_seq OWNED BY public.marketing_content_drafts.id;


--
-- Name: marketing_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_conversations (
    id bigint NOT NULL,
    business_id bigint NOT NULL,
    platform character varying(30) NOT NULL,
    user_platform_id text NOT NULL,
    username text,
    product_id bigint,
    post_id text,
    comment_id text,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    last_message text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_customer_message text DEFAULT ''::text NOT NULL,
    matched_keyword text,
    lead_score character varying(20) DEFAULT 'low'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: marketing_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_conversations_id_seq OWNED BY public.marketing_conversations.id;


--
-- Name: marketing_post_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_post_analytics (
    id bigint NOT NULL,
    post_id bigint NOT NULL,
    platform character varying(30) NOT NULL,
    platform_post_id text NOT NULL,
    likes integer,
    comments integer,
    shares integer,
    reach integer,
    impressions integer,
    saves integer,
    clicks integer,
    synced_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_post_analytics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_post_analytics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_post_analytics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_post_analytics_id_seq OWNED BY public.marketing_post_analytics.id;


--
-- Name: marketing_post_product_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_post_product_links (
    id bigint NOT NULL,
    business_id bigint NOT NULL,
    platform character varying(30) NOT NULL,
    post_id text NOT NULL,
    media_id text,
    product_id bigint NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_post_product_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_post_product_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_post_product_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_post_product_links_id_seq OWNED BY public.marketing_post_product_links.id;


--
-- Name: marketing_post_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_post_templates (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    channel character varying(30) DEFAULT 'facebook'::character varying NOT NULL,
    title_template text DEFAULT ''::text NOT NULL,
    caption_template text DEFAULT ''::text NOT NULL,
    hashtags text DEFAULT ''::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_post_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_post_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_post_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_post_templates_id_seq OWNED BY public.marketing_post_templates.id;


--
-- Name: marketing_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_posts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    product_id bigint,
    campaign_id bigint,
    template_id bigint,
    title text DEFAULT ''::text NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    hashtags text DEFAULT ''::text NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    channel character varying(30) DEFAULT 'facebook'::character varying NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp without time zone,
    published_at timestamp without time zone,
    external_post_id character varying(255),
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    media_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    platform_post_id text,
    platform_publish_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    story_status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    story_type character varying(30) DEFAULT 'story'::character varying NOT NULL,
    story_scheduled_at timestamp without time zone,
    story_published_at timestamp without time zone,
    story_publish_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    story_error_message text,
    tracking_code text,
    tracking_link text,
    tracking_source text,
    tracking_kind character varying(30) DEFAULT 'post'::character varying NOT NULL
);


--
-- Name: marketing_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_posts_id_seq OWNED BY public.marketing_posts.id;


--
-- Name: marketing_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_settings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    provider character varying(50) DEFAULT 'meta'::character varying NOT NULL,
    page_id text,
    instagram_account_id text,
    access_token_encrypted text,
    is_connected boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    long_lived_user_token text,
    page_access_token text,
    token_expires_at timestamp without time zone,
    token_status character varying(30) DEFAULT 'missing'::character varying NOT NULL,
    token_last_validated_at timestamp without time zone,
    token_error_message text,
    last_auto_refresh_at timestamp without time zone,
    next_refresh_check_at timestamp without time zone
);


--
-- Name: marketing_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_settings_id_seq OWNED BY public.marketing_settings.id;


--
-- Name: marketing_story_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_story_campaigns (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    campaign_type character varying(50) DEFAULT 'new_arrival'::character varying NOT NULL,
    product_id bigint,
    title text DEFAULT ''::text NOT NULL,
    tone character varying(50) DEFAULT 'Luxury'::character varying NOT NULL,
    platform character varying(30) DEFAULT 'instagram'::character varying NOT NULL,
    visual_style character varying(50) DEFAULT 'Luxury'::character varying NOT NULL,
    cta_goal character varying(50) DEFAULT 'Website'::character varying NOT NULL,
    story_count integer DEFAULT 4 NOT NULL,
    stories_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    generated_by bigint,
    scheduled_at timestamp without time zone,
    published_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_story_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_story_campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_story_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_story_campaigns_id_seq OWNED BY public.marketing_story_campaigns.id;


--
-- Name: marketing_story_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_story_exports (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    story_campaign_id bigint NOT NULL,
    template_id character varying(80) DEFAULT ''::character varying NOT NULL,
    export_type character varying(30) DEFAULT 'png'::character varying NOT NULL,
    file_count integer DEFAULT 0 NOT NULL,
    filenames_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'completed'::character varying NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_story_exports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_story_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_story_exports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_story_exports_id_seq OWNED BY public.marketing_story_exports.id;


--
-- Name: marketing_story_trigger_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_story_trigger_suggestions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    trigger_type character varying(60) NOT NULL,
    product_id bigint,
    variant_id bigint,
    title text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    signal_score integer DEFAULT 0 NOT NULL,
    signal_snapshot_json jsonb DEFAULT '{}'::jsonb CONSTRAINT marketing_story_trigger_suggestio_signal_snapshot_json_not_null NOT NULL,
    suggested_campaign_type character varying(60) DEFAULT 'new_arrival'::character varying CONSTRAINT marketing_story_trigger_sugges_suggested_campaign_type_not_null NOT NULL,
    suggested_story_count integer DEFAULT 4 CONSTRAINT marketing_story_trigger_suggesti_suggested_story_count_not_null NOT NULL,
    suggested_visual_style character varying(60) DEFAULT 'Luxury'::character varying CONSTRAINT marketing_story_trigger_suggest_suggested_visual_style_not_null NOT NULL,
    suggested_cta_goal character varying(60) DEFAULT 'Website'::character varying NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    generated_campaign_id bigint,
    dismissed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: marketing_story_trigger_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_story_trigger_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_story_trigger_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_story_trigger_suggestions_id_seq OWNED BY public.marketing_story_trigger_suggestions.id;


--
-- Name: master_qr_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_qr_models (
    id bigint NOT NULL,
    tenant_id bigint,
    product_id bigint NOT NULL,
    qr_value text NOT NULL,
    generated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: master_qr_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.master_qr_models_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: master_qr_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.master_qr_models_id_seq OWNED BY public.master_qr_models.id;


--
-- Name: meta_integration_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_integration_configs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    facebook_page_id text DEFAULT ''::text NOT NULL,
    page_name text DEFAULT ''::text NOT NULL,
    page_access_token_encrypted text DEFAULT ''::text NOT NULL,
    instagram_business_account_id text DEFAULT ''::text NOT NULL,
    app_id text DEFAULT ''::text NOT NULL,
    app_secret_encrypted text DEFAULT ''::text NOT NULL,
    verify_token text DEFAULT ''::text NOT NULL,
    webhook_enabled boolean DEFAULT false NOT NULL,
    messenger_enabled boolean DEFAULT false NOT NULL,
    instagram_enabled boolean DEFAULT false NOT NULL,
    last_sync_at timestamp without time zone,
    status text DEFAULT 'not_connected'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    facebook_page_name text DEFAULT ''::text NOT NULL,
    instagram_username text DEFAULT ''::text NOT NULL,
    instagram_dm_enabled boolean DEFAULT false NOT NULL,
    facebook_publishing_enabled boolean DEFAULT false NOT NULL,
    instagram_publishing_enabled boolean DEFAULT false NOT NULL,
    capability_status jsonb DEFAULT '{}'::jsonb NOT NULL,
    token_expires_at timestamp without time zone,
    webhook_verified boolean DEFAULT false NOT NULL,
    subscribed_apps_verified boolean DEFAULT false NOT NULL,
    permissions_saved boolean DEFAULT false NOT NULL
);


--
-- Name: meta_integration_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meta_integration_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meta_integration_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meta_integration_configs_id_seq OWNED BY public.meta_integration_configs.id;


--
-- Name: meta_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_oauth_states (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint,
    state_token text NOT NULL,
    long_lived_user_token_encrypted text DEFAULT ''::text NOT NULL,
    pending_pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    selected_page_id text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'started'::text NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: meta_oauth_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meta_oauth_states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meta_oauth_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meta_oauth_states_id_seq OWNED BY public.meta_oauth_states.id;


--
-- Name: money_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.money_accounts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    financial_account_id bigint,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    provider character varying(120),
    branch_id bigint,
    opening_balance numeric(12,2) DEFAULT 0 NOT NULL,
    current_balance numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(10) DEFAULT 'EGP'::character varying NOT NULL,
    allow_negative_balance boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: money_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.money_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: money_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.money_accounts_id_seq OWNED BY public.money_accounts.id;


--
-- Name: money_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.money_transactions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    account_id bigint NOT NULL,
    direction character varying(10) NOT NULL,
    amount numeric(12,2) NOT NULL,
    transaction_type character varying(80) NOT NULL,
    reference_type character varying(80),
    reference_id bigint,
    payment_method character varying(50),
    notes text,
    created_by bigint,
    branch_id bigint,
    balance_after numeric(12,2) DEFAULT 0 NOT NULL,
    reversal_of bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT money_transactions_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT money_transactions_direction_check CHECK (((direction)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
);


--
-- Name: money_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.money_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: money_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.money_transactions_id_seq OWNED BY public.money_transactions.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    tenant_id bigint,
    user_id bigint,
    role_key character varying(120),
    branch_id bigint,
    type character varying(120) NOT NULL,
    category character varying(80) DEFAULT 'system'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    title text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    action_url text,
    action_label character varying(160),
    entity_type character varying(120),
    entity_id character varying(160),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT notifications_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: order_edit_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_edit_audits (
    id bigint NOT NULL,
    tenant_id bigint,
    order_id bigint NOT NULL,
    old_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    new_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    old_total numeric(12,2) DEFAULT 0 NOT NULL,
    new_total numeric(12,2) DEFAULT 0 NOT NULL,
    user_id bigint,
    reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: order_edit_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_edit_audits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_edit_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_edit_audits_id_seq OWNED BY public.order_edit_audits.id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id integer NOT NULL,
    order_id integer,
    variant_id integer,
    quantity integer NOT NULL,
    price numeric(10,2) DEFAULT 0,
    tenant_id bigint,
    product_id bigint,
    product_name character varying(255) DEFAULT ''::character varying NOT NULL,
    variant_name character varying(255),
    sku character varying(120),
    barcode character varying(120),
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    returned_quantity integer DEFAULT 0 NOT NULL,
    product_image text,
    size character varying(100),
    color character varying(100),
    sales_employee_id bigint,
    image_url text,
    variant_image text,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    line_total numeric(12,2) DEFAULT 0 NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    price_source character varying(50) DEFAULT 'stored'::character varying NOT NULL
);


--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_items_id_seq OWNED BY public.order_items.id;


--
-- Name: order_reprint_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_reprint_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    order_id bigint NOT NULL,
    user_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: order_reprint_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_reprint_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_reprint_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_reprint_logs_id_seq OWNED BY public.order_reprint_logs.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_name character varying(255),
    total_price numeric(10,2) DEFAULT 0,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    attendance_log_id bigint,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    cash_amount numeric(12,2) DEFAULT 0 NOT NULL,
    card_amount numeric(12,2) DEFAULT 0 NOT NULL,
    wallet_payment_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tenant_id bigint,
    invoice_number character varying(100),
    customer_id bigint,
    channel character varying(50) DEFAULT 'pos'::character varying NOT NULL,
    branch_id bigint,
    cashier_id bigint,
    sales_employee_id bigint,
    shift_id bigint,
    payment_status character varying(50) DEFAULT 'unpaid'::character varying NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    service_fee numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    change_amount numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by bigint,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    public_token text DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text),
    invoice_public_enabled boolean DEFAULT true NOT NULL,
    marketing_source text,
    marketing_platform text,
    marketing_post_id bigint,
    marketing_campaign text,
    attribution_type text,
    marketing_tracking_code text,
    marketing_session_id text,
    customer_phone character varying(80),
    cancelled_at timestamp without time zone,
    cancelled_by bigint,
    returned_at timestamp without time zone,
    source character varying(50) DEFAULT 'pos'::character varying NOT NULL,
    customer_type character varying(50) DEFAULT 'walk_in'::character varying NOT NULL,
    customer_address text,
    governorate character varying(120),
    city_area character varying(160),
    landmark text,
    delivery_notes text,
    order_notes text,
    delivery_fee numeric(12,2) DEFAULT 0 NOT NULL,
    cod_amount numeric(12,2) DEFAULT 0 NOT NULL,
    shipping_provider character varying(80) DEFAULT 'manual'::character varying NOT NULL,
    shipping_status character varying(80) DEFAULT 'pending'::character varying NOT NULL,
    shipment_id character varying(160),
    tracking_number character varying(160),
    tracking_url text,
    courier_notes text,
    last_shipping_sync_at timestamp without time zone,
    expected_delivery_at timestamp without time zone,
    coupon_id bigint,
    coupon_code character varying(80),
    coupon_discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    shipping_fee numeric DEFAULT 0,
    shipping_payment_screenshot text,
    shipping_payment_reference text,
    shipping_payment_verified_at timestamp without time zone,
    shipping_payment_verified_by integer,
    customer_trust_counted_at timestamp without time zone,
    shipping_payment_method character varying(50),
    salesperson_id bigint,
    salesperson_name character varying(255),
    salesperson_commission_type character varying(20),
    salesperson_commission_value numeric(12,2) DEFAULT 0 NOT NULL,
    salesperson_fixed_mode character varying(30),
    salesperson_excluded_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    warehouse_id bigint,
    transfer_proof_status character varying(50),
    ai_agent_session_id text,
    ai_agent_conversation_id text,
    ai_agent_intent_hash text,
    ai_agent_status character varying(50),
    ai_agent_confidence numeric(5,4),
    ai_agent_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    public_order_number character varying(40),
    display_order_number character varying(40),
    deleted_at timestamp without time zone,
    deleted_by bigint,
    delete_reason text,
    cancel_reason text,
    stock_restored_at timestamp without time zone,
    stock_reverted_at timestamp without time zone,
    inventory_rollback_done boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    salesperson_excluded_category_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    seller_user_id bigint,
    cashier_user_id bigint,
    seller_name character varying(255),
    cashier_name character varying(255),
    payment_breakdown jsonb DEFAULT '[]'::jsonb NOT NULL,
    exchange_mode boolean DEFAULT false NOT NULL,
    original_order_id bigint,
    exchange_credit_amount numeric(12,2) DEFAULT 0 NOT NULL,
    new_order_total numeric(12,2) DEFAULT 0 NOT NULL,
    amount_due_now numeric(12,2) DEFAULT 0 NOT NULL,
    exchange_difference numeric(12,2) DEFAULT 0 NOT NULL,
    exchange_invoice_number character varying(100),
    edit_original_paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    edit_additional_paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    edit_refund_or_credit_due numeric(12,2) DEFAULT 0 NOT NULL,
    edit_payment_difference jsonb DEFAULT '{}'::jsonb NOT NULL,
    shipping_provider_id character varying(80) DEFAULT 'in_store_delivery'::character varying NOT NULL,
    shipping_zone_id character varying(160),
    shipping_cost numeric(12,2) DEFAULT 0 NOT NULL,
    shipment_status character varying(80),
    shipment_timeline jsonb DEFAULT '[]'::jsonb NOT NULL,
    governorate_id character varying(160),
    city_id character varying(160),
    area_id character varying(160),
    district_id character varying(160),
    zone_id character varying(160),
    shipping_city_id character varying(160),
    shipping_district_id character varying(160),
    shipping_address_line text,
    shipping_tracking_number character varying(160),
    shipping_provider_delivery_id character varying(160),
    shipping_label_url text,
    shipping_last_synced_at timestamp without time zone,
    shipping_raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    street_address text,
    building_number character varying(80),
    floor_number character varying(80),
    apartment_number character varying(80),
    invoice_discount_type character varying(20),
    invoice_discount_value numeric(12,2) DEFAULT 0 NOT NULL,
    invoice_discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    invoice_discount_reason text,
    whatsapp_confirmation_sent_at timestamp without time zone,
    whatsapp_confirmed_at timestamp without time zone,
    whatsapp_cancelled_at timestamp without time zone,
    whatsapp_payment_review_sent_at timestamp without time zone,
    whatsapp_invoice_sent_at timestamp without time zone,
    whatsapp_shipment_created_sent_at timestamp without time zone,
    whatsapp_shipped_sent_at timestamp without time zone,
    whatsapp_out_for_delivery_sent_at timestamp without time zone,
    whatsapp_delivered_sent_at timestamp without time zone,
    is_personal_transaction boolean DEFAULT false NOT NULL,
    personal_settlement_type character varying(40),
    personal_note text
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: payment_method_account_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_method_account_mappings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    payment_method character varying(50) NOT NULL,
    financial_account_id bigint NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: payment_method_account_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_method_account_mappings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_method_account_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_method_account_mappings_id_seq OWNED BY public.payment_method_account_mappings.id;


--
-- Name: payment_transaction_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transaction_events (
    id bigint NOT NULL,
    transaction_id bigint,
    provider character varying(50) DEFAULT 'paymob'::character varying NOT NULL,
    provider_event_id text,
    event_type character varying(80) DEFAULT 'payment_status'::character varying NOT NULL,
    status character varying(50),
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: payment_transaction_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_transaction_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_transaction_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_transaction_events_id_seq OWNED BY public.payment_transaction_events.id;


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    order_id bigint,
    provider character varying(50) DEFAULT 'paymob'::character varying NOT NULL,
    provider_order_id text,
    terminal_id text,
    amount_cents bigint DEFAULT 0 NOT NULL,
    currency character varying(10) DEFAULT 'EGP'::character varying NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    response_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    transaction_reference text,
    confirmed_amount_cents bigint DEFAULT 0 NOT NULL,
    confirmed_at timestamp without time zone,
    confirmation_source text,
    confirmed_by bigint
);


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_transactions_id_seq OWNED BY public.payment_transactions.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id integer NOT NULL,
    module character varying(100) NOT NULL,
    action character varying(50) NOT NULL,
    description text
);


--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: portal_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_push_subscriptions (
    id bigint NOT NULL,
    portal_type character varying(40) NOT NULL,
    portal_token text DEFAULT ''::text NOT NULL,
    manager_employee_id bigint,
    user_id bigint,
    tenant_id bigint,
    branch_id bigint,
    endpoint text NOT NULL,
    p256dh text DEFAULT ''::text NOT NULL,
    auth text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    portal_url text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at timestamp without time zone
);


--
-- Name: portal_push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_push_subscriptions_id_seq OWNED BY public.portal_push_subscriptions.id;


--
-- Name: pos_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pos_orders AS
 SELECT id,
    tenant_id,
    invoice_number,
    customer_id,
    customer_name,
    channel,
    cashier_id,
    sales_employee_id,
    seller_user_id,
    cashier_user_id,
    seller_name,
    cashier_name,
    shift_id,
    branch_id,
    status,
    payment_status,
    subtotal,
    discount_amount,
    tax_amount,
    service_fee,
    total_amount,
    total_price,
    paid_amount,
    change_amount,
    notes,
    created_by,
    created_at,
    updated_at
   FROM public.orders;


--
-- Name: product_audiences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_audiences (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    audience character varying(30) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT product_audiences_audience_check CHECK (((audience)::text = ANY ((ARRAY['men'::character varying, 'women'::character varying, 'kids'::character varying])::text[])))
);


--
-- Name: product_audiences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_audiences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_audiences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_audiences_id_seq OWNED BY public.product_audiences.id;


--
-- Name: product_classification_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_classification_groups (
    id bigint NOT NULL,
    key character varying(80) NOT NULL,
    name_ar character varying(255) DEFAULT ''::character varying NOT NULL,
    name_en character varying(255) DEFAULT ''::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp without time zone
);


--
-- Name: product_classification_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_classification_groups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_classification_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_classification_groups_id_seq OWNED BY public.product_classification_groups.id;


--
-- Name: product_classification_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_classification_options (
    id bigint NOT NULL,
    group_id bigint NOT NULL,
    value character varying(120) NOT NULL,
    label_ar character varying(255) DEFAULT ''::character varying NOT NULL,
    label_en character varying(255) DEFAULT ''::character varying NOT NULL,
    icon character varying(80) DEFAULT ''::character varying,
    color character varying(80) DEFAULT ''::character varying,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp without time zone
);


--
-- Name: product_classification_options_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_classification_options_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_classification_options_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_classification_options_id_seq OWNED BY public.product_classification_options.id;


--
-- Name: product_variant_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variant_images (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    variant_id bigint,
    color_name character varying(255) DEFAULT ''::character varying NOT NULL,
    color_value character varying(255) DEFAULT ''::character varying NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id bigint
);


--
-- Name: product_variant_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_variant_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_variant_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_variant_images_id_seq OWNED BY public.product_variant_images.id;


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id integer NOT NULL,
    product_id integer,
    color character varying(50),
    size character varying(20),
    stock integer DEFAULT 0,
    sku character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    image_url text,
    price numeric(10,2) DEFAULT 0,
    manufacturer_id bigint,
    barcode character varying(120) DEFAULT ''::character varying,
    cost_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    low_stock_alert integer DEFAULT 0 NOT NULL,
    tenant_id bigint,
    image text DEFAULT ''::text,
    photo_url text DEFAULT ''::text,
    thumbnail_url text DEFAULT ''::text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    purchase_pack_type character varying(20) DEFAULT 'unit'::character varying NOT NULL,
    purchase_pack_qty integer DEFAULT 1 NOT NULL,
    reorder_trigger_percent numeric(6,2) DEFAULT 70 NOT NULL,
    size_distribution_json jsonb,
    supplier_id bigint,
    last_purchase_cost numeric(12,2),
    warehouse_id bigint,
    branch_id bigint,
    edition_name text,
    edition_slug text,
    default_purchase_qty integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp without time zone,
    regular_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price_enabled boolean DEFAULT false NOT NULL,
    sale_reason character varying(40) DEFAULT ''::character varying,
    sale_start_at timestamp without time zone,
    sale_end_at timestamp without time zone,
    wholesale_price numeric(12,2) DEFAULT 0 NOT NULL,
    last_purchase_pricing_at timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    article_code text,
    purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    last_purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    average_cost numeric(12,2) DEFAULT 0 NOT NULL,
    selling_price numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: product_variants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_variants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_variants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_variants_id_seq OWNED BY public.product_variants.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name character varying(255),
    description text,
    price numeric(10,2),
    brand character varying(100),
    category character varying(100),
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    cost_price numeric(12,2) DEFAULT 0 NOT NULL,
    wholesale_price numeric(12,2) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,2) DEFAULT 0 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    low_stock_alert integer DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    sku character varying(120) DEFAULT ''::character varying,
    barcode character varying(120) DEFAULT ''::character varying,
    image_url text DEFAULT ''::text,
    tenant_id bigint,
    image text DEFAULT ''::text,
    photo_url text DEFAULT ''::text,
    thumbnail_url text DEFAULT ''::text,
    qr_token text,
    category_id bigint,
    brand_id bigint,
    unit_id bigint,
    gallery_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    main_category character varying(255) DEFAULT ''::character varying,
    sub_category character varying(255) DEFAULT ''::character varying,
    child_category character varying(255) DEFAULT ''::character varying,
    gender text,
    product_type text,
    style text,
    grade text,
    variation_mode character varying(30) DEFAULT 'full_variations'::character varying NOT NULL,
    fixed_size_label character varying(80) DEFAULT ''::character varying,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    manufacturer_id bigint,
    supplier_id bigint,
    warehouse_id bigint,
    description_ar text DEFAULT ''::text,
    description_en text DEFAULT ''::text,
    meta_title text DEFAULT ''::text,
    seo_description text DEFAULT ''::text,
    seo_keywords text DEFAULT ''::text,
    canonical_slug text DEFAULT ''::text,
    low_stock_tracking_mode character varying(30) DEFAULT 'variant'::character varying NOT NULL,
    product_low_stock_threshold integer DEFAULT 0 NOT NULL,
    minimum_distinct_sizes_required integer DEFAULT 0 NOT NULL,
    product_code text DEFAULT ''::text,
    slug text DEFAULT ''::text,
    use_custom_compare_price boolean DEFAULT false NOT NULL,
    custom_compare_price numeric(12,2) DEFAULT 0 NOT NULL,
    regular_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price_enabled boolean DEFAULT false NOT NULL,
    sale_reason character varying(40) DEFAULT ''::character varying,
    sale_start_at timestamp without time zone,
    sale_end_at timestamp without time zone,
    last_purchase_pricing_at timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    last_purchase_cost numeric(12,2),
    last_purchase_price numeric(12,2) DEFAULT 0 NOT NULL,
    average_cost numeric(12,2) DEFAULT 0 NOT NULL,
    selling_price numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    purchase_alerts_enabled boolean DEFAULT true NOT NULL,
    purchase_alert_by_color boolean DEFAULT false NOT NULL,
    carton_size integer,
    suggested_purchase_cartons integer DEFAULT 1 NOT NULL
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_items (
    id integer NOT NULL,
    purchase_id integer,
    product_id integer,
    variant_id integer,
    quantity integer NOT NULL,
    cost_price numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    tenant_id bigint,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    unit_cost numeric(12,2) DEFAULT 0,
    selling_price numeric(12,2) DEFAULT 0 NOT NULL,
    sale_price numeric(12,2) DEFAULT 0 NOT NULL,
    regular_price numeric(12,2) DEFAULT 0 NOT NULL,
    wholesale_price numeric(12,2) DEFAULT 0 NOT NULL,
    article_code text
);


--
-- Name: purchase_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_items_id_seq OWNED BY public.purchase_items.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    supplier_id integer,
    total numeric(10,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id bigint,
    warehouse_id bigint,
    purchase_number character varying(100) DEFAULT 'PO-PENDING'::character varying NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    payment_status character varying(50) DEFAULT 'unpaid'::character varying NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by bigint,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    supplier_payment_status character varying(50) DEFAULT 'unpaid'::character varying NOT NULL,
    supplier_paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    client_request_id character varying(120),
    purchase_save_id character varying(120),
    stock_applied boolean DEFAULT false NOT NULL,
    stock_applied_at timestamp without time zone,
    legacy_purchase_number character varying(100),
    deleted_at timestamp without time zone,
    deleted_by bigint,
    delete_reason text,
    reversed_at timestamp without time zone,
    reversed_by bigint,
    remaining_amount numeric(12,2) DEFAULT 0 NOT NULL,
    payment_account_id bigint,
    payment_method character varying(80)
);


--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: qa_accounting_inventory_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_accounting_inventory_reports (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    source character varying(80) DEFAULT 'QA_STRESS_TEST'::character varying NOT NULL,
    status character varying(20) NOT NULL,
    report jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: qa_accounting_inventory_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_accounting_inventory_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_accounting_inventory_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_accounting_inventory_reports_id_seq OWNED BY public.qa_accounting_inventory_reports.id;


--
-- Name: recently_viewed_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recently_viewed_products (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    customer_id bigint,
    session_id text,
    phone character varying(80),
    product_id bigint NOT NULL,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: recently_viewed_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recently_viewed_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recently_viewed_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recently_viewed_products_id_seq OWNED BY public.recently_viewed_products.id;


--
-- Name: recurring_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_expenses (
    id bigint NOT NULL,
    tenant_id bigint,
    title character varying(255) NOT NULL,
    expense_type character varying(80) DEFAULT 'other'::character varying NOT NULL,
    category_id bigint,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    payment_method character varying(80) DEFAULT 'cash'::character varying,
    branch_id bigint,
    warehouse_id bigint,
    supplier_id bigint,
    employee_id bigint,
    financial_account_id bigint,
    frequency character varying(30) DEFAULT 'monthly'::character varying NOT NULL,
    next_due_date date DEFAULT CURRENT_DATE NOT NULL,
    auto_create boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    last_created_expense_id bigint,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: recurring_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recurring_expenses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recurring_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recurring_expenses_id_seq OWNED BY public.recurring_expenses.id;


--
-- Name: recurring_task_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_task_rules (
    id bigint NOT NULL,
    tenant_id bigint,
    template_id bigint,
    frequency character varying(30) DEFAULT 'daily'::character varying NOT NULL,
    rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: recurring_task_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recurring_task_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recurring_task_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recurring_task_rules_id_seq OWNED BY public.recurring_task_rules.id;


--
-- Name: return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_items (
    id bigint NOT NULL,
    tenant_id bigint,
    return_id bigint NOT NULL,
    order_item_id bigint NOT NULL,
    variant_id bigint,
    quantity integer DEFAULT 1 NOT NULL,
    refund_amount numeric(12,2) DEFAULT 0 NOT NULL,
    restock boolean DEFAULT false NOT NULL
);


--
-- Name: return_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.return_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: return_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.return_items_id_seq OWNED BY public.return_items.id;


--
-- Name: returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.returns (
    id bigint NOT NULL,
    tenant_id bigint,
    order_id bigint NOT NULL,
    return_number character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    reason text,
    restock boolean DEFAULT false NOT NULL,
    refund_amount numeric(12,2) DEFAULT 0 NOT NULL,
    refund_method character varying(50),
    exchange_difference numeric(12,2) DEFAULT 0 NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    shift_id bigint,
    cashier_user_id bigint
);


--
-- Name: returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.returns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.returns_id_seq OWNED BY public.returns.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role_id integer,
    permission_id integer
);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    slug character varying(120),
    description text,
    is_system boolean DEFAULT false NOT NULL,
    tenant_id bigint
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sales_commission_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_commission_settings (
    tenant_id bigint NOT NULL,
    allow_sale_without_salesperson boolean DEFAULT true CONSTRAINT sales_commission_settings_allow_sale_without_salespers_not_null NOT NULL,
    fixed_commission_mode character varying(30) DEFAULT 'fixed_per_item'::character varying NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sales_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_employees (
    id bigint NOT NULL,
    tenant_id bigint,
    name character varying(255) NOT NULL,
    code character varying(80),
    phone character varying(80),
    is_active boolean DEFAULT true NOT NULL,
    commission_type character varying(20) DEFAULT 'percent'::character varying NOT NULL,
    commission_value numeric(12,2) DEFAULT 0 NOT NULL,
    excluded_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id bigint,
    pos_alias character varying(20),
    fixed_commission_mode character varying(30),
    excluded_category_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    employee_id bigint
);


--
-- Name: sales_employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_employees_id_seq OWNED BY public.sales_employees.id;


--
-- Name: sales_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_opportunities (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    branch_id bigint,
    product_id bigint NOT NULL,
    product_variant_id bigint NOT NULL,
    type character varying(40) NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    product_name text DEFAULT ''::text NOT NULL,
    color text DEFAULT ''::text NOT NULL,
    size text DEFAULT ''::text NOT NULL,
    stock_snapshot integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp without time zone,
    notification_sent_at timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: sales_opportunities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_opportunities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_opportunities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_opportunities_id_seq OWNED BY public.sales_opportunities.id;


--
-- Name: shift_opening_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_opening_assignments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    shift_id bigint,
    attendance_log_id bigint,
    employee_id bigint NOT NULL,
    assigned_by_user_id bigint,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shift_opening_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shift_opening_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shift_opening_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shift_opening_assignments_id_seq OWNED BY public.shift_opening_assignments.id;


--
-- Name: shipping_cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_cities (
    id bigint NOT NULL,
    provider_id bigint NOT NULL,
    provider_city_id text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    code text,
    pickup_available boolean DEFAULT true NOT NULL,
    dropoff_available boolean DEFAULT true NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_cities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_cities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_cities_id_seq OWNED BY public.shipping_cities.id;


--
-- Name: shipping_districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_districts (
    id bigint NOT NULL,
    provider_id bigint NOT NULL,
    city_id bigint NOT NULL,
    zone_id bigint NOT NULL,
    provider_district_id text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    pickup_available boolean DEFAULT true NOT NULL,
    dropoff_available boolean DEFAULT true NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_districts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_districts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_districts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_districts_id_seq OWNED BY public.shipping_districts.id;


--
-- Name: shipping_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_events (
    id bigint NOT NULL,
    order_id bigint,
    provider character varying(80) NOT NULL,
    status character varying(80) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_key text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_events_id_seq OWNED BY public.shipping_events.id;


--
-- Name: shipping_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_providers (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    api_base_url text,
    api_key_encrypted text,
    api_key text,
    last_locations_sync_at timestamp without time zone,
    last_locations_sync_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_providers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_providers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_providers_id_seq OWNED BY public.shipping_providers.id;


--
-- Name: shipping_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_zones (
    id bigint NOT NULL,
    provider_id bigint NOT NULL,
    city_id bigint NOT NULL,
    provider_zone_id text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    pickup_available boolean DEFAULT true NOT NULL,
    dropoff_available boolean DEFAULT true NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipping_zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_zones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_zones_id_seq OWNED BY public.shipping_zones.id;


--
-- Name: staff_task_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_assignments (
    id bigint NOT NULL,
    tenant_id bigint,
    template_id bigint,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    task_type character varying(80) DEFAULT 'general'::character varying NOT NULL,
    source_module character varying(80) DEFAULT 'operations'::character varying NOT NULL,
    source_ref_type character varying(120),
    source_ref_id character varying(160),
    department character varying(120),
    role_key character varying(120),
    branch_id bigint,
    warehouse_id bigint,
    product_id bigint,
    variant_id bigint,
    assigned_employee_id bigint,
    current_assignee_id bigint,
    assigned_user_id bigint,
    status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    assigned_date date DEFAULT CURRENT_DATE NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    due_at timestamp without time zone,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    completed_by bigint,
    auto_assigned boolean DEFAULT false NOT NULL,
    reassignment_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by bigint,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_ref_date date,
    title_ar text,
    description_ar text,
    notes_ar text,
    rejected_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    reminder_sent_at timestamp without time zone,
    escalated_at timestamp without time zone,
    assignment_source character varying(80),
    assignment_event_id bigint,
    auto_assign_mode character varying(80),
    CONSTRAINT staff_task_assignments_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT staff_task_assignments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'overdue'::character varying, 'rejected'::character varying, 'manager_review'::character varying, 'reassigned'::character varying])::text[])))
);


--
-- Name: staff_task_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_assignments_id_seq OWNED BY public.staff_task_assignments.id;


--
-- Name: staff_task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_comments (
    id bigint NOT NULL,
    tenant_id bigint,
    task_id bigint NOT NULL,
    actor_user_id bigint,
    actor_employee_id bigint,
    comment text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: staff_task_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_comments_id_seq OWNED BY public.staff_task_comments.id;


--
-- Name: staff_task_email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_email_logs (
    id bigint NOT NULL,
    tenant_id bigint,
    employee_id bigint,
    user_id bigint,
    task_id bigint,
    email_type character varying(80) NOT NULL,
    sent_to text DEFAULT ''::text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    dedupe_key text NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    error_message text
);


--
-- Name: staff_task_email_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_email_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_email_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_email_logs_id_seq OWNED BY public.staff_task_email_logs.id;


--
-- Name: staff_task_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_history (
    id bigint NOT NULL,
    tenant_id bigint,
    task_id bigint NOT NULL,
    actor_user_id bigint,
    actor_employee_id bigint,
    action character varying(80) NOT NULL,
    from_status character varying(40),
    to_status character varying(40),
    from_employee_id bigint,
    to_employee_id bigint,
    note text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: staff_task_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_history_id_seq OWNED BY public.staff_task_history.id;


--
-- Name: staff_task_notification_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_notification_queue (
    id bigint NOT NULL,
    tenant_id bigint,
    task_id bigint,
    employee_id bigint,
    user_id bigint,
    notification_type character varying(80) DEFAULT 'task_assigned'::character varying NOT NULL,
    channel character varying(30) DEFAULT 'email'::character varying NOT NULL,
    recipient text DEFAULT ''::text NOT NULL,
    dedupe_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_error text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: staff_task_notification_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_notification_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_notification_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_notification_queue_id_seq OWNED BY public.staff_task_notification_queue.id;


--
-- Name: staff_task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_task_templates (
    id bigint NOT NULL,
    tenant_id bigint,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    task_type character varying(80) DEFAULT 'general'::character varying NOT NULL,
    department character varying(120),
    role_key character varying(120),
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    default_deadline_minutes integer DEFAULT 480 NOT NULL,
    recurrence character varying(30) DEFAULT 'manual'::character varying NOT NULL,
    source_module character varying(80) DEFAULT 'operations'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title_ar text,
    description_ar text,
    notes_ar text,
    checklist_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    photo_required boolean DEFAULT false NOT NULL,
    qr_required boolean DEFAULT false NOT NULL,
    gps_required boolean DEFAULT false NOT NULL,
    recurring_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    branch_id bigint,
    frequency character varying(30) DEFAULT 'one_time'::character varying NOT NULL,
    weekdays jsonb DEFAULT '[]'::jsonb NOT NULL,
    day_of_month integer,
    requires_checkin boolean DEFAULT false NOT NULL,
    requires_photo boolean DEFAULT false NOT NULL,
    requires_qr boolean DEFAULT false NOT NULL,
    requires_gps boolean DEFAULT false NOT NULL,
    auto_assign_enabled boolean DEFAULT false NOT NULL,
    assignment_strategy character varying(40) DEFAULT 'least_tasks_today'::character varying NOT NULL,
    fixed_employee_id bigint,
    auto_assign_mode character varying(80),
    CONSTRAINT staff_task_templates_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: staff_task_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_task_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_task_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_task_templates_id_seq OWNED BY public.staff_task_templates.id;


--
-- Name: startup_repairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.startup_repairs (
    repair_key text NOT NULL,
    repaired_rows_count integer DEFAULT 0 NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfers (
    id integer NOT NULL,
    variant_id integer,
    from_warehouse integer,
    to_warehouse integer,
    quantity integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_transfers_id_seq OWNED BY public.stock_transfers.id;


--
-- Name: storefront_customer_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storefront_customer_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    customer_id bigint,
    event_type character varying(80) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: storefront_customer_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storefront_customer_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storefront_customer_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storefront_customer_events_id_seq OWNED BY public.storefront_customer_events.id;


--
-- Name: storefront_customer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storefront_customer_sessions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    token_hash text NOT NULL,
    cart_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    wishlist_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    addresses jsonb DEFAULT '[]'::jsonb NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    ip_address text DEFAULT ''::text NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: storefront_customer_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storefront_customer_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storefront_customer_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storefront_customer_sessions_id_seq OWNED BY public.storefront_customer_sessions.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    plan character varying(50) DEFAULT 'trial'::character varying NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    billing_provider character varying(100) DEFAULT 'manual'::character varying,
    billing_email character varying(255),
    start_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    end_date timestamp without time zone,
    trial_ends_at timestamp without time zone,
    auto_renew boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    phone character varying(50),
    email character varying(255),
    address text,
    balance numeric(10,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id bigint,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    debt_balance numeric(12,2) DEFAULT 0 NOT NULL,
    supplier_code character varying(50),
    whatsapp character varying(50),
    tax_number character varying(120),
    contact_person character varying(255),
    opening_balance numeric(12,2) DEFAULT 0 NOT NULL,
    current_balance numeric(12,2) DEFAULT 0 NOT NULL,
    deleted_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    value jsonb DEFAULT 'null'::jsonb NOT NULL,
    category text NOT NULL,
    is_secret boolean DEFAULT false NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    updated_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: task_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_activity_logs (
    id bigint NOT NULL
);


--
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_assignments (
    id bigint NOT NULL
);


--
-- Name: task_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_attachments (
    id bigint NOT NULL,
    tenant_id bigint,
    task_id bigint NOT NULL,
    employee_id bigint,
    attachment_type character varying(40) DEFAULT 'photo'::character varying NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: task_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_attachments_id_seq OWNED BY public.task_attachments.id;


--
-- Name: task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_templates (
    id bigint NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(120) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    plan character varying(50) DEFAULT 'trial'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50),
    reference_id integer,
    note text,
    cashbox_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id bigint
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    abbreviation character varying(50),
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: units_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.units_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.units_id_seq OWNED BY public.units.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(255),
    email character varying(255),
    password text,
    role character varying(50) DEFAULT 'employee'::character varying,
    role_id integer,
    tenant_id bigint,
    is_super_admin boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login_at timestamp without time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variants (
    id integer NOT NULL,
    product_id integer,
    color character varying(100),
    size character varying(50),
    sku character varying(100),
    stock integer DEFAULT 0
);


--
-- Name: variants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.variants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: variants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.variants_id_seq OWNED BY public.variants.id;


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id bigint NOT NULL,
    tenant_id bigint,
    customer_id bigint NOT NULL,
    order_id bigint,
    transaction_type character varying(50) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    balance_after numeric(12,2) DEFAULT 0 NOT NULL,
    description text,
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    before_balance numeric(12,2) DEFAULT 0 NOT NULL,
    after_balance numeric(12,2) DEFAULT 0 NOT NULL,
    reference_type character varying(50),
    reference_id bigint,
    notes text
);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_transactions_id_seq OWNED BY public.wallet_transactions.id;


--
-- Name: warehouse_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse_inventory (
    id integer NOT NULL,
    warehouse_id integer,
    variant_id integer,
    stock integer DEFAULT 0,
    branch_id bigint,
    section_id bigint
);


--
-- Name: warehouse_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouse_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouse_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouse_inventory_id_seq OWNED BY public.warehouse_inventory.id;


--
-- Name: warehouse_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse_sections (
    id bigint NOT NULL,
    tenant_id bigint,
    branch_id bigint,
    warehouse_id bigint,
    code character varying(120) NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    qr_code text,
    barcode character varying(160),
    color character varying(40) DEFAULT '#2563eb'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: warehouse_sections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouse_sections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouse_sections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouse_sections_id_seq OWNED BY public.warehouse_sections.id;


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    location character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    latitude numeric,
    longitude numeric,
    allowed_radius_meters integer DEFAULT 100 NOT NULL,
    qr_token text DEFAULT (gen_random_uuid())::text,
    tenant_id bigint,
    code character varying(50),
    branch_name character varying(255),
    status character varying(50) DEFAULT 'active'::character varying NOT NULL
);


--
-- Name: warehouses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouses_id_seq OWNED BY public.warehouses.id;


--
-- Name: website_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.website_notifications (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    customer_id bigint,
    phone character varying(80),
    type character varying(80) NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: website_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.website_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: website_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.website_notifications_id_seq OWNED BY public.website_notifications.id;


--
-- Name: website_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.website_settings (
    id bigint NOT NULL,
    tenant_id bigint,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: website_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.website_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: website_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.website_settings_id_seq OWNED BY public.website_settings.id;


--
-- Name: accounting_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.accounting_audit_logs_id_seq'::regclass);


--
-- Name: accounting_order_item_cost_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides ALTER COLUMN id SET DEFAULT nextval('public.accounting_order_item_cost_overrides_id_seq'::regclass);


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs ALTER COLUMN id SET DEFAULT nextval('public.activity_logs_id_seq'::regclass);


--
-- Name: ai_channel_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_conversations ALTER COLUMN id SET DEFAULT nextval('public.ai_channel_conversations_id_seq'::regclass);


--
-- Name: ai_channel_event_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_event_logs ALTER COLUMN id SET DEFAULT nextval('public.ai_channel_event_logs_id_seq'::regclass);


--
-- Name: ai_conversation_memories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_memories ALTER COLUMN id SET DEFAULT nextval('public.ai_conversation_memories_id_seq'::regclass);


--
-- Name: ai_customer_interactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_interactions ALTER COLUMN id SET DEFAULT nextval('public.ai_customer_interactions_id_seq'::regclass);


--
-- Name: ai_customer_memories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_memories ALTER COLUMN id SET DEFAULT nextval('public.ai_customer_memories_id_seq'::regclass);


--
-- Name: ai_customer_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_profiles ALTER COLUMN id SET DEFAULT nextval('public.ai_customer_profiles_id_seq'::regclass);


--
-- Name: ai_followup_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_followup_tasks ALTER COLUMN id SET DEFAULT nextval('public.ai_followup_tasks_id_seq'::regclass);


--
-- Name: ai_marketing_content_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_queue ALTER COLUMN id SET DEFAULT nextval('public.ai_marketing_content_queue_id_seq'::regclass);


--
-- Name: ai_marketing_content_timeline id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_timeline ALTER COLUMN id SET DEFAULT nextval('public.ai_marketing_content_timeline_id_seq'::regclass);


--
-- Name: ai_marketing_generation_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_generation_runs ALTER COLUMN id SET DEFAULT nextval('public.ai_marketing_generation_runs_id_seq'::regclass);


--
-- Name: ai_marketing_performance_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_performance_snapshots ALTER COLUMN id SET DEFAULT nextval('public.ai_marketing_performance_snapshots_id_seq'::regclass);


--
-- Name: ai_marketing_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_settings ALTER COLUMN id SET DEFAULT nextval('public.ai_marketing_settings_id_seq'::regclass);


--
-- Name: ai_product_image_visual_index id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_product_image_visual_index ALTER COLUMN id SET DEFAULT nextval('public.ai_product_image_visual_index_id_seq'::regclass);


--
-- Name: ai_reply_traces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_traces ALTER COLUMN id SET DEFAULT nextval('public.ai_reply_traces_id_seq'::regclass);


--
-- Name: ai_sales_conversation_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_sales_conversation_states ALTER COLUMN id SET DEFAULT nextval('public.ai_sales_conversation_states_id_seq'::regclass);


--
-- Name: ai_sales_journey_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_sales_journey_events ALTER COLUMN id SET DEFAULT nextval('public.ai_sales_journey_events_id_seq'::regclass);


--
-- Name: ai_support_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_messages ALTER COLUMN id SET DEFAULT nextval('public.ai_support_messages_id_seq'::regclass);


--
-- Name: ai_support_product_aliases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_product_aliases ALTER COLUMN id SET DEFAULT nextval('public.ai_support_product_aliases_id_seq'::regclass);


--
-- Name: ai_support_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_sessions ALTER COLUMN id SET DEFAULT nextval('public.ai_support_sessions_id_seq'::regclass);


--
-- Name: attendance_device_bindings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings ALTER COLUMN id SET DEFAULT nextval('public.attendance_device_bindings_id_seq'::regclass);


--
-- Name: attendance_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events ALTER COLUMN id SET DEFAULT nextval('public.attendance_events_id_seq'::regclass);


--
-- Name: attendance_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs ALTER COLUMN id SET DEFAULT nextval('public.attendance_logs_id_seq'::regclass);


--
-- Name: attendance_suspicious_activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_suspicious_activity_logs ALTER COLUMN id SET DEFAULT nextval('public.attendance_suspicious_activity_logs_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: brands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands ALTER COLUMN id SET DEFAULT nextval('public.brands_id_seq'::regclass);


--
-- Name: cash_drawer_shift_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shift_events ALTER COLUMN id SET DEFAULT nextval('public.cash_drawer_shift_events_id_seq'::regclass);


--
-- Name: cash_drawer_shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts ALTER COLUMN id SET DEFAULT nextval('public.cash_drawer_shifts_id_seq'::regclass);


--
-- Name: cashbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox ALTER COLUMN id SET DEFAULT nextval('public.cashbox_id_seq'::regclass);


--
-- Name: cashbox_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox_movements ALTER COLUMN id SET DEFAULT nextval('public.cashbox_movements_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: commission_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules ALTER COLUMN id SET DEFAULT nextval('public.commission_rules_id_seq'::regclass);


--
-- Name: company_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles ALTER COLUMN id SET DEFAULT nextval('public.company_profiles_id_seq'::regclass);


--
-- Name: coupon_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_campaigns ALTER COLUMN id SET DEFAULT nextval('public.coupon_campaigns_id_seq'::regclass);


--
-- Name: coupon_redemptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions ALTER COLUMN id SET DEFAULT nextval('public.coupon_redemptions_id_seq'::regclass);


--
-- Name: coupons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons ALTER COLUMN id SET DEFAULT nextval('public.coupons_id_seq'::regclass);


--
-- Name: customer_loyalty id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty ALTER COLUMN id SET DEFAULT nextval('public.customer_loyalty_id_seq'::regclass);


--
-- Name: customer_loyalty_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty_history ALTER COLUMN id SET DEFAULT nextval('public.customer_loyalty_history_id_seq'::regclass);


--
-- Name: customer_wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wallets ALTER COLUMN id SET DEFAULT nextval('public.customer_wallets_id_seq'::regclass);


--
-- Name: customer_wishlist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wishlist ALTER COLUMN id SET DEFAULT nextval('public.customer_wishlist_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: employee_admin_rewards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_admin_rewards ALTER COLUMN id SET DEFAULT nextval('public.employee_admin_rewards_id_seq'::regclass);


--
-- Name: employee_advances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances ALTER COLUMN id SET DEFAULT nextval('public.employee_advances_id_seq'::regclass);


--
-- Name: employee_attendance_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices ALTER COLUMN id SET DEFAULT nextval('public.employee_attendance_devices_id_seq'::regclass);


--
-- Name: employee_badge_awards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_badge_awards ALTER COLUMN id SET DEFAULT nextval('public.employee_badge_awards_id_seq'::regclass);


--
-- Name: employee_chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_messages ALTER COLUMN id SET DEFAULT nextval('public.employee_chat_messages_id_seq'::regclass);


--
-- Name: employee_chat_threads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_threads ALTER COLUMN id SET DEFAULT nextval('public.employee_chat_threads_id_seq'::regclass);


--
-- Name: employee_commissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commissions ALTER COLUMN id SET DEFAULT nextval('public.employee_commissions_id_seq'::regclass);


--
-- Name: employee_display_refill_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_display_refill_alerts ALTER COLUMN id SET DEFAULT nextval('public.employee_display_refill_alerts_id_seq'::regclass);


--
-- Name: employee_goals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_goals ALTER COLUMN id SET DEFAULT nextval('public.employee_goals_id_seq'::regclass);


--
-- Name: employee_leaves id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves ALTER COLUMN id SET DEFAULT nextval('public.employee_leaves_id_seq'::regclass);


--
-- Name: employee_payroll_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_payroll_runs ALTER COLUMN id SET DEFAULT nextval('public.employee_payroll_runs_id_seq'::regclass);


--
-- Name: employee_penalties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_penalties ALTER COLUMN id SET DEFAULT nextval('public.employee_penalties_id_seq'::regclass);


--
-- Name: employee_portal_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.employee_portal_audit_logs_id_seq'::regclass);


--
-- Name: employee_portal_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_notifications ALTER COLUMN id SET DEFAULT nextval('public.employee_portal_notifications_id_seq'::regclass);


--
-- Name: employee_portal_push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.employee_portal_push_subscriptions_id_seq'::regclass);


--
-- Name: employee_portal_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_requests ALTER COLUMN id SET DEFAULT nextval('public.employee_portal_requests_id_seq'::regclass);


--
-- Name: employee_portal_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions ALTER COLUMN id SET DEFAULT nextval('public.employee_portal_sessions_id_seq'::regclass);


--
-- Name: employee_push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.employee_push_subscriptions_id_seq'::regclass);


--
-- Name: employee_reward_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reward_points ALTER COLUMN id SET DEFAULT nextval('public.employee_reward_points_id_seq'::regclass);


--
-- Name: employee_sales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales ALTER COLUMN id SET DEFAULT nextval('public.employee_sales_id_seq'::regclass);


--
-- Name: employee_shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts ALTER COLUMN id SET DEFAULT nextval('public.employee_shifts_id_seq'::regclass);


--
-- Name: employee_vacations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_vacations ALTER COLUMN id SET DEFAULT nextval('public.employee_vacations_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: expense_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_approvals ALTER COLUMN id SET DEFAULT nextval('public.expense_approvals_id_seq'::regclass);


--
-- Name: expense_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_attachments ALTER COLUMN id SET DEFAULT nextval('public.expense_attachments_id_seq'::regclass);


--
-- Name: expense_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories ALTER COLUMN id SET DEFAULT nextval('public.expense_categories_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: financial_account_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_entries ALTER COLUMN id SET DEFAULT nextval('public.financial_account_entries_id_seq'::regclass);


--
-- Name: financial_account_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers ALTER COLUMN id SET DEFAULT nextval('public.financial_account_transfers_id_seq'::regclass);


--
-- Name: financial_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts ALTER COLUMN id SET DEFAULT nextval('public.financial_accounts_id_seq'::regclass);


--
-- Name: holidays id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays ALTER COLUMN id SET DEFAULT nextval('public.holidays_id_seq'::regclass);


--
-- Name: income id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income ALTER COLUMN id SET DEFAULT nextval('public.income_id_seq'::regclass);


--
-- Name: inventory_count_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_items ALTER COLUMN id SET DEFAULT nextval('public.inventory_count_items_id_seq'::regclass);


--
-- Name: inventory_count_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions ALTER COLUMN id SET DEFAULT nextval('public.inventory_count_sessions_id_seq'::regclass);


--
-- Name: inventory_counts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts ALTER COLUMN id SET DEFAULT nextval('public.inventory_counts_id_seq'::regclass);


--
-- Name: inventory_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements ALTER COLUMN id SET DEFAULT nextval('public.inventory_movements_id_seq'::regclass);


--
-- Name: journal_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries ALTER COLUMN id SET DEFAULT nextval('public.journal_entries_id_seq'::regclass);


--
-- Name: journal_entry_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines ALTER COLUMN id SET DEFAULT nextval('public.journal_entry_lines_id_seq'::regclass);


--
-- Name: journal_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines ALTER COLUMN id SET DEFAULT nextval('public.journal_lines_id_seq'::regclass);


--
-- Name: ledger_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.ledger_entries_id_seq'::regclass);


--
-- Name: loyalty_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rules ALTER COLUMN id SET DEFAULT nextval('public.loyalty_rules_id_seq'::regclass);


--
-- Name: loyalty_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions ALTER COLUMN id SET DEFAULT nextval('public.loyalty_transactions_id_seq'::regclass);


--
-- Name: manufacturers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturers ALTER COLUMN id SET DEFAULT nextval('public.manufacturers_id_seq'::regclass);


--
-- Name: marketing_attribution_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events ALTER COLUMN id SET DEFAULT nextval('public.marketing_attribution_events_id_seq'::regclass);


--
-- Name: marketing_auto_reply_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_auto_reply_rules ALTER COLUMN id SET DEFAULT nextval('public.marketing_auto_reply_rules_id_seq'::regclass);


--
-- Name: marketing_automation_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_logs ALTER COLUMN id SET DEFAULT nextval('public.marketing_automation_logs_id_seq'::regclass);


--
-- Name: marketing_automation_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_settings ALTER COLUMN id SET DEFAULT nextval('public.marketing_automation_settings_id_seq'::regclass);


--
-- Name: marketing_brand_identity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_brand_identity ALTER COLUMN id SET DEFAULT nextval('public.marketing_brand_identity_id_seq'::regclass);


--
-- Name: marketing_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns ALTER COLUMN id SET DEFAULT nextval('public.marketing_campaigns_id_seq'::regclass);


--
-- Name: marketing_comment_dm_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs ALTER COLUMN id SET DEFAULT nextval('public.marketing_comment_dm_logs_id_seq'::regclass);


--
-- Name: marketing_comment_dm_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_rules ALTER COLUMN id SET DEFAULT nextval('public.marketing_comment_dm_rules_id_seq'::regclass);


--
-- Name: marketing_comment_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events ALTER COLUMN id SET DEFAULT nextval('public.marketing_comment_events_id_seq'::regclass);


--
-- Name: marketing_content_drafts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts ALTER COLUMN id SET DEFAULT nextval('public.marketing_content_drafts_id_seq'::regclass);


--
-- Name: marketing_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_conversations ALTER COLUMN id SET DEFAULT nextval('public.marketing_conversations_id_seq'::regclass);


--
-- Name: marketing_post_analytics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_analytics ALTER COLUMN id SET DEFAULT nextval('public.marketing_post_analytics_id_seq'::regclass);


--
-- Name: marketing_post_product_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_product_links ALTER COLUMN id SET DEFAULT nextval('public.marketing_post_product_links_id_seq'::regclass);


--
-- Name: marketing_post_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_templates ALTER COLUMN id SET DEFAULT nextval('public.marketing_post_templates_id_seq'::regclass);


--
-- Name: marketing_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts ALTER COLUMN id SET DEFAULT nextval('public.marketing_posts_id_seq'::regclass);


--
-- Name: marketing_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_settings ALTER COLUMN id SET DEFAULT nextval('public.marketing_settings_id_seq'::regclass);


--
-- Name: marketing_story_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns ALTER COLUMN id SET DEFAULT nextval('public.marketing_story_campaigns_id_seq'::regclass);


--
-- Name: marketing_story_exports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports ALTER COLUMN id SET DEFAULT nextval('public.marketing_story_exports_id_seq'::regclass);


--
-- Name: marketing_story_trigger_suggestions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions ALTER COLUMN id SET DEFAULT nextval('public.marketing_story_trigger_suggestions_id_seq'::regclass);


--
-- Name: master_qr_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_qr_models ALTER COLUMN id SET DEFAULT nextval('public.master_qr_models_id_seq'::regclass);


--
-- Name: meta_integration_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_integration_configs ALTER COLUMN id SET DEFAULT nextval('public.meta_integration_configs_id_seq'::regclass);


--
-- Name: meta_oauth_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_states ALTER COLUMN id SET DEFAULT nextval('public.meta_oauth_states_id_seq'::regclass);


--
-- Name: money_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_accounts ALTER COLUMN id SET DEFAULT nextval('public.money_accounts_id_seq'::regclass);


--
-- Name: money_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions ALTER COLUMN id SET DEFAULT nextval('public.money_transactions_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: order_edit_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_edit_audits ALTER COLUMN id SET DEFAULT nextval('public.order_edit_audits_id_seq'::regclass);


--
-- Name: order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items ALTER COLUMN id SET DEFAULT nextval('public.order_items_id_seq'::regclass);


--
-- Name: order_reprint_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reprint_logs ALTER COLUMN id SET DEFAULT nextval('public.order_reprint_logs_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: payment_method_account_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_account_mappings ALTER COLUMN id SET DEFAULT nextval('public.payment_method_account_mappings_id_seq'::regclass);


--
-- Name: payment_transaction_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transaction_events ALTER COLUMN id SET DEFAULT nextval('public.payment_transaction_events_id_seq'::regclass);


--
-- Name: payment_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions ALTER COLUMN id SET DEFAULT nextval('public.payment_transactions_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: portal_push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.portal_push_subscriptions_id_seq'::regclass);


--
-- Name: product_audiences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_audiences ALTER COLUMN id SET DEFAULT nextval('public.product_audiences_id_seq'::regclass);


--
-- Name: product_classification_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_groups ALTER COLUMN id SET DEFAULT nextval('public.product_classification_groups_id_seq'::regclass);


--
-- Name: product_classification_options id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_options ALTER COLUMN id SET DEFAULT nextval('public.product_classification_options_id_seq'::regclass);


--
-- Name: product_variant_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_images ALTER COLUMN id SET DEFAULT nextval('public.product_variant_images_id_seq'::regclass);


--
-- Name: product_variants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants ALTER COLUMN id SET DEFAULT nextval('public.product_variants_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: purchase_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_items_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: qa_accounting_inventory_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_accounting_inventory_reports ALTER COLUMN id SET DEFAULT nextval('public.qa_accounting_inventory_reports_id_seq'::regclass);


--
-- Name: recently_viewed_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recently_viewed_products ALTER COLUMN id SET DEFAULT nextval('public.recently_viewed_products_id_seq'::regclass);


--
-- Name: recurring_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_expenses ALTER COLUMN id SET DEFAULT nextval('public.recurring_expenses_id_seq'::regclass);


--
-- Name: recurring_task_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_task_rules ALTER COLUMN id SET DEFAULT nextval('public.recurring_task_rules_id_seq'::regclass);


--
-- Name: return_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items ALTER COLUMN id SET DEFAULT nextval('public.return_items_id_seq'::regclass);


--
-- Name: returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns ALTER COLUMN id SET DEFAULT nextval('public.returns_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sales_employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_employees ALTER COLUMN id SET DEFAULT nextval('public.sales_employees_id_seq'::regclass);


--
-- Name: sales_opportunities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities ALTER COLUMN id SET DEFAULT nextval('public.sales_opportunities_id_seq'::regclass);


--
-- Name: shift_opening_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments ALTER COLUMN id SET DEFAULT nextval('public.shift_opening_assignments_id_seq'::regclass);


--
-- Name: shipping_cities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_cities ALTER COLUMN id SET DEFAULT nextval('public.shipping_cities_id_seq'::regclass);


--
-- Name: shipping_districts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts ALTER COLUMN id SET DEFAULT nextval('public.shipping_districts_id_seq'::regclass);


--
-- Name: shipping_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_events ALTER COLUMN id SET DEFAULT nextval('public.shipping_events_id_seq'::regclass);


--
-- Name: shipping_providers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_providers ALTER COLUMN id SET DEFAULT nextval('public.shipping_providers_id_seq'::regclass);


--
-- Name: shipping_zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones ALTER COLUMN id SET DEFAULT nextval('public.shipping_zones_id_seq'::regclass);


--
-- Name: staff_task_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments ALTER COLUMN id SET DEFAULT nextval('public.staff_task_assignments_id_seq'::regclass);


--
-- Name: staff_task_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments ALTER COLUMN id SET DEFAULT nextval('public.staff_task_comments_id_seq'::regclass);


--
-- Name: staff_task_email_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs ALTER COLUMN id SET DEFAULT nextval('public.staff_task_email_logs_id_seq'::regclass);


--
-- Name: staff_task_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history ALTER COLUMN id SET DEFAULT nextval('public.staff_task_history_id_seq'::regclass);


--
-- Name: staff_task_notification_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_notification_queue ALTER COLUMN id SET DEFAULT nextval('public.staff_task_notification_queue_id_seq'::regclass);


--
-- Name: staff_task_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates ALTER COLUMN id SET DEFAULT nextval('public.staff_task_templates_id_seq'::regclass);


--
-- Name: stock_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers ALTER COLUMN id SET DEFAULT nextval('public.stock_transfers_id_seq'::regclass);


--
-- Name: storefront_customer_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_events ALTER COLUMN id SET DEFAULT nextval('public.storefront_customer_events_id_seq'::regclass);


--
-- Name: storefront_customer_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_sessions ALTER COLUMN id SET DEFAULT nextval('public.storefront_customer_sessions_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: task_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments ALTER COLUMN id SET DEFAULT nextval('public.task_attachments_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: units id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units ALTER COLUMN id SET DEFAULT nextval('public.units_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: variants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variants ALTER COLUMN id SET DEFAULT nextval('public.variants_id_seq'::regclass);


--
-- Name: wallet_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions ALTER COLUMN id SET DEFAULT nextval('public.wallet_transactions_id_seq'::regclass);


--
-- Name: warehouse_inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_inventory ALTER COLUMN id SET DEFAULT nextval('public.warehouse_inventory_id_seq'::regclass);


--
-- Name: warehouse_sections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_sections ALTER COLUMN id SET DEFAULT nextval('public.warehouse_sections_id_seq'::regclass);


--
-- Name: warehouses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses ALTER COLUMN id SET DEFAULT nextval('public.warehouses_id_seq'::regclass);


--
-- Name: website_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_notifications ALTER COLUMN id SET DEFAULT nextval('public.website_notifications_id_seq'::regclass);


--
-- Name: website_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_settings ALTER COLUMN id SET DEFAULT nextval('public.website_settings_id_seq'::regclass);


--
-- Name: accounting_audit_logs accounting_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_audit_logs
    ADD CONSTRAINT accounting_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_override_tenant_id_order_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_override_tenant_id_order_item_id_key UNIQUE (tenant_id, order_item_id);


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_settings ai_agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_settings
    ADD CONSTRAINT ai_agent_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: ai_channel_conversations ai_channel_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_conversations
    ADD CONSTRAINT ai_channel_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_channel_conversations ai_channel_conversations_tenant_id_channel_external_convers_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_conversations
    ADD CONSTRAINT ai_channel_conversations_tenant_id_channel_external_convers_key UNIQUE (tenant_id, channel, external_conversation_id);


--
-- Name: ai_channel_event_logs ai_channel_event_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_event_logs
    ADD CONSTRAINT ai_channel_event_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_channel_settings ai_channel_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_channel_settings
    ADD CONSTRAINT ai_channel_settings_pkey PRIMARY KEY (tenant_id, channel);


--
-- Name: ai_conversation_memories ai_conversation_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_memories
    ADD CONSTRAINT ai_conversation_memories_pkey PRIMARY KEY (id);


--
-- Name: ai_conversation_memories ai_conversation_memories_tenant_id_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_memories
    ADD CONSTRAINT ai_conversation_memories_tenant_id_session_id_key UNIQUE (tenant_id, session_id);


--
-- Name: ai_customer_interactions ai_customer_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_interactions
    ADD CONSTRAINT ai_customer_interactions_pkey PRIMARY KEY (id);


--
-- Name: ai_customer_memories ai_customer_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_memories
    ADD CONSTRAINT ai_customer_memories_pkey PRIMARY KEY (id);


--
-- Name: ai_customer_profiles ai_customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_profiles
    ADD CONSTRAINT ai_customer_profiles_pkey PRIMARY KEY (id);


--
-- Name: ai_customer_profiles ai_customer_profiles_tenant_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_profiles
    ADD CONSTRAINT ai_customer_profiles_tenant_id_phone_key UNIQUE (tenant_id, phone);


--
-- Name: ai_followup_tasks ai_followup_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_followup_tasks
    ADD CONSTRAINT ai_followup_tasks_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_content_queue ai_marketing_content_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_queue
    ADD CONSTRAINT ai_marketing_content_queue_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_content_timeline ai_marketing_content_timeline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_timeline
    ADD CONSTRAINT ai_marketing_content_timeline_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_generation_runs ai_marketing_generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_generation_runs
    ADD CONSTRAINT ai_marketing_generation_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_insights_cache ai_marketing_insights_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_insights_cache
    ADD CONSTRAINT ai_marketing_insights_cache_pkey PRIMARY KEY (tenant_id);


--
-- Name: ai_marketing_performance_snapshots ai_marketing_performance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_performance_snapshots
    ADD CONSTRAINT ai_marketing_performance_snapshots_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_settings ai_marketing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_settings
    ADD CONSTRAINT ai_marketing_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_marketing_settings ai_marketing_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_settings
    ADD CONSTRAINT ai_marketing_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: ai_outbound_dedup ai_outbound_dedup_channel_instance_conversation_id_inbound__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outbound_dedup
    ADD CONSTRAINT ai_outbound_dedup_channel_instance_conversation_id_inbound__key UNIQUE (channel, instance, conversation_id, inbound_message_id);


--
-- Name: ai_outbound_dedup ai_outbound_dedup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outbound_dedup
    ADD CONSTRAINT ai_outbound_dedup_pkey PRIMARY KEY (id);


--
-- Name: ai_product_image_visual_index ai_product_image_visual_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_product_image_visual_index
    ADD CONSTRAINT ai_product_image_visual_index_pkey PRIMARY KEY (id);


--
-- Name: ai_reply_traces ai_reply_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_traces
    ADD CONSTRAINT ai_reply_traces_pkey PRIMARY KEY (id);


--
-- Name: ai_sales_conversation_states ai_sales_conversation_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_sales_conversation_states
    ADD CONSTRAINT ai_sales_conversation_states_pkey PRIMARY KEY (id);


--
-- Name: ai_sales_conversation_states ai_sales_conversation_states_tenant_id_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_sales_conversation_states
    ADD CONSTRAINT ai_sales_conversation_states_tenant_id_conversation_id_key UNIQUE (tenant_id, conversation_id);


--
-- Name: ai_sales_journey_events ai_sales_journey_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_sales_journey_events
    ADD CONSTRAINT ai_sales_journey_events_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (key);


--
-- Name: ai_support_messages ai_support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_messages
    ADD CONSTRAINT ai_support_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_support_product_aliases ai_support_product_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_product_aliases
    ADD CONSTRAINT ai_support_product_aliases_pkey PRIMARY KEY (id);


--
-- Name: ai_support_product_aliases ai_support_product_aliases_tenant_id_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_product_aliases
    ADD CONSTRAINT ai_support_product_aliases_tenant_id_alias_key UNIQUE (tenant_id, alias);


--
-- Name: ai_support_sessions ai_support_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_sessions
    ADD CONSTRAINT ai_support_sessions_pkey PRIMARY KEY (id);


--
-- Name: ai_support_sessions ai_support_sessions_tenant_id_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_sessions
    ADD CONSTRAINT ai_support_sessions_tenant_id_session_id_key UNIQUE (tenant_id, session_id);


--
-- Name: attendance_device_bindings attendance_device_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_pkey PRIMARY KEY (id);


--
-- Name: attendance_device_bindings attendance_device_bindings_tenant_id_branch_id_business_dat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_tenant_id_branch_id_business_dat_key UNIQUE (tenant_id, branch_id, business_date, device_key);


--
-- Name: attendance_device_settings attendance_device_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_settings
    ADD CONSTRAINT attendance_device_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: attendance_events attendance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_pkey PRIMARY KEY (id);


--
-- Name: attendance_logs attendance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_pkey PRIMARY KEY (id);


--
-- Name: attendance_suspicious_activity_logs attendance_suspicious_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_suspicious_activity_logs
    ADD CONSTRAINT attendance_suspicious_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: branches branches_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_qr_token_key UNIQUE (qr_token);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: cash_drawer_shift_events cash_drawer_shift_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shift_events
    ADD CONSTRAINT cash_drawer_shift_events_pkey PRIMARY KEY (id);


--
-- Name: cash_drawer_shifts cash_drawer_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_pkey PRIMARY KEY (id);


--
-- Name: cashbox_movements cashbox_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox_movements
    ADD CONSTRAINT cashbox_movements_pkey PRIMARY KEY (id);


--
-- Name: cashbox cashbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox
    ADD CONSTRAINT cashbox_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_pkey PRIMARY KEY (id);


--
-- Name: company_profiles company_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_pkey PRIMARY KEY (id);


--
-- Name: company_profiles company_profiles_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_tenant_id_key UNIQUE (tenant_id);


--
-- Name: coupon_campaigns coupon_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_campaigns
    ADD CONSTRAINT coupon_campaigns_pkey PRIMARY KEY (id);


--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customer_loyalty_history customer_loyalty_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty_history
    ADD CONSTRAINT customer_loyalty_history_pkey PRIMARY KEY (id);


--
-- Name: customer_loyalty customer_loyalty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty
    ADD CONSTRAINT customer_loyalty_pkey PRIMARY KEY (id);


--
-- Name: customer_loyalty customer_loyalty_tenant_id_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty
    ADD CONSTRAINT customer_loyalty_tenant_id_customer_id_key UNIQUE (tenant_id, customer_id);


--
-- Name: customer_wallets customer_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wallets
    ADD CONSTRAINT customer_wallets_pkey PRIMARY KEY (id);


--
-- Name: customer_wallets customer_wallets_tenant_id_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wallets
    ADD CONSTRAINT customer_wallets_tenant_id_customer_id_key UNIQUE (tenant_id, customer_id);


--
-- Name: customer_wishlist customer_wishlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wishlist
    ADD CONSTRAINT customer_wishlist_pkey PRIMARY KEY (id);


--
-- Name: customer_wishlist customer_wishlist_tenant_id_phone_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wishlist
    ADD CONSTRAINT customer_wishlist_tenant_id_phone_product_id_key UNIQUE (tenant_id, phone, product_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: employee_admin_rewards employee_admin_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_admin_rewards
    ADD CONSTRAINT employee_admin_rewards_pkey PRIMARY KEY (id);


--
-- Name: employee_advances employee_advances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_pkey PRIMARY KEY (id);


--
-- Name: employee_attendance_devices employee_attendance_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_pkey PRIMARY KEY (id);


--
-- Name: employee_attendance_devices employee_attendance_devices_tenant_id_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_tenant_id_device_token_key UNIQUE (tenant_id, device_token);


--
-- Name: employee_badge_awards employee_badge_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_badge_awards
    ADD CONSTRAINT employee_badge_awards_pkey PRIMARY KEY (id);


--
-- Name: employee_chat_messages employee_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_messages
    ADD CONSTRAINT employee_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: employee_chat_threads employee_chat_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_threads
    ADD CONSTRAINT employee_chat_threads_pkey PRIMARY KEY (id);


--
-- Name: employee_commissions employee_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commissions
    ADD CONSTRAINT employee_commissions_pkey PRIMARY KEY (id);


--
-- Name: employee_display_refill_alerts employee_display_refill_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_display_refill_alerts
    ADD CONSTRAINT employee_display_refill_alerts_pkey PRIMARY KEY (id);


--
-- Name: employee_gamification_settings employee_gamification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_gamification_settings
    ADD CONSTRAINT employee_gamification_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: employee_goals employee_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_goals
    ADD CONSTRAINT employee_goals_pkey PRIMARY KEY (id);


--
-- Name: employee_goals employee_goals_tenant_id_employee_id_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_goals
    ADD CONSTRAINT employee_goals_tenant_id_employee_id_period_key UNIQUE (tenant_id, employee_id, period);


--
-- Name: employee_leaves employee_leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_pkey PRIMARY KEY (id);


--
-- Name: employee_payroll_runs employee_payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_payroll_runs
    ADD CONSTRAINT employee_payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: employee_penalties employee_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_penalties
    ADD CONSTRAINT employee_penalties_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_audit_logs employee_portal_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_audit_logs
    ADD CONSTRAINT employee_portal_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_notifications employee_portal_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_notifications
    ADD CONSTRAINT employee_portal_notifications_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_push_subscriptions employee_portal_push_subscrip_tenant_id_employee_id_endpoin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions
    ADD CONSTRAINT employee_portal_push_subscrip_tenant_id_employee_id_endpoin_key UNIQUE (tenant_id, employee_id, endpoint);


--
-- Name: employee_portal_push_subscriptions employee_portal_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions
    ADD CONSTRAINT employee_portal_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_requests employee_portal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_requests
    ADD CONSTRAINT employee_portal_requests_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_sessions employee_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_pkey PRIMARY KEY (id);


--
-- Name: employee_portal_sessions employee_portal_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: employee_push_subscriptions employee_push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: employee_push_subscriptions employee_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: employee_reward_points employee_reward_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reward_points
    ADD CONSTRAINT employee_reward_points_pkey PRIMARY KEY (id);


--
-- Name: employee_sales employee_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_pkey PRIMARY KEY (id);


--
-- Name: employee_sales_profiles employee_sales_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales_profiles
    ADD CONSTRAINT employee_sales_profiles_pkey PRIMARY KEY (employee_id);


--
-- Name: employee_sales employee_sales_tenant_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_tenant_id_order_id_key UNIQUE (tenant_id, order_id);


--
-- Name: employee_shifts employee_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_pkey PRIMARY KEY (id);


--
-- Name: employee_vacations employee_vacations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_vacations
    ADD CONSTRAINT employee_vacations_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_tenant_id_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_tenant_id_employee_code_key UNIQUE (tenant_id, employee_code);


--
-- Name: expense_approvals expense_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_approvals
    ADD CONSTRAINT expense_approvals_pkey PRIMARY KEY (id);


--
-- Name: expense_attachments expense_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_attachments
    ADD CONSTRAINT expense_attachments_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: financial_account_entries financial_account_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_entries
    ADD CONSTRAINT financial_account_entries_pkey PRIMARY KEY (id);


--
-- Name: financial_account_transfers financial_account_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers
    ADD CONSTRAINT financial_account_transfers_pkey PRIMARY KEY (id);


--
-- Name: financial_accounts financial_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_pkey PRIMARY KEY (id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);


--
-- Name: income income_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income
    ADD CONSTRAINT income_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_items inventory_count_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_items
    ADD CONSTRAINT inventory_count_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_sessions inventory_count_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_pkey PRIMARY KEY (id);


--
-- Name: inventory_counts inventory_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_tenant_id_entry_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_tenant_id_entry_number_key UNIQUE (tenant_id, entry_number);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: loyalty_rules loyalty_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rules
    ADD CONSTRAINT loyalty_rules_pkey PRIMARY KEY (id);


--
-- Name: loyalty_transactions loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);


--
-- Name: manufacturers manufacturers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturers
    ADD CONSTRAINT manufacturers_name_key UNIQUE (name);


--
-- Name: manufacturers manufacturers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manufacturers
    ADD CONSTRAINT manufacturers_pkey PRIMARY KEY (id);


--
-- Name: marketing_attribution_events marketing_attribution_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events
    ADD CONSTRAINT marketing_attribution_events_pkey PRIMARY KEY (id);


--
-- Name: marketing_auto_reply_rules marketing_auto_reply_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_auto_reply_rules
    ADD CONSTRAINT marketing_auto_reply_rules_pkey PRIMARY KEY (id);


--
-- Name: marketing_automation_logs marketing_automation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_logs
    ADD CONSTRAINT marketing_automation_logs_pkey PRIMARY KEY (id);


--
-- Name: marketing_automation_settings marketing_automation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_settings
    ADD CONSTRAINT marketing_automation_settings_pkey PRIMARY KEY (id);


--
-- Name: marketing_automation_settings marketing_automation_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_settings
    ADD CONSTRAINT marketing_automation_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: marketing_brand_identity marketing_brand_identity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_brand_identity
    ADD CONSTRAINT marketing_brand_identity_pkey PRIMARY KEY (id);


--
-- Name: marketing_brand_identity marketing_brand_identity_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_brand_identity
    ADD CONSTRAINT marketing_brand_identity_tenant_id_key UNIQUE (tenant_id);


--
-- Name: marketing_campaigns marketing_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_pkey PRIMARY KEY (id);


--
-- Name: marketing_campaigns marketing_campaigns_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: marketing_comment_dm_logs marketing_comment_dm_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs
    ADD CONSTRAINT marketing_comment_dm_logs_pkey PRIMARY KEY (id);


--
-- Name: marketing_comment_dm_logs marketing_comment_dm_logs_tenant_id_platform_platform_comme_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs
    ADD CONSTRAINT marketing_comment_dm_logs_tenant_id_platform_platform_comme_key UNIQUE (tenant_id, platform, platform_comment_id);


--
-- Name: marketing_comment_dm_rules marketing_comment_dm_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_rules
    ADD CONSTRAINT marketing_comment_dm_rules_pkey PRIMARY KEY (id);


--
-- Name: marketing_comment_events marketing_comment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events
    ADD CONSTRAINT marketing_comment_events_pkey PRIMARY KEY (id);


--
-- Name: marketing_comment_events marketing_comment_events_platform_comment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events
    ADD CONSTRAINT marketing_comment_events_platform_comment_id_key UNIQUE (platform, comment_id);


--
-- Name: marketing_content_drafts marketing_content_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_pkey PRIMARY KEY (id);


--
-- Name: marketing_conversations marketing_conversations_business_id_platform_user_platform__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_conversations
    ADD CONSTRAINT marketing_conversations_business_id_platform_user_platform__key UNIQUE (business_id, platform, user_platform_id);


--
-- Name: marketing_conversations marketing_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_conversations
    ADD CONSTRAINT marketing_conversations_pkey PRIMARY KEY (id);


--
-- Name: marketing_post_analytics marketing_post_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_analytics
    ADD CONSTRAINT marketing_post_analytics_pkey PRIMARY KEY (id);


--
-- Name: marketing_post_analytics marketing_post_analytics_post_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_analytics
    ADD CONSTRAINT marketing_post_analytics_post_id_platform_key UNIQUE (post_id, platform);


--
-- Name: marketing_post_product_links marketing_post_product_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_product_links
    ADD CONSTRAINT marketing_post_product_links_pkey PRIMARY KEY (id);


--
-- Name: marketing_post_templates marketing_post_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_templates
    ADD CONSTRAINT marketing_post_templates_pkey PRIMARY KEY (id);


--
-- Name: marketing_post_templates marketing_post_templates_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_templates
    ADD CONSTRAINT marketing_post_templates_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: marketing_posts marketing_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts
    ADD CONSTRAINT marketing_posts_pkey PRIMARY KEY (id);


--
-- Name: marketing_settings marketing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_settings
    ADD CONSTRAINT marketing_settings_pkey PRIMARY KEY (id);


--
-- Name: marketing_settings marketing_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_settings
    ADD CONSTRAINT marketing_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: marketing_story_campaigns marketing_story_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns
    ADD CONSTRAINT marketing_story_campaigns_pkey PRIMARY KEY (id);


--
-- Name: marketing_story_exports marketing_story_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports
    ADD CONSTRAINT marketing_story_exports_pkey PRIMARY KEY (id);


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_pkey PRIMARY KEY (id);


--
-- Name: master_qr_models master_qr_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_qr_models
    ADD CONSTRAINT master_qr_models_pkey PRIMARY KEY (id);


--
-- Name: meta_integration_configs meta_integration_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_integration_configs
    ADD CONSTRAINT meta_integration_configs_pkey PRIMARY KEY (id);


--
-- Name: meta_integration_configs meta_integration_configs_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_integration_configs
    ADD CONSTRAINT meta_integration_configs_tenant_id_key UNIQUE (tenant_id);


--
-- Name: meta_oauth_states meta_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_states
    ADD CONSTRAINT meta_oauth_states_pkey PRIMARY KEY (id);


--
-- Name: meta_oauth_states meta_oauth_states_state_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_states
    ADD CONSTRAINT meta_oauth_states_state_token_key UNIQUE (state_token);


--
-- Name: money_accounts money_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_accounts
    ADD CONSTRAINT money_accounts_pkey PRIMARY KEY (id);


--
-- Name: money_transactions money_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_edit_audits order_edit_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_edit_audits
    ADD CONSTRAINT order_edit_audits_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_reprint_logs order_reprint_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reprint_logs
    ADD CONSTRAINT order_reprint_logs_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_method_account_mappings payment_method_account_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_account_mappings
    ADD CONSTRAINT payment_method_account_mappings_pkey PRIMARY KEY (id);


--
-- Name: payment_transaction_events payment_transaction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transaction_events
    ADD CONSTRAINT payment_transaction_events_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: portal_push_subscriptions portal_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_push_subscriptions
    ADD CONSTRAINT portal_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: portal_push_subscriptions portal_push_subscriptions_portal_type_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_push_subscriptions
    ADD CONSTRAINT portal_push_subscriptions_portal_type_endpoint_key UNIQUE (portal_type, endpoint);


--
-- Name: product_audiences product_audiences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_audiences
    ADD CONSTRAINT product_audiences_pkey PRIMARY KEY (id);


--
-- Name: product_audiences product_audiences_product_id_audience_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_audiences
    ADD CONSTRAINT product_audiences_product_id_audience_key UNIQUE (product_id, audience);


--
-- Name: product_classification_groups product_classification_groups_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_groups
    ADD CONSTRAINT product_classification_groups_key_key UNIQUE (key);


--
-- Name: product_classification_groups product_classification_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_groups
    ADD CONSTRAINT product_classification_groups_pkey PRIMARY KEY (id);


--
-- Name: product_classification_options product_classification_options_group_id_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_options
    ADD CONSTRAINT product_classification_options_group_id_value_key UNIQUE (group_id, value);


--
-- Name: product_classification_options product_classification_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_options
    ADD CONSTRAINT product_classification_options_pkey PRIMARY KEY (id);


--
-- Name: product_variant_images product_variant_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_images
    ADD CONSTRAINT product_variant_images_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: qa_accounting_inventory_reports qa_accounting_inventory_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_accounting_inventory_reports
    ADD CONSTRAINT qa_accounting_inventory_reports_pkey PRIMARY KEY (id);


--
-- Name: recently_viewed_products recently_viewed_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recently_viewed_products
    ADD CONSTRAINT recently_viewed_products_pkey PRIMARY KEY (id);


--
-- Name: recurring_expenses recurring_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_expenses
    ADD CONSTRAINT recurring_expenses_pkey PRIMARY KEY (id);


--
-- Name: recurring_task_rules recurring_task_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_task_rules
    ADD CONSTRAINT recurring_task_rules_pkey PRIMARY KEY (id);


--
-- Name: return_items return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_pkey PRIMARY KEY (id);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_commission_settings sales_commission_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_commission_settings
    ADD CONSTRAINT sales_commission_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: sales_employees sales_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_employees
    ADD CONSTRAINT sales_employees_pkey PRIMARY KEY (id);


--
-- Name: sales_opportunities sales_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities
    ADD CONSTRAINT sales_opportunities_pkey PRIMARY KEY (id);


--
-- Name: shift_opening_assignments shift_opening_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments
    ADD CONSTRAINT shift_opening_assignments_pkey PRIMARY KEY (id);


--
-- Name: shipping_cities shipping_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_cities
    ADD CONSTRAINT shipping_cities_pkey PRIMARY KEY (id);


--
-- Name: shipping_cities shipping_cities_provider_id_provider_city_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_cities
    ADD CONSTRAINT shipping_cities_provider_id_provider_city_id_key UNIQUE (provider_id, provider_city_id);


--
-- Name: shipping_districts shipping_districts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts
    ADD CONSTRAINT shipping_districts_pkey PRIMARY KEY (id);


--
-- Name: shipping_districts shipping_districts_provider_id_provider_district_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts
    ADD CONSTRAINT shipping_districts_provider_id_provider_district_id_key UNIQUE (provider_id, provider_district_id);


--
-- Name: shipping_events shipping_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_events
    ADD CONSTRAINT shipping_events_pkey PRIMARY KEY (id);


--
-- Name: shipping_providers shipping_providers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_providers
    ADD CONSTRAINT shipping_providers_code_key UNIQUE (code);


--
-- Name: shipping_providers shipping_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_providers
    ADD CONSTRAINT shipping_providers_pkey PRIMARY KEY (id);


--
-- Name: shipping_zones shipping_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_pkey PRIMARY KEY (id);


--
-- Name: shipping_zones shipping_zones_provider_id_provider_zone_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_provider_id_provider_zone_id_key UNIQUE (provider_id, provider_zone_id);


--
-- Name: staff_task_assignments staff_task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_pkey PRIMARY KEY (id);


--
-- Name: staff_task_comments staff_task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments
    ADD CONSTRAINT staff_task_comments_pkey PRIMARY KEY (id);


--
-- Name: staff_task_email_logs staff_task_email_logs_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs
    ADD CONSTRAINT staff_task_email_logs_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: staff_task_email_logs staff_task_email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs
    ADD CONSTRAINT staff_task_email_logs_pkey PRIMARY KEY (id);


--
-- Name: staff_task_history staff_task_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_pkey PRIMARY KEY (id);


--
-- Name: staff_task_notification_queue staff_task_notification_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_notification_queue
    ADD CONSTRAINT staff_task_notification_queue_pkey PRIMARY KEY (id);


--
-- Name: staff_task_templates staff_task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates
    ADD CONSTRAINT staff_task_templates_pkey PRIMARY KEY (id);


--
-- Name: startup_repairs startup_repairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_repairs
    ADD CONSTRAINT startup_repairs_pkey PRIMARY KEY (repair_key);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: storefront_customer_events storefront_customer_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_events
    ADD CONSTRAINT storefront_customer_events_pkey PRIMARY KEY (id);


--
-- Name: storefront_customer_sessions storefront_customer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_sessions
    ADD CONSTRAINT storefront_customer_sessions_pkey PRIMARY KEY (id);


--
-- Name: storefront_customer_sessions storefront_customer_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_sessions
    ADD CONSTRAINT storefront_customer_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_key UNIQUE (tenant_id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: task_activity_logs task_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_logs
    ADD CONSTRAINT task_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);


--
-- Name: task_attachments task_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_pkey PRIMARY KEY (id);


--
-- Name: task_templates task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: variants variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variants
    ADD CONSTRAINT variants_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: warehouse_inventory warehouse_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_inventory
    ADD CONSTRAINT warehouse_inventory_pkey PRIMARY KEY (id);


--
-- Name: warehouse_sections warehouse_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_sections
    ADD CONSTRAINT warehouse_sections_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: website_notifications website_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_notifications
    ADD CONSTRAINT website_notifications_pkey PRIMARY KEY (id);


--
-- Name: website_settings website_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_settings
    ADD CONSTRAINT website_settings_pkey PRIMARY KEY (id);


--
-- Name: website_settings website_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_settings
    ADD CONSTRAINT website_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: ai_product_image_visual_index_unique_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_product_image_visual_index_unique_url ON public.ai_product_image_visual_index USING btree (tenant_id, product_id, COALESCE(variant_id, (0)::bigint), lower(TRIM(BOTH FROM image_url)));


--
-- Name: idx_accounting_audit_logs_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounting_audit_logs_filters ON public.accounting_audit_logs USING btree (tenant_id, action, entity_type, user_id);


--
-- Name: idx_accounting_audit_logs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounting_audit_logs_tenant_created ON public.accounting_audit_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_accounts_tenant_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_tenant_code ON public.accounts USING btree (tenant_id, code);


--
-- Name: idx_accounts_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_tenant_type ON public.accounts USING btree (tenant_id, type);


--
-- Name: idx_ai_channel_conversations_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_channel_conversations_customer ON public.ai_channel_conversations USING btree (tenant_id, channel, external_customer_id);


--
-- Name: idx_ai_channel_event_logs_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_channel_event_logs_dedupe ON public.ai_channel_event_logs USING btree (tenant_id, channel, direction, dedupe_key) WHERE (dedupe_key <> ''::text);


--
-- Name: idx_ai_channel_event_logs_tenant_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_channel_event_logs_tenant_channel_created ON public.ai_channel_event_logs USING btree (tenant_id, channel, created_at DESC);


--
-- Name: idx_ai_channel_settings_channel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_channel_settings_channel_id ON public.ai_channel_settings USING btree (channel_id) WHERE ((channel_id IS NOT NULL) AND (channel_id <> ''::text));


--
-- Name: idx_ai_conversation_memories_tenant_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversation_memories_tenant_phone ON public.ai_conversation_memories USING btree (tenant_id, customer_phone);


--
-- Name: idx_ai_conversation_memories_tenant_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversation_memories_tenant_updated ON public.ai_conversation_memories USING btree (tenant_id, updated_at DESC);


--
-- Name: idx_ai_customer_profiles_tenant_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_customer_profiles_tenant_seen ON public.ai_customer_profiles USING btree (tenant_id, last_seen_at DESC);


--
-- Name: idx_ai_followups_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_followups_tenant_status ON public.ai_followup_tasks USING btree (tenant_id, status, scheduled_at);


--
-- Name: idx_ai_interactions_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interactions_tenant_created ON public.ai_customer_interactions USING btree (tenant_id, created_at DESC);


--
-- Name: idx_ai_marketing_insights_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_insights_synced ON public.ai_marketing_insights_cache USING btree (last_synced_at DESC);


--
-- Name: idx_ai_marketing_perf_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_perf_platform ON public.ai_marketing_performance_snapshots USING btree (platform, synced_at DESC);


--
-- Name: idx_ai_marketing_perf_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_perf_queue ON public.ai_marketing_performance_snapshots USING btree (tenant_id, queue_id, synced_at DESC);


--
-- Name: idx_ai_marketing_queue_dedupe_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_queue_dedupe_lookup ON public.ai_marketing_content_queue USING btree (tenant_id, content_type, product_id, variant_id, created_at DESC);


--
-- Name: idx_ai_marketing_queue_product_cooldown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_queue_product_cooldown ON public.ai_marketing_content_queue USING btree (tenant_id, content_type, product_id, created_at DESC);


--
-- Name: idx_ai_marketing_queue_tenant_product_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_queue_tenant_product_day ON public.ai_marketing_content_queue USING btree (tenant_id, product_id, created_at DESC);


--
-- Name: idx_ai_marketing_queue_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_queue_tenant_status ON public.ai_marketing_content_queue USING btree (tenant_id, status, scheduled_at, created_at DESC);


--
-- Name: idx_ai_marketing_queue_variant_cooldown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_queue_variant_cooldown ON public.ai_marketing_content_queue USING btree (tenant_id, content_type, variant_id, created_at DESC);


--
-- Name: idx_ai_marketing_runs_tenant_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_runs_tenant_started ON public.ai_marketing_generation_runs USING btree (tenant_id, started_at DESC);


--
-- Name: idx_ai_marketing_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_marketing_settings_tenant ON public.ai_marketing_settings USING btree (tenant_id);


--
-- Name: idx_ai_marketing_timeline_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_marketing_timeline_queue ON public.ai_marketing_content_timeline USING btree (tenant_id, queue_id, created_at DESC);


--
-- Name: idx_ai_product_image_visual_index_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_product_image_visual_index_public_id ON public.ai_product_image_visual_index USING btree (tenant_id, image_public_id);


--
-- Name: idx_ai_product_image_visual_index_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_product_image_visual_index_tenant ON public.ai_product_image_visual_index USING btree (tenant_id, product_id, variant_id);


--
-- Name: idx_ai_reply_traces_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_reply_traces_external ON public.ai_reply_traces USING btree (tenant_id, external_message_id);


--
-- Name: idx_ai_reply_traces_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_reply_traces_session ON public.ai_reply_traces USING btree (tenant_id, channel, session_id, created_at DESC);


--
-- Name: idx_ai_sales_journey_events_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_sales_journey_events_dedupe ON public.ai_sales_journey_events USING btree (tenant_id, dedupe_key) WHERE (dedupe_key <> ''::text);


--
-- Name: idx_ai_sales_journey_events_tenant_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_sales_journey_events_tenant_conversation ON public.ai_sales_journey_events USING btree (tenant_id, conversation_id, created_at DESC);


--
-- Name: idx_ai_support_aliases_tenant_usage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_aliases_tenant_usage ON public.ai_support_product_aliases USING btree (tenant_id, mapped_product_id, usage_count DESC);


--
-- Name: idx_ai_support_messages_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_support_messages_dedupe ON public.ai_support_messages USING btree (tenant_id, session_id, dedupe_key) WHERE (dedupe_key <> ''::text);


--
-- Name: idx_ai_support_messages_provider_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_support_messages_provider_message_id ON public.ai_support_messages USING btree (tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id) WHERE (provider_message_id <> ''::text);


--
-- Name: idx_ai_support_messages_tenant_clicked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_messages_tenant_clicked ON public.ai_support_messages USING btree (tenant_id, clicked_product_id, created_at DESC);


--
-- Name: idx_ai_support_messages_tenant_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_messages_tenant_confidence ON public.ai_support_messages USING btree (tenant_id, confidence, created_at DESC);


--
-- Name: idx_ai_support_messages_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_messages_tenant_created ON public.ai_support_messages USING btree (tenant_id, created_at DESC);


--
-- Name: idx_ai_support_messages_tenant_human; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_messages_tenant_human ON public.ai_support_messages USING btree (tenant_id, needs_human_support, created_at DESC);


--
-- Name: idx_ai_support_sessions_hot_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_sessions_hot_lead ON public.ai_support_sessions USING btree (tenant_id, hot_lead, updated_at DESC);


--
-- Name: idx_ai_support_sessions_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_sessions_tenant_status ON public.ai_support_sessions USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_ai_support_sessions_tenant_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_support_sessions_tenant_updated ON public.ai_support_sessions USING btree (tenant_id, updated_at DESC);


--
-- Name: idx_attendance_device_bindings_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_device_bindings_employee ON public.attendance_device_bindings USING btree (tenant_id, branch_id, business_date, employee_id);


--
-- Name: idx_attendance_device_bindings_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attendance_device_bindings_unique ON public.attendance_device_bindings USING btree (tenant_id, branch_id, business_date, device_key);


--
-- Name: idx_attendance_events_branch_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_events_branch_timestamp ON public.attendance_events USING btree (tenant_id, branch_id, action_timestamp DESC);


--
-- Name: idx_attendance_events_duplicate_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_events_duplicate_window ON public.attendance_events USING btree (tenant_id, employee_id, branch_id, action_type, action_timestamp DESC);


--
-- Name: idx_attendance_logs_device_key_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_device_key_day ON public.attendance_logs USING btree (tenant_id, branch_id, attendance_date, device_key) WHERE (device_key IS NOT NULL);


--
-- Name: idx_attendance_logs_employee_date_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_employee_date_checkin ON public.attendance_logs USING btree (tenant_id, employee_id, attendance_date DESC, check_in_at DESC, check_in DESC);


--
-- Name: idx_attendance_logs_tenant_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_tenant_branch_date ON public.attendance_logs USING btree (tenant_id, branch_id, attendance_date DESC);


--
-- Name: idx_attendance_logs_tenant_branch_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_tenant_branch_employee_date ON public.attendance_logs USING btree (tenant_id, employee_id, branch_id, attendance_date DESC);


--
-- Name: idx_attendance_logs_tenant_employee_branch_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attendance_logs_tenant_employee_branch_date_unique ON public.attendance_logs USING btree (tenant_id, employee_id, branch_id, attendance_date) WHERE (branch_id IS NOT NULL);


--
-- Name: idx_attendance_logs_tenant_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_tenant_employee_date ON public.attendance_logs USING btree (tenant_id, employee_id, attendance_date DESC);


--
-- Name: idx_attendance_logs_tenant_employee_no_branch_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attendance_logs_tenant_employee_no_branch_date_unique ON public.attendance_logs USING btree (tenant_id, employee_id, attendance_date) WHERE (branch_id IS NULL);


--
-- Name: idx_attendance_logs_tenant_shift_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_logs_tenant_shift_date ON public.attendance_logs USING btree (tenant_id, shift_id, attendance_date DESC);


--
-- Name: idx_attendance_suspicious_activity_logs_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_suspicious_activity_logs_lookup ON public.attendance_suspicious_activity_logs USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_branches_attendance_public_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_branches_attendance_public_code ON public.branches USING btree (attendance_public_code);


--
-- Name: idx_branches_attendance_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_branches_attendance_qr_token ON public.branches USING btree (attendance_qr_token);


--
-- Name: idx_branches_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_branches_qr_token ON public.branches USING btree (qr_token);


--
-- Name: idx_branches_single_system_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_branches_single_system_branch ON public.branches USING btree ((true));


--
-- Name: idx_branches_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_tenant_active ON public.branches USING btree (tenant_id, is_active, name);


--
-- Name: idx_branches_tenant_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_branches_tenant_code_unique ON public.branches USING btree (tenant_id, code) WHERE ((code IS NOT NULL) AND ((code)::text <> ''::text));


--
-- Name: idx_cash_drawer_events_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_drawer_events_shift ON public.cash_drawer_shift_events USING btree (tenant_id, shift_id, created_at DESC);


--
-- Name: idx_cash_drawer_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_drawer_events_source ON public.cash_drawer_shift_events USING btree (tenant_id, source_type, source_id);


--
-- Name: idx_cash_drawer_one_open_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cash_drawer_one_open_shift ON public.cash_drawer_shifts USING btree (tenant_id, branch_id, opened_by) WHERE ((status)::text = 'open'::text);


--
-- Name: idx_cash_drawer_shifts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_drawer_shifts_tenant_status ON public.cash_drawer_shifts USING btree (tenant_id, status, opened_at DESC);


--
-- Name: idx_cashbox_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cashbox_tenant_id ON public.cashbox USING btree (tenant_id);


--
-- Name: idx_commission_rules_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_rules_tenant_id ON public.commission_rules USING btree (tenant_id, is_active, scope_type);


--
-- Name: idx_cost_overrides_product_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_overrides_product_variant ON public.accounting_order_item_cost_overrides USING btree (tenant_id, product_id, variant_id);


--
-- Name: idx_cost_overrides_tenant_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_overrides_tenant_item ON public.accounting_order_item_cost_overrides USING btree (tenant_id, order_item_id);


--
-- Name: idx_coupon_campaigns_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_campaigns_active ON public.coupon_campaigns USING btree (is_active);


--
-- Name: idx_coupon_campaigns_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_campaigns_expires ON public.coupon_campaigns USING btree (expires_at);


--
-- Name: idx_coupon_campaigns_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_campaigns_tenant ON public.coupon_campaigns USING btree (tenant_id);


--
-- Name: idx_coupon_redemptions_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_redemptions_campaign_id ON public.coupon_redemptions USING btree (campaign_id);


--
-- Name: idx_coupon_redemptions_coupon_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_redemptions_coupon_id ON public.coupon_redemptions USING btree (coupon_id);


--
-- Name: idx_coupons_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_active ON public.coupons USING btree (is_active);


--
-- Name: idx_coupons_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_campaign_id ON public.coupons USING btree (campaign_id);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (code);


--
-- Name: idx_coupons_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_expires ON public.coupons USING btree (expires_at);


--
-- Name: idx_customer_loyalty_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_loyalty_customer ON public.customer_loyalty USING btree (tenant_id, customer_id);


--
-- Name: idx_customer_loyalty_history_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_loyalty_history_customer ON public.customer_loyalty_history USING btree (tenant_id, customer_id, created_at DESC);


--
-- Name: idx_customer_loyalty_history_order_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customer_loyalty_history_order_reason ON public.customer_loyalty_history USING btree (COALESCE(tenant_id, (0)::bigint), customer_id, order_id, source, reason) WHERE (order_id IS NOT NULL);


--
-- Name: idx_customer_loyalty_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_loyalty_tenant_id ON public.customer_loyalty USING btree (tenant_id, customer_id);


--
-- Name: idx_customer_wallets_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_wallets_customer ON public.customer_wallets USING btree (tenant_id, customer_id);


--
-- Name: idx_customer_wishlist_tenant_phone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_wishlist_tenant_phone_created ON public.customer_wishlist USING btree (tenant_id, phone, created_at DESC);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (phone);


--
-- Name: idx_customers_storefront_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_storefront_phone ON public.customers USING btree (tenant_id, phone);


--
-- Name: idx_customers_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_tenant_id ON public.customers USING btree (tenant_id);


--
-- Name: idx_display_refill_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_display_refill_employee_status ON public.employee_display_refill_alerts USING btree (employee_id, status, is_read, created_at DESC);


--
-- Name: idx_display_refill_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_display_refill_order ON public.employee_display_refill_alerts USING btree (order_id);


--
-- Name: idx_display_refill_tenant_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_display_refill_tenant_branch_status ON public.employee_display_refill_alerts USING btree (tenant_id, branch_id, status, created_at DESC);


--
-- Name: idx_employee_admin_rewards_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_admin_rewards_employee ON public.employee_admin_rewards USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_advances_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_advances_employee_created ON public.employee_advances USING btree (tenant_id, employee_id, created_at DESC, id DESC);


--
-- Name: idx_employee_advances_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_advances_employee_status ON public.employee_advances USING btree (tenant_id, employee_id, deduction_status);


--
-- Name: idx_employee_advances_portal_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_advances_portal_request ON public.employee_advances USING btree (employee_portal_request_id) WHERE (employee_portal_request_id IS NOT NULL);


--
-- Name: idx_employee_advances_pos_expense; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_advances_pos_expense ON public.employee_advances USING btree (expense_id);


--
-- Name: idx_employee_attendance_devices_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_attendance_devices_employee ON public.employee_attendance_devices USING btree (tenant_id, employee_id, status, last_seen_at DESC);


--
-- Name: idx_employee_attendance_devices_one_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_attendance_devices_one_approved ON public.employee_attendance_devices USING btree (tenant_id, employee_id) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_employee_badge_awards_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_badge_awards_unique ON public.employee_badge_awards USING btree (tenant_id, employee_id, badge_code, period);


--
-- Name: idx_employee_chat_messages_thread_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_chat_messages_thread_created ON public.employee_chat_messages USING btree (thread_id, created_at, id);


--
-- Name: idx_employee_chat_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_chat_messages_unread ON public.employee_chat_messages USING btree (thread_id, sender_type, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_employee_chat_threads_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_chat_threads_employee ON public.employee_chat_threads USING btree (employee_id);


--
-- Name: idx_employee_chat_threads_tenant_last; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_chat_threads_tenant_last ON public.employee_chat_threads USING btree (tenant_id, last_message_at DESC NULLS LAST, updated_at DESC);


--
-- Name: idx_employee_commissions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_commissions_tenant_id ON public.employee_commissions USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_leaves_tenant_employee_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_leaves_tenant_employee_dates ON public.employee_leaves USING btree (tenant_id, employee_id, start_date, end_date, leave_date, status);


--
-- Name: idx_employee_payroll_runs_employee_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_payroll_runs_employee_period ON public.employee_payroll_runs USING btree (tenant_id, employee_id, payroll_period DESC, finalized_at DESC, id DESC);


--
-- Name: idx_employee_penalties_employee_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_penalties_employee_period ON public.employee_penalties USING btree (employee_id, penalty_date, payroll_period_start, payroll_period_end);


--
-- Name: idx_employee_penalties_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_penalties_tenant_status ON public.employee_penalties USING btree (tenant_id, status, deduct_from_payroll);


--
-- Name: idx_employee_portal_audit_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_audit_employee ON public.employee_portal_audit_logs USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_portal_notifications_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_notifications_employee_created ON public.employee_portal_notifications USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_portal_notifications_order_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_portal_notifications_order_type ON public.employee_portal_notifications USING btree (tenant_id, employee_id, order_id, type) WHERE (order_id IS NOT NULL);


--
-- Name: idx_employee_portal_push_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_push_employee ON public.employee_portal_push_subscriptions USING btree (tenant_id, employee_id, is_active);


--
-- Name: idx_employee_portal_requests_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_requests_employee_created ON public.employee_portal_requests USING btree (tenant_id, employee_id, created_at DESC, id DESC);


--
-- Name: idx_employee_portal_requests_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_requests_employee_status ON public.employee_portal_requests USING btree (tenant_id, employee_id, status, created_at DESC);


--
-- Name: idx_employee_portal_sessions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_portal_sessions_lookup ON public.employee_portal_sessions USING btree (tenant_id, employee_id, expires_at DESC);


--
-- Name: idx_employee_push_subscriptions_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_push_subscriptions_employee ON public.employee_push_subscriptions USING btree (employee_id, is_active, last_seen_at DESC);


--
-- Name: idx_employee_reward_points_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_reward_points_employee ON public.employee_reward_points USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_reward_points_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_reward_points_source ON public.employee_reward_points USING btree (tenant_id, employee_id, source_type, source_ref) WHERE (source_ref IS NOT NULL);


--
-- Name: idx_employee_sales_profiles_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_sales_profiles_tenant_active ON public.employee_sales_profiles USING btree (tenant_id, is_sales_active);


--
-- Name: idx_employee_sales_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_sales_tenant_id ON public.employee_sales USING btree (tenant_id, sales_employee_id, cashier_id, created_at DESC);


--
-- Name: idx_employee_shifts_tenant_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_shifts_tenant_employee ON public.employee_shifts USING btree (tenant_id, employee_id, created_at DESC);


--
-- Name: idx_employee_shifts_window_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_shifts_window_lookup ON public.employee_shifts USING btree (tenant_id, employee_id, check_in_window_start, check_in_window_end);


--
-- Name: idx_employee_vacations_tenant_employee_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_vacations_tenant_employee_dates ON public.employee_vacations USING btree (tenant_id, employee_id, start_date, end_date, vacation_date, status);


--
-- Name: idx_employees_employee_portal_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employees_employee_portal_token ON public.employees USING btree (employee_portal_token) WHERE (employee_portal_token IS NOT NULL);


--
-- Name: idx_employees_manager_portal_settings; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_manager_portal_settings ON public.employees USING gin (manager_portal_settings);


--
-- Name: idx_employees_manager_portal_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employees_manager_portal_token ON public.employees USING btree (manager_portal_token) WHERE ((manager_portal_token IS NOT NULL) AND (manager_portal_token <> ''::text));


--
-- Name: idx_employees_tenant_active_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_tenant_active_not_deleted ON public.employees USING btree (tenant_id, is_deleted, status, branch_id);


--
-- Name: idx_employees_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_tenant_branch ON public.employees USING btree (tenant_id, branch_id);


--
-- Name: idx_expenses_pos_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_pos_shift ON public.expenses USING btree (tenant_id, source, shift_id);


--
-- Name: idx_expenses_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_tenant_date ON public.expenses USING btree (tenant_id, expense_date DESC, id DESC);


--
-- Name: idx_expenses_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_tenant_id ON public.expenses USING btree (tenant_id);


--
-- Name: idx_expenses_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_tenant_status ON public.expenses USING btree (tenant_id, status);


--
-- Name: idx_financial_account_entries_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_account_entries_account ON public.financial_account_entries USING btree (tenant_id, financial_account_id, created_at DESC);


--
-- Name: idx_financial_account_entries_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_account_entries_source ON public.financial_account_entries USING btree (tenant_id, source_type, source_id);


--
-- Name: idx_financial_account_transfers_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_account_transfers_tenant_created ON public.financial_account_transfers USING btree (tenant_id, created_at DESC);


--
-- Name: idx_financial_accounts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_accounts_branch ON public.financial_accounts USING btree (tenant_id, branch_id);


--
-- Name: idx_financial_accounts_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_accounts_tenant_type ON public.financial_accounts USING btree (tenant_id, account_type, is_active);


--
-- Name: idx_holidays_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_holidays_tenant_date ON public.holidays USING btree (tenant_id, holiday_date);


--
-- Name: idx_inventory_count_items_count_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_items_count_id ON public.inventory_count_items USING btree (inventory_count_id);


--
-- Name: idx_inventory_count_items_inventory_count_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_items_inventory_count_id ON public.inventory_count_items USING btree (inventory_count_id);


--
-- Name: idx_inventory_count_items_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_items_session_id ON public.inventory_count_items USING btree (inventory_count_session_id);


--
-- Name: idx_inventory_count_items_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_items_variant_id ON public.inventory_count_items USING btree (variant_id);


--
-- Name: idx_inventory_count_sessions_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_sessions_branch_id ON public.inventory_count_sessions USING btree (branch_id);


--
-- Name: idx_inventory_count_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_sessions_status ON public.inventory_count_sessions USING btree (status, created_at DESC, id DESC);


--
-- Name: idx_inventory_count_sessions_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_sessions_tenant_created ON public.inventory_count_sessions USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: idx_inventory_count_sessions_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_count_sessions_warehouse_id ON public.inventory_count_sessions USING btree (warehouse_id);


--
-- Name: idx_inventory_counts_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_counts_section_id ON public.inventory_counts USING btree (section_id);


--
-- Name: idx_inventory_counts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_counts_status ON public.inventory_counts USING btree (status);


--
-- Name: idx_inventory_movements_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_branch_id ON public.inventory_movements USING btree (branch_id);


--
-- Name: idx_inventory_movements_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_created_at ON public.inventory_movements USING btree (created_at);


--
-- Name: idx_inventory_movements_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_customer_id ON public.inventory_movements USING btree (customer_id);


--
-- Name: idx_inventory_movements_movement_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_movement_type ON public.inventory_movements USING btree (movement_type);


--
-- Name: idx_inventory_movements_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_product_id ON public.inventory_movements USING btree (product_id);


--
-- Name: idx_inventory_movements_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_reference ON public.inventory_movements USING btree (reference_type, reference_id);


--
-- Name: idx_inventory_movements_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_section_id ON public.inventory_movements USING btree (section_id);


--
-- Name: idx_inventory_movements_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_tenant_created ON public.inventory_movements USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: idx_inventory_movements_tenant_product_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_tenant_product_created ON public.inventory_movements USING btree (tenant_id, product_id, created_at DESC, id DESC);


--
-- Name: idx_inventory_movements_tenant_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_tenant_type_created ON public.inventory_movements USING btree (tenant_id, movement_type, created_at DESC, id DESC);


--
-- Name: idx_inventory_movements_tenant_variant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_tenant_variant_created ON public.inventory_movements USING btree (tenant_id, variant_id, created_at DESC, id DESC);


--
-- Name: idx_inventory_movements_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_variant_id ON public.inventory_movements USING btree (variant_id);


--
-- Name: idx_inventory_movements_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_warehouse_id ON public.inventory_movements USING btree (warehouse_id);


--
-- Name: idx_journal_entries_generated_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_journal_entries_generated_source ON public.journal_entries USING btree (tenant_id, reference_type, reference_id, entry_type) WHERE ((is_generated = true) AND (reference_type IS NOT NULL) AND (reference_id IS NOT NULL) AND (entry_type IS NOT NULL));


--
-- Name: idx_journal_entries_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_reference ON public.journal_entries USING btree (tenant_id, reference_type, reference_id);


--
-- Name: idx_journal_entries_tenant_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_tenant_created_at ON public.journal_entries USING btree (tenant_id, created_at);


--
-- Name: idx_journal_entry_lines_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_lines_account ON public.journal_entry_lines USING btree (account_id);


--
-- Name: idx_journal_entry_lines_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_lines_entry ON public.journal_entry_lines USING btree (journal_entry_id);


--
-- Name: idx_loyalty_rules_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_rules_tenant_id ON public.loyalty_rules USING btree (tenant_id);


--
-- Name: idx_loyalty_transactions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_customer ON public.loyalty_transactions USING btree (tenant_id, customer_id, created_at DESC);


--
-- Name: idx_loyalty_transactions_tenant_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_tenant_customer ON public.loyalty_transactions USING btree (tenant_id, customer_id, created_at DESC);


--
-- Name: idx_marketing_attribution_events_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_attribution_events_event_type ON public.marketing_attribution_events USING btree (event_type, created_at DESC);


--
-- Name: idx_marketing_attribution_events_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_attribution_events_tenant_created ON public.marketing_attribution_events USING btree (tenant_id, created_at DESC);


--
-- Name: idx_marketing_auto_reply_rules_business_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_auto_reply_rules_business_enabled ON public.marketing_auto_reply_rules USING btree (business_id, enabled, platform);


--
-- Name: idx_marketing_auto_reply_rules_business_name_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_auto_reply_rules_business_name_platform ON public.marketing_auto_reply_rules USING btree (business_id, platform, name);


--
-- Name: idx_marketing_automation_logs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_automation_logs_tenant_created ON public.marketing_automation_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_marketing_automation_logs_tenant_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_automation_logs_tenant_event ON public.marketing_automation_logs USING btree (tenant_id, event_type, created_at DESC);


--
-- Name: idx_marketing_automation_logs_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_automation_logs_tenant_status ON public.marketing_automation_logs USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_marketing_automation_settings_next_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_automation_settings_next_run ON public.marketing_automation_settings USING btree (enabled, next_run_at);


--
-- Name: idx_marketing_automation_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_automation_settings_tenant ON public.marketing_automation_settings USING btree (tenant_id);


--
-- Name: idx_marketing_brand_identity_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_brand_identity_tenant ON public.marketing_brand_identity USING btree (tenant_id);


--
-- Name: idx_marketing_comment_dm_logs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_comment_dm_logs_tenant_created ON public.marketing_comment_dm_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_marketing_comment_dm_rules_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_comment_dm_rules_tenant_active ON public.marketing_comment_dm_rules USING btree (tenant_id, is_active, platform);


--
-- Name: idx_marketing_comment_events_business_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_comment_events_business_created ON public.marketing_comment_events USING btree (business_id, created_at DESC);


--
-- Name: idx_marketing_comment_events_platform_comment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_comment_events_platform_comment ON public.marketing_comment_events USING btree (platform, comment_id);


--
-- Name: idx_marketing_content_drafts_tenant_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_content_drafts_tenant_schedule ON public.marketing_content_drafts USING btree (tenant_id, scheduled_at DESC);


--
-- Name: idx_marketing_content_drafts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_content_drafts_tenant_status ON public.marketing_content_drafts USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_marketing_conversations_business_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_conversations_business_updated ON public.marketing_conversations USING btree (business_id, updated_at DESC);


--
-- Name: idx_marketing_post_analytics_platform_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_post_analytics_platform_synced ON public.marketing_post_analytics USING btree (platform, synced_at DESC);


--
-- Name: idx_marketing_post_analytics_post_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_post_analytics_post_id ON public.marketing_post_analytics USING btree (post_id);


--
-- Name: idx_marketing_post_product_links_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_post_product_links_lookup ON public.marketing_post_product_links USING btree (business_id, platform, post_id, media_id);


--
-- Name: idx_marketing_post_product_links_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_post_product_links_unique ON public.marketing_post_product_links USING btree (business_id, platform, post_id, product_id);


--
-- Name: idx_marketing_post_templates_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_post_templates_default ON public.marketing_post_templates USING btree (tenant_id) WHERE (is_default = true);


--
-- Name: idx_marketing_posts_tenant_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_posts_tenant_channel ON public.marketing_posts USING btree (tenant_id, channel, created_at DESC);


--
-- Name: idx_marketing_posts_tenant_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_posts_tenant_schedule ON public.marketing_posts USING btree (tenant_id, scheduled_at DESC);


--
-- Name: idx_marketing_posts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_posts_tenant_status ON public.marketing_posts USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_marketing_story_campaigns_tenant_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_story_campaigns_tenant_product ON public.marketing_story_campaigns USING btree (tenant_id, product_id, created_at DESC);


--
-- Name: idx_marketing_story_campaigns_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_story_campaigns_tenant_status ON public.marketing_story_campaigns USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_marketing_story_exports_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_story_exports_campaign ON public.marketing_story_exports USING btree (tenant_id, story_campaign_id, created_at DESC);


--
-- Name: idx_marketing_story_triggers_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_marketing_story_triggers_active_unique ON public.marketing_story_trigger_suggestions USING btree (tenant_id, trigger_type, COALESCE(product_id, (0)::bigint), COALESCE(variant_id, (0)::bigint)) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'generated'::character varying])::text[]));


--
-- Name: idx_marketing_story_triggers_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_story_triggers_tenant_status ON public.marketing_story_trigger_suggestions USING btree (tenant_id, status, signal_score DESC, created_at DESC);


--
-- Name: idx_master_qr_models_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_master_qr_models_product_id ON public.master_qr_models USING btree (product_id);


--
-- Name: idx_master_qr_models_qr_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_master_qr_models_qr_value ON public.master_qr_models USING btree (qr_value);


--
-- Name: idx_meta_integration_ig; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_integration_ig ON public.meta_integration_configs USING btree (instagram_business_account_id);


--
-- Name: idx_meta_integration_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_integration_page ON public.meta_integration_configs USING btree (facebook_page_id);


--
-- Name: idx_meta_integration_verify; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_integration_verify ON public.meta_integration_configs USING btree (verify_token);


--
-- Name: idx_meta_oauth_states_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_states_state ON public.meta_oauth_states USING btree (state_token);


--
-- Name: idx_meta_oauth_states_tenant_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_states_tenant_user_created ON public.meta_oauth_states USING btree (tenant_id, user_id, created_at DESC);


--
-- Name: idx_money_accounts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_accounts_branch ON public.money_accounts USING btree (tenant_id, branch_id);


--
-- Name: idx_money_accounts_financial_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_accounts_financial_account ON public.money_accounts USING btree (tenant_id, financial_account_id);


--
-- Name: idx_money_accounts_tenant_name_branch_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_money_accounts_tenant_name_branch_unique ON public.money_accounts USING btree (tenant_id, lower((name)::text), COALESCE(branch_id, (0)::bigint));


--
-- Name: idx_money_accounts_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_accounts_tenant_type ON public.money_accounts USING btree (tenant_id, type, is_active);


--
-- Name: idx_money_transactions_account_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_transactions_account_created ON public.money_transactions USING btree (tenant_id, account_id, created_at DESC);


--
-- Name: idx_money_transactions_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_transactions_filters ON public.money_transactions USING btree (tenant_id, transaction_type, reference_type, branch_id, created_at DESC);


--
-- Name: idx_money_transactions_idempotent_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_transactions_idempotent_reference ON public.money_transactions USING btree (tenant_id, account_id, reference_type, reference_id, transaction_type, direction) WHERE ((reference_type IS NOT NULL) AND (reference_id IS NOT NULL) AND (reversal_of IS NULL));


--
-- Name: idx_money_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_money_transactions_reference ON public.money_transactions USING btree (tenant_id, reference_type, reference_id);


--
-- Name: idx_notifications_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_branch_id ON public.notifications USING btree (branch_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_entity ON public.notifications USING btree (entity_type, entity_id);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_priority ON public.notifications USING btree (priority);


--
-- Name: idx_notifications_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_tenant_created ON public.notifications USING btree (tenant_id, created_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_order_edit_audits_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_edit_audits_order ON public.order_edit_audits USING btree (order_id, created_at DESC);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_order_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id_id ON public.order_items USING btree (order_id, id);


--
-- Name: idx_order_items_product_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_order ON public.order_items USING btree (product_id, order_id);


--
-- Name: idx_order_items_tenant_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_tenant_order ON public.order_items USING btree (tenant_id, order_id);


--
-- Name: idx_order_items_tenant_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_tenant_order_id ON public.order_items USING btree (tenant_id, order_id, id);


--
-- Name: idx_order_items_variant_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_variant_order ON public.order_items USING btree (variant_id, order_id);


--
-- Name: idx_order_reprint_logs_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_reprint_logs_order ON public.order_reprint_logs USING btree (order_id, created_at DESC);


--
-- Name: idx_orders_ai_agent_intent_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_ai_agent_intent_dedupe ON public.orders USING btree (tenant_id, ai_agent_conversation_id, ai_agent_intent_hash) WHERE ((ai_agent_conversation_id IS NOT NULL) AND (ai_agent_intent_hash IS NOT NULL));


--
-- Name: idx_orders_ai_agent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_ai_agent_status ON public.orders USING btree (tenant_id, ai_agent_status, created_at DESC);


--
-- Name: idx_orders_attendance_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_attendance_tenant ON public.orders USING btree (attendance_log_id, tenant_id);


--
-- Name: idx_orders_branch_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_branch_created ON public.orders USING btree (branch_id, created_at DESC);


--
-- Name: idx_orders_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_channel_created ON public.orders USING btree (channel, created_at DESC);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_display_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_display_order_number ON public.orders USING btree (display_order_number);


--
-- Name: idx_orders_id_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_id_tenant ON public.orders USING btree (id, tenant_id);


--
-- Name: idx_orders_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_invoice_number ON public.orders USING btree (invoice_number);


--
-- Name: idx_orders_phone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_phone_created ON public.orders USING btree (customer_phone, created_at DESC);


--
-- Name: idx_orders_public_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_public_order_number ON public.orders USING btree (public_order_number);


--
-- Name: idx_orders_public_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_public_token_unique ON public.orders USING btree (public_token) WHERE (public_token IS NOT NULL);


--
-- Name: idx_orders_sales_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_sales_employee_created ON public.orders USING btree (tenant_id, sales_employee_id, created_at DESC);


--
-- Name: idx_orders_salesperson_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_salesperson_created ON public.orders USING btree (tenant_id, salesperson_id, created_at DESC);


--
-- Name: idx_orders_seller_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_seller_user_created ON public.orders USING btree (tenant_id, seller_user_id, created_at DESC);


--
-- Name: idx_orders_shift_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shift_tenant_created ON public.orders USING btree (tenant_id, shift_id, created_at DESC);


--
-- Name: idx_orders_source_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_source_created ON public.orders USING btree (source, created_at DESC);


--
-- Name: idx_orders_tenant_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_channel_created ON public.orders USING btree (tenant_id, channel, created_at DESC, id DESC);


--
-- Name: idx_orders_tenant_channel_created_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_channel_created_id ON public.orders USING btree (tenant_id, channel, created_at DESC, id DESC);


--
-- Name: idx_orders_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_created ON public.orders USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: idx_orders_tenant_created_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_created_id ON public.orders USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: idx_orders_tenant_customer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_customer_created ON public.orders USING btree (tenant_id, customer_id, created_at DESC);


--
-- Name: idx_orders_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_id ON public.orders USING btree (tenant_id);


--
-- Name: idx_orders_tenant_source_created_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_source_created_id ON public.orders USING btree (tenant_id, source, created_at DESC, id DESC);


--
-- Name: idx_orders_unique_tenant_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_unique_tenant_invoice_number ON public.orders USING btree (COALESCE(tenant_id, (0)::bigint), invoice_number) WHERE ((invoice_number IS NOT NULL) AND ((invoice_number)::text <> ''::text));


--
-- Name: idx_orders_whatsapp_confirmation_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_whatsapp_confirmation_pending ON public.orders USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_orders_whatsapp_confirmation_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_whatsapp_confirmation_phone ON public.orders USING btree (customer_phone, created_at DESC);


--
-- Name: idx_payment_method_mapping_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_method_mapping_default ON public.payment_method_account_mappings USING btree (tenant_id, payment_method) WHERE ((is_active = true) AND (is_default = true) AND (branch_id IS NULL));


--
-- Name: idx_payment_method_mapping_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_method_mapping_unique ON public.payment_method_account_mappings USING btree (tenant_id, payment_method, COALESCE(branch_id, (0)::bigint)) WHERE (is_active = true);


--
-- Name: idx_payment_transaction_events_provider_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_transaction_events_provider_event ON public.payment_transaction_events USING btree (provider, provider_event_id) WHERE ((provider_event_id IS NOT NULL) AND (provider_event_id <> ''::text));


--
-- Name: idx_payment_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_order ON public.payment_transactions USING btree (tenant_id, order_id, created_at DESC);


--
-- Name: idx_payment_transactions_provider_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_provider_order ON public.payment_transactions USING btree (provider, provider_order_id);


--
-- Name: idx_payment_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_transactions_reference ON public.payment_transactions USING btree (provider, transaction_reference) WHERE ((transaction_reference IS NOT NULL) AND (transaction_reference <> ''::text));


--
-- Name: idx_permissions_module_action_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_permissions_module_action_unique ON public.permissions USING btree (module, action);


--
-- Name: idx_portal_push_subscriptions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_push_subscriptions_lookup ON public.portal_push_subscriptions USING btree (portal_type, portal_token, revoked_at);


--
-- Name: idx_portal_push_subscriptions_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_push_subscriptions_scope ON public.portal_push_subscriptions USING btree (portal_type, tenant_id, branch_id, revoked_at);


--
-- Name: idx_pos_orders_cashier_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_orders_cashier_user_id ON public.orders USING btree (cashier_user_id);


--
-- Name: idx_pos_orders_seller_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_orders_seller_user_id ON public.orders USING btree (seller_user_id);


--
-- Name: idx_pos_orders_shift_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_orders_shift_id ON public.orders USING btree (shift_id);


--
-- Name: idx_pos_shifts_user_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_shifts_user_branch_status ON public.cash_drawer_shifts USING btree (opened_by_user_id, branch_id, status);


--
-- Name: idx_product_audiences_audience; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_audiences_audience ON public.product_audiences USING btree (audience, product_id);


--
-- Name: idx_product_audiences_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_audiences_product_id ON public.product_audiences USING btree (product_id);


--
-- Name: idx_product_classification_groups_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_classification_groups_sort ON public.product_classification_groups USING btree (sort_order, id);


--
-- Name: idx_product_classification_options_group_normalized_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_product_classification_options_group_normalized_value ON public.product_classification_options USING btree (group_id, lower(TRIM(BOTH FROM value)));


--
-- Name: idx_product_classification_options_group_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_classification_options_group_sort ON public.product_classification_options USING btree (group_id, sort_order, id);


--
-- Name: idx_product_variant_images_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_primary ON public.product_variant_images USING btree (product_id, color_name, is_primary);


--
-- Name: idx_product_variant_images_product_color; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_product_color ON public.product_variant_images USING btree (product_id, color_name, sort_order, id);


--
-- Name: idx_product_variant_images_tenant_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_tenant_primary ON public.product_variant_images USING btree (tenant_id, product_id, color_name, is_primary);


--
-- Name: idx_product_variant_images_tenant_product_color; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_tenant_product_color ON public.product_variant_images USING btree (tenant_id, product_id, color_name, sort_order, id);


--
-- Name: idx_product_variant_images_tenant_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_tenant_variant ON public.product_variant_images USING btree (tenant_id, variant_id, sort_order, id);


--
-- Name: idx_product_variant_images_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variant_images_variant ON public.product_variant_images USING btree (variant_id, sort_order, id);


--
-- Name: idx_product_variants_active_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_active_deleted ON public.product_variants USING btree (tenant_id, is_active, deleted_at, id DESC);


--
-- Name: idx_product_variants_active_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_active_product ON public.product_variants USING btree (product_id, is_active, deleted_at, id);


--
-- Name: idx_product_variants_article_code_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_article_code_lower ON public.product_variants USING btree (lower(TRIM(BOTH FROM article_code))) WHERE ((article_code IS NOT NULL) AND (TRIM(BOTH FROM article_code) <> ''::text));


--
-- Name: idx_product_variants_barcode_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_barcode_lower ON public.product_variants USING btree (lower((barcode)::text));


--
-- Name: idx_product_variants_barcode_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_barcode_perf ON public.product_variants USING btree (barcode);


--
-- Name: idx_product_variants_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_id ON public.product_variants USING btree (id);


--
-- Name: idx_product_variants_product_color_size; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_color_size ON public.product_variants USING btree (product_id, color, size);


--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id, id);


--
-- Name: idx_product_variants_product_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_stock ON public.product_variants USING btree (product_id, stock, id);


--
-- Name: idx_product_variants_purchase_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_purchase_pack ON public.product_variants USING btree (purchase_pack_type, purchase_pack_qty);


--
-- Name: idx_product_variants_sku_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_sku_lower ON public.product_variants USING btree (lower((sku)::text));


--
-- Name: idx_product_variants_sku_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_sku_perf ON public.product_variants USING btree (sku);


--
-- Name: idx_product_variants_stock_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_stock_product ON public.product_variants USING btree (stock, product_id, id);


--
-- Name: idx_product_variants_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_supplier ON public.product_variants USING btree (supplier_id);


--
-- Name: idx_product_variants_tenant_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_tenant_product_id ON public.product_variants USING btree (tenant_id, product_id, id);


--
-- Name: idx_product_variants_tenant_product_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_tenant_product_stock ON public.product_variants USING btree (tenant_id, product_id, stock, id);


--
-- Name: idx_products_barcode_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_barcode_lower ON public.products USING btree (lower((barcode)::text));


--
-- Name: idx_products_barcode_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_barcode_perf ON public.products USING btree (barcode);


--
-- Name: idx_products_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand_id ON public.products USING btree (brand_id);


--
-- Name: idx_products_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);


--
-- Name: idx_products_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_gender ON public.products USING btree (gender);


--
-- Name: idx_products_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_grade ON public.products USING btree (grade);


--
-- Name: idx_products_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_id ON public.products USING btree (id);


--
-- Name: idx_products_product_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_product_type ON public.products USING btree (product_type);


--
-- Name: idx_products_sku_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_lower ON public.products USING btree (lower((sku)::text));


--
-- Name: idx_products_sku_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_perf ON public.products USING btree (sku);


--
-- Name: idx_products_storefront_active_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_storefront_active_tenant_id ON public.products USING btree (tenant_id, id DESC) WHERE (COALESCE(NULLIF(lower(TRIM(BOTH FROM status)), ''::text), 'active'::text) <> ALL (ARRAY['inactive'::text, 'disabled'::text, 'archived'::text, 'deleted'::text, 'draft'::text]));


--
-- Name: idx_products_storefront_canonical_slug_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_storefront_canonical_slug_lower ON public.products USING btree (lower(TRIM(BOTH FROM canonical_slug))) WHERE ((canonical_slug IS NOT NULL) AND (TRIM(BOTH FROM canonical_slug) <> ''::text));


--
-- Name: idx_products_storefront_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_storefront_filters ON public.products USING btree (tenant_id, gender, product_type, style, grade, id DESC) WHERE (COALESCE(NULLIF(lower(TRIM(BOTH FROM status)), ''::text), 'active'::text) <> ALL (ARRAY['inactive'::text, 'disabled'::text, 'archived'::text, 'deleted'::text, 'draft'::text]));


--
-- Name: idx_products_storefront_slug_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_storefront_slug_lower ON public.products USING btree (lower(TRIM(BOTH FROM slug))) WHERE ((slug IS NOT NULL) AND (TRIM(BOTH FROM slug) <> ''::text));


--
-- Name: idx_products_style; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_style ON public.products USING btree (style);


--
-- Name: idx_products_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_id ON public.products USING btree (tenant_id);


--
-- Name: idx_products_tenant_id_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_id_desc ON public.products USING btree (tenant_id, id DESC);


--
-- Name: idx_products_tenant_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_status_id ON public.products USING btree (tenant_id, status, id DESC);


--
-- Name: idx_purchase_items_purchase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_items_purchase_id ON public.purchase_items USING btree (purchase_id);


--
-- Name: idx_purchases_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_id ON public.purchases USING btree (id);


--
-- Name: idx_purchases_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_tenant_id ON public.purchases USING btree (tenant_id);


--
-- Name: idx_recently_viewed_tenant_phone_viewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recently_viewed_tenant_phone_viewed ON public.recently_viewed_products USING btree (tenant_id, phone, viewed_at DESC);


--
-- Name: idx_recently_viewed_tenant_product_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recently_viewed_tenant_product_lookup ON public.recently_viewed_products USING btree (tenant_id, product_id, phone, session_id);


--
-- Name: idx_recently_viewed_tenant_session_viewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recently_viewed_tenant_session_viewed ON public.recently_viewed_products USING btree (tenant_id, session_id, viewed_at DESC);


--
-- Name: idx_recurring_expenses_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_expenses_due ON public.recurring_expenses USING btree (tenant_id, is_active, next_due_date);


--
-- Name: idx_role_permissions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_role_permissions_unique ON public.role_permissions USING btree (role_id, permission_id);


--
-- Name: idx_roles_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_tenant_id ON public.roles USING btree (tenant_id);


--
-- Name: idx_sales_employees_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_employees_branch_id ON public.sales_employees USING btree (branch_id);


--
-- Name: idx_sales_employees_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_employees_employee_id ON public.sales_employees USING btree (employee_id);


--
-- Name: idx_sales_employees_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_employees_tenant_active ON public.sales_employees USING btree (tenant_id, is_active, name);


--
-- Name: idx_sales_employees_tenant_branch_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_employees_tenant_branch_active ON public.sales_employees USING btree (tenant_id, branch_id, is_active, name);


--
-- Name: idx_sales_opportunities_scope_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_opportunities_scope_status ON public.sales_opportunities USING btree (tenant_id, branch_id, is_active, expires_at DESC, created_at DESC);


--
-- Name: idx_sales_opportunities_variant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_opportunities_variant_type ON public.sales_opportunities USING btree (tenant_id, product_variant_id, type);


--
-- Name: idx_shift_opening_assignments_attendance_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_shift_opening_assignments_attendance_unique ON public.shift_opening_assignments USING btree (attendance_log_id) WHERE (attendance_log_id IS NOT NULL);


--
-- Name: idx_shift_opening_assignments_tenant_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_opening_assignments_tenant_assigned ON public.shift_opening_assignments USING btree (tenant_id, assigned_at DESC);


--
-- Name: idx_shift_opening_assignments_tenant_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_opening_assignments_tenant_employee ON public.shift_opening_assignments USING btree (tenant_id, employee_id, assigned_at DESC);


--
-- Name: idx_shipping_cities_provider_dropoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_cities_provider_dropoff ON public.shipping_cities USING btree (provider_id, dropoff_available);


--
-- Name: idx_shipping_districts_zone_dropoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_districts_zone_dropoff ON public.shipping_districts USING btree (zone_id, dropoff_available);


--
-- Name: idx_shipping_events_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_events_order_id ON public.shipping_events USING btree (order_id, created_at DESC);


--
-- Name: idx_shipping_events_provider_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_shipping_events_provider_event_key ON public.shipping_events USING btree (provider, event_key) WHERE ((event_key IS NOT NULL) AND (event_key <> ''::text));


--
-- Name: idx_shipping_zones_city_dropoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_zones_city_dropoff ON public.shipping_zones USING btree (city_id, dropoff_available);


--
-- Name: idx_staff_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_task_comments_task ON public.staff_task_comments USING btree (task_id, created_at DESC);


--
-- Name: idx_staff_task_history_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_task_history_task ON public.staff_task_history USING btree (task_id, created_at DESC);


--
-- Name: idx_staff_task_queue_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_staff_task_queue_dedupe ON public.staff_task_notification_queue USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: idx_staff_task_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_task_queue_status ON public.staff_task_notification_queue USING btree (status, next_attempt_at);


--
-- Name: idx_staff_tasks_assignee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_assignee_status ON public.staff_task_assignments USING btree (current_assignee_id, status, due_at);


--
-- Name: idx_staff_tasks_branch_date_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_branch_date_source ON public.staff_task_assignments USING btree (tenant_id, branch_id, assigned_date, source_module, task_type);


--
-- Name: idx_staff_tasks_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_branch_status ON public.staff_task_assignments USING btree (branch_id, status, due_at);


--
-- Name: idx_staff_tasks_daily_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_staff_tasks_daily_dedupe ON public.staff_task_assignments USING btree (COALESCE(tenant_id, (0)::bigint), assigned_date, task_type, COALESCE(current_assignee_id, (0)::bigint), COALESCE(source_ref_type, ''::character varying), COALESCE(source_ref_id, ''::character varying)) WHERE ((status)::text <> 'cancelled'::text);


--
-- Name: idx_staff_tasks_daily_source_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_staff_tasks_daily_source_dedupe ON public.staff_task_assignments USING btree (COALESCE(tenant_id, (0)::bigint), assigned_date, task_type, COALESCE(source_ref_type, ''::character varying), COALESCE(source_ref_id, ''::character varying)) WHERE (((status)::text <> 'cancelled'::text) AND (source_ref_type IS NOT NULL) AND (source_ref_id IS NOT NULL));


--
-- Name: idx_staff_tasks_employee_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_employee_status_due ON public.staff_task_assignments USING btree (tenant_id, assigned_employee_id, status, due_at);


--
-- Name: idx_staff_tasks_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_source ON public.staff_task_assignments USING btree (source_ref_type, source_ref_id);


--
-- Name: idx_staff_tasks_template_due_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_staff_tasks_template_due_dedupe ON public.staff_task_assignments USING btree (template_id, source_ref_date) WHERE ((template_id IS NOT NULL) AND (source_ref_date IS NOT NULL) AND ((status)::text <> 'cancelled'::text));


--
-- Name: idx_staff_tasks_tenant_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_tasks_tenant_status_due ON public.staff_task_assignments USING btree (tenant_id, status, due_at);


--
-- Name: idx_storefront_customer_events_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storefront_customer_events_tenant_type ON public.storefront_customer_events USING btree (tenant_id, event_type, created_at DESC);


--
-- Name: idx_storefront_customer_sessions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storefront_customer_sessions_customer ON public.storefront_customer_sessions USING btree (tenant_id, customer_id, updated_at DESC);


--
-- Name: idx_storefront_products_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_storefront_products_qr_token ON public.products USING btree (qr_token) WHERE ((qr_token IS NOT NULL) AND (qr_token <> ''::text));


--
-- Name: idx_suppliers_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_deleted_at ON public.suppliers USING btree (deleted_at);


--
-- Name: idx_suppliers_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_search ON public.suppliers USING btree (tenant_id, supplier_code, name, phone, email);


--
-- Name: idx_suppliers_supplier_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_suppliers_supplier_code_unique ON public.suppliers USING btree (supplier_code) WHERE (supplier_code IS NOT NULL);


--
-- Name: idx_suppliers_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_tenant_id ON public.suppliers USING btree (tenant_id);


--
-- Name: idx_suppliers_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_tenant_status ON public.suppliers USING btree (tenant_id, status);


--
-- Name: idx_system_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_category ON public.system_settings USING btree (category);


--
-- Name: idx_system_settings_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_public ON public.system_settings USING btree (is_public);


--
-- Name: idx_transactions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_tenant_id ON public.transactions USING btree (tenant_id);


--
-- Name: idx_users_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);


--
-- Name: idx_variants_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_tenant_id ON public.product_variants USING btree (tenant_id);


--
-- Name: idx_wallet_transactions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_transactions_customer ON public.wallet_transactions USING btree (tenant_id, customer_id, created_at DESC);


--
-- Name: idx_warehouse_inventory_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warehouse_inventory_branch_id ON public.warehouse_inventory USING btree (branch_id);


--
-- Name: idx_warehouse_inventory_section_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warehouse_inventory_section_id ON public.warehouse_inventory USING btree (section_id);


--
-- Name: idx_warehouse_sections_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warehouse_sections_barcode ON public.warehouse_sections USING btree (barcode);


--
-- Name: idx_warehouse_sections_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warehouse_sections_branch_id ON public.warehouse_sections USING btree (branch_id);


--
-- Name: idx_warehouse_sections_scope_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_warehouse_sections_scope_code ON public.warehouse_sections USING btree (COALESCE(tenant_id, (0)::bigint), COALESCE(warehouse_id, (0)::bigint), code);


--
-- Name: idx_warehouse_sections_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warehouse_sections_warehouse_id ON public.warehouse_sections USING btree (warehouse_id);


--
-- Name: idx_warehouses_qr_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_warehouses_qr_token ON public.warehouses USING btree (qr_token);


--
-- Name: idx_website_notifications_tenant_phone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_website_notifications_tenant_phone_created ON public.website_notifications USING btree (tenant_id, phone, created_at DESC);


--
-- Name: idx_website_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_website_settings_tenant ON public.website_settings USING btree (tenant_id);


--
-- Name: manufacturers_name_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX manufacturers_name_unique_idx ON public.manufacturers USING btree (lower((name)::text));


--
-- Name: product_variant_images_unique_tenant_variant_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_variant_images_unique_tenant_variant_url ON public.product_variant_images USING btree (tenant_id, product_id, COALESCE(variant_id, (0)::bigint), lower(TRIM(BOTH FROM color_name)), lower(TRIM(BOTH FROM image_url))) WHERE (TRIM(BOTH FROM image_url) <> ''::text);


--
-- Name: products_qr_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_qr_token_unique ON public.products USING btree (qr_token) WHERE (qr_token IS NOT NULL);


--
-- Name: purchases_tenant_client_request_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchases_tenant_client_request_uidx ON public.purchases USING btree (tenant_id, client_request_id) WHERE ((client_request_id IS NOT NULL) AND ((client_request_id)::text <> ''::text));


--
-- Name: purchases_tenant_purchase_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchases_tenant_purchase_number_uidx ON public.purchases USING btree (tenant_id, purchase_number) WHERE ((purchase_number IS NOT NULL) AND ((purchase_number)::text <> ''::text) AND ((purchase_number)::text <> 'PO-PENDING'::text));


--
-- Name: purchases_tenant_purchase_save_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchases_tenant_purchase_save_uidx ON public.purchases USING btree (tenant_id, purchase_save_id) WHERE ((purchase_save_id IS NOT NULL) AND ((purchase_save_id)::text <> ''::text));


--
-- Name: uq_display_refill_pending_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_display_refill_pending_active ON public.employee_display_refill_alerts USING btree (COALESCE(tenant_id, (0)::bigint), COALESCE(product_id, (0)::bigint), COALESCE(branch_id, (0)::bigint), lower((COALESCE(color_name, ''::character varying))::text), lower((COALESCE(sold_size, ''::character varying))::text)) WHERE ((status)::text = 'pending'::text);


--
-- Name: uq_sales_opportunities_active_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sales_opportunities_active_scope ON public.sales_opportunities USING btree (tenant_id, COALESCE(branch_id, (0)::bigint), product_variant_id, type) WHERE (is_active = true);


--
-- Name: accounts trg_single_branch_accounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_accounts BEFORE INSERT OR UPDATE OF branch_id ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: attendance_device_bindings trg_single_branch_attendance_device_bindings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_attendance_device_bindings BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_device_bindings FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: attendance_events trg_single_branch_attendance_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_attendance_events BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_events FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: attendance_logs trg_single_branch_attendance_logs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_attendance_logs BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_logs FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: attendance_suspicious_activity_logs trg_single_branch_attendance_suspicious_activity_logs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_attendance_suspicious_activity_logs BEFORE INSERT OR UPDATE OF branch_id ON public.attendance_suspicious_activity_logs FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: cash_drawer_shifts trg_single_branch_cash_drawer_shifts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_cash_drawer_shifts BEFORE INSERT OR UPDATE OF branch_id ON public.cash_drawer_shifts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: customers trg_single_branch_customers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_customers BEFORE INSERT OR UPDATE OF branch_id ON public.customers FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employee_chat_threads trg_single_branch_employee_chat_threads; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employee_chat_threads BEFORE INSERT OR UPDATE OF branch_id ON public.employee_chat_threads FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employee_commissions trg_single_branch_employee_commissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employee_commissions BEFORE INSERT OR UPDATE OF branch_id ON public.employee_commissions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employee_display_refill_alerts trg_single_branch_employee_display_refill_alerts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employee_display_refill_alerts BEFORE INSERT OR UPDATE OF branch_id ON public.employee_display_refill_alerts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employee_portal_sessions trg_single_branch_employee_portal_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employee_portal_sessions BEFORE INSERT OR UPDATE OF branch_id ON public.employee_portal_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employee_sales trg_single_branch_employee_sales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employee_sales BEFORE INSERT OR UPDATE OF branch_id ON public.employee_sales FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: employees trg_single_branch_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_employees BEFORE INSERT OR UPDATE OF branch_id ON public.employees FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: expenses trg_single_branch_expenses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_expenses BEFORE INSERT OR UPDATE OF branch_id ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: financial_accounts trg_single_branch_financial_accounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_financial_accounts BEFORE INSERT OR UPDATE OF branch_id ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: inventory_count_sessions trg_single_branch_inventory_count_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_inventory_count_sessions BEFORE INSERT OR UPDATE OF branch_id ON public.inventory_count_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: inventory_counts trg_single_branch_inventory_counts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_inventory_counts BEFORE INSERT OR UPDATE OF branch_id ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: inventory_movements trg_single_branch_inventory_movements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_inventory_movements BEFORE INSERT OR UPDATE OF branch_id ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: journal_entries trg_single_branch_journal_entries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_journal_entries BEFORE INSERT OR UPDATE OF branch_id ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: journal_entry_lines trg_single_branch_journal_entry_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_journal_entry_lines BEFORE INSERT OR UPDATE OF branch_id ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: marketing_auto_reply_rules trg_single_branch_marketing_auto_reply_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_marketing_auto_reply_rules BEFORE INSERT OR UPDATE OF branch_id ON public.marketing_auto_reply_rules FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: marketing_story_campaigns trg_single_branch_marketing_story_campaigns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_marketing_story_campaigns BEFORE INSERT OR UPDATE OF branch_id ON public.marketing_story_campaigns FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: marketing_story_exports trg_single_branch_marketing_story_exports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_marketing_story_exports BEFORE INSERT OR UPDATE OF branch_id ON public.marketing_story_exports FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: marketing_story_trigger_suggestions trg_single_branch_marketing_story_trigger_suggestions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_marketing_story_trigger_suggestions BEFORE INSERT OR UPDATE OF branch_id ON public.marketing_story_trigger_suggestions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: money_accounts trg_single_branch_money_accounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_money_accounts BEFORE INSERT OR UPDATE OF branch_id ON public.money_accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: money_transactions trg_single_branch_money_transactions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_money_transactions BEFORE INSERT OR UPDATE OF branch_id ON public.money_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: notifications trg_single_branch_notifications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_notifications BEFORE INSERT OR UPDATE OF branch_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: orders trg_single_branch_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_orders BEFORE INSERT OR UPDATE OF branch_id ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: payment_method_account_mappings trg_single_branch_payment_method_account_mappings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_payment_method_account_mappings BEFORE INSERT OR UPDATE OF branch_id ON public.payment_method_account_mappings FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: payment_transactions trg_single_branch_payment_transactions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_payment_transactions BEFORE INSERT OR UPDATE OF branch_id ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: portal_push_subscriptions trg_single_branch_portal_push_subscriptions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_portal_push_subscriptions BEFORE INSERT OR UPDATE OF branch_id ON public.portal_push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: product_variants trg_single_branch_product_variants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_product_variants BEFORE INSERT OR UPDATE OF branch_id ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: recurring_expenses trg_single_branch_recurring_expenses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_recurring_expenses BEFORE INSERT OR UPDATE OF branch_id ON public.recurring_expenses FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: sales_employees trg_single_branch_sales_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_sales_employees BEFORE INSERT OR UPDATE OF branch_id ON public.sales_employees FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: sales_opportunities trg_single_branch_sales_opportunities; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_sales_opportunities BEFORE INSERT OR UPDATE OF branch_id ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: staff_task_assignments trg_single_branch_staff_task_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_staff_task_assignments BEFORE INSERT OR UPDATE OF branch_id ON public.staff_task_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: staff_task_templates trg_single_branch_staff_task_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_staff_task_templates BEFORE INSERT OR UPDATE OF branch_id ON public.staff_task_templates FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: warehouse_inventory trg_single_branch_warehouse_inventory; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_warehouse_inventory BEFORE INSERT OR UPDATE OF branch_id ON public.warehouse_inventory FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: warehouse_sections trg_single_branch_warehouse_sections; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_branch_warehouse_sections BEFORE INSERT OR UPDATE OF branch_id ON public.warehouse_sections FOR EACH ROW EXECUTE FUNCTION public.enforce_single_system_branch_id();


--
-- Name: accounting_audit_logs accounting_audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_audit_logs
    ADD CONSTRAINT accounting_audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: accounting_audit_logs accounting_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_audit_logs
    ADD CONSTRAINT accounting_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: accounting_order_item_cost_overrides accounting_order_item_cost_overrides_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_order_item_cost_overrides
    ADD CONSTRAINT accounting_order_item_cost_overrides_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: accounts accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: accounts accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_customer_interactions ai_customer_interactions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_interactions
    ADD CONSTRAINT ai_customer_interactions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.ai_customer_profiles(id) ON DELETE SET NULL;


--
-- Name: ai_customer_memories ai_customer_memories_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_customer_memories
    ADD CONSTRAINT ai_customer_memories_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.ai_customer_profiles(id) ON DELETE CASCADE;


--
-- Name: ai_followup_tasks ai_followup_tasks_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_followup_tasks
    ADD CONSTRAINT ai_followup_tasks_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.ai_customer_profiles(id) ON DELETE SET NULL;


--
-- Name: ai_marketing_content_queue ai_marketing_content_queue_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_queue
    ADD CONSTRAINT ai_marketing_content_queue_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: ai_marketing_content_queue ai_marketing_content_queue_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_queue
    ADD CONSTRAINT ai_marketing_content_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_marketing_content_queue ai_marketing_content_queue_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_queue
    ADD CONSTRAINT ai_marketing_content_queue_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: ai_marketing_content_timeline ai_marketing_content_timeline_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_timeline
    ADD CONSTRAINT ai_marketing_content_timeline_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES public.ai_marketing_content_queue(id) ON DELETE SET NULL;


--
-- Name: ai_marketing_content_timeline ai_marketing_content_timeline_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_content_timeline
    ADD CONSTRAINT ai_marketing_content_timeline_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_marketing_generation_runs ai_marketing_generation_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_generation_runs
    ADD CONSTRAINT ai_marketing_generation_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_marketing_insights_cache ai_marketing_insights_cache_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_insights_cache
    ADD CONSTRAINT ai_marketing_insights_cache_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_marketing_performance_snapshots ai_marketing_performance_snapshots_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_performance_snapshots
    ADD CONSTRAINT ai_marketing_performance_snapshots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_marketing_settings ai_marketing_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_marketing_settings
    ADD CONSTRAINT ai_marketing_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_support_messages ai_support_messages_session_ref_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_support_messages
    ADD CONSTRAINT ai_support_messages_session_ref_id_fkey FOREIGN KEY (session_ref_id) REFERENCES public.ai_support_sessions(id) ON DELETE CASCADE;


--
-- Name: attendance_device_bindings attendance_device_bindings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: attendance_device_bindings attendance_device_bindings_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_device_bindings attendance_device_bindings_first_attendance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_first_attendance_log_id_fkey FOREIGN KEY (first_attendance_log_id) REFERENCES public.attendance_logs(id) ON DELETE SET NULL;


--
-- Name: attendance_device_bindings attendance_device_bindings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_bindings
    ADD CONSTRAINT attendance_device_bindings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: attendance_device_settings attendance_device_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_device_settings
    ADD CONSTRAINT attendance_device_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: attendance_events attendance_events_attendance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_attendance_log_id_fkey FOREIGN KEY (attendance_log_id) REFERENCES public.attendance_logs(id) ON DELETE SET NULL;


--
-- Name: attendance_events attendance_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: attendance_events attendance_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.employee_attendance_devices(id) ON DELETE SET NULL;


--
-- Name: attendance_events attendance_events_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_events attendance_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: attendance_logs attendance_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL NOT VALID;


--
-- Name: attendance_logs attendance_logs_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance_logs attendance_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_logs attendance_logs_next_opening_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_next_opening_employee_id_fkey FOREIGN KEY (next_opening_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: attendance_logs attendance_logs_selected_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_selected_shift_id_fkey FOREIGN KEY (selected_shift_id) REFERENCES public.employee_shifts(id) ON DELETE SET NULL;


--
-- Name: attendance_logs attendance_logs_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.employee_shifts(id) ON DELETE SET NULL;


--
-- Name: attendance_logs attendance_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_logs
    ADD CONSTRAINT attendance_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: attendance_suspicious_activity_logs attendance_suspicious_activity_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_suspicious_activity_logs
    ADD CONSTRAINT attendance_suspicious_activity_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: attendance_suspicious_activity_logs attendance_suspicious_activity_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_suspicious_activity_logs
    ADD CONSTRAINT attendance_suspicious_activity_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: attendance_suspicious_activity_logs attendance_suspicious_activity_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_suspicious_activity_logs
    ADD CONSTRAINT attendance_suspicious_activity_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: branches branches_default_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_default_warehouse_id_fkey FOREIGN KEY (default_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cash_drawer_shift_events cash_drawer_shift_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shift_events
    ADD CONSTRAINT cash_drawer_shift_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cash_drawer_shift_events cash_drawer_shift_events_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shift_events
    ADD CONSTRAINT cash_drawer_shift_events_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.cash_drawer_shifts(id) ON DELETE CASCADE;


--
-- Name: cash_drawer_shift_events cash_drawer_shift_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shift_events
    ADD CONSTRAINT cash_drawer_shift_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_opened_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_opened_by_user_id_fkey FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: cash_drawer_shifts cash_drawer_shifts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_drawer_shifts
    ADD CONSTRAINT cash_drawer_shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cashbox cashbox_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox
    ADD CONSTRAINT cashbox_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cashbox_movements cashbox_movements_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox_movements
    ADD CONSTRAINT cashbox_movements_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashbox(id) ON DELETE CASCADE;


--
-- Name: cashbox_movements cashbox_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox_movements
    ADD CONSTRAINT cashbox_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cashbox_movements cashbox_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox_movements
    ADD CONSTRAINT cashbox_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cashbox cashbox_next_opening_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbox
    ADD CONSTRAINT cashbox_next_opening_employee_id_fkey FOREIGN KEY (next_opening_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: company_profiles company_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: coupon_redemptions coupon_redemptions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.coupon_campaigns(id) ON DELETE CASCADE;


--
-- Name: coupon_redemptions coupon_redemptions_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: coupons coupons_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.coupon_campaigns(id) ON DELETE CASCADE;


--
-- Name: customer_loyalty customer_loyalty_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty
    ADD CONSTRAINT customer_loyalty_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_loyalty_history customer_loyalty_history_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty_history
    ADD CONSTRAINT customer_loyalty_history_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_loyalty_history customer_loyalty_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_loyalty_history
    ADD CONSTRAINT customer_loyalty_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: customer_wallets customer_wallets_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_wallets
    ADD CONSTRAINT customer_wallets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: employee_attendance_devices employee_attendance_devices_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_attendance_devices employee_attendance_devices_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_attendance_devices employee_attendance_devices_rejected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_rejected_by_user_id_fkey FOREIGN KEY (rejected_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_attendance_devices employee_attendance_devices_reset_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_reset_by_user_id_fkey FOREIGN KEY (reset_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_attendance_devices employee_attendance_devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance_devices
    ADD CONSTRAINT employee_attendance_devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employee_chat_messages employee_chat_messages_sender_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_messages
    ADD CONSTRAINT employee_chat_messages_sender_employee_id_fkey FOREIGN KEY (sender_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: employee_chat_messages employee_chat_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_messages
    ADD CONSTRAINT employee_chat_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.employee_chat_threads(id) ON DELETE CASCADE;


--
-- Name: employee_chat_threads employee_chat_threads_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_chat_threads
    ADD CONSTRAINT employee_chat_threads_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_display_refill_alerts employee_display_refill_alerts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_display_refill_alerts
    ADD CONSTRAINT employee_display_refill_alerts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_display_refill_alerts employee_display_refill_alerts_resolved_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_display_refill_alerts
    ADD CONSTRAINT employee_display_refill_alerts_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: employee_leaves employee_leaves_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_leaves employee_leaves_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employee_portal_notifications employee_portal_notifications_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_notifications
    ADD CONSTRAINT employee_portal_notifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_portal_push_subscriptions employee_portal_push_subscriptions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions
    ADD CONSTRAINT employee_portal_push_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_portal_push_subscriptions employee_portal_push_subscriptions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions
    ADD CONSTRAINT employee_portal_push_subscriptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.employee_portal_sessions(id) ON DELETE SET NULL;


--
-- Name: employee_portal_push_subscriptions employee_portal_push_subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_push_subscriptions
    ADD CONSTRAINT employee_portal_push_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employee_portal_requests employee_portal_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_requests
    ADD CONSTRAINT employee_portal_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_portal_sessions employee_portal_sessions_attendance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_attendance_log_id_fkey FOREIGN KEY (attendance_log_id) REFERENCES public.attendance_logs(id) ON DELETE SET NULL;


--
-- Name: employee_portal_sessions employee_portal_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: employee_portal_sessions employee_portal_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_portal_sessions employee_portal_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_portal_sessions
    ADD CONSTRAINT employee_portal_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employee_push_subscriptions employee_push_subscriptions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_sales_profiles employee_sales_profiles_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales_profiles
    ADD CONSTRAINT employee_sales_profiles_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_sales employee_sales_sales_employee_id_employee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_sales_employee_id_employee_fkey FOREIGN KEY (sales_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: employee_shifts employee_shifts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_shifts employee_shifts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employee_vacations employee_vacations_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_vacations
    ADD CONSTRAINT employee_vacations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_vacations employee_vacations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_vacations
    ADD CONSTRAINT employee_vacations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employees employees_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL NOT VALID;


--
-- Name: employees employees_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: expense_approvals expense_approvals_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_approvals
    ADD CONSTRAINT expense_approvals_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expense_attachments expense_attachments_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_attachments
    ADD CONSTRAINT expense_attachments_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: financial_account_entries financial_account_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_entries
    ADD CONSTRAINT financial_account_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: financial_account_entries financial_account_entries_financial_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_entries
    ADD CONSTRAINT financial_account_entries_financial_account_id_fkey FOREIGN KEY (financial_account_id) REFERENCES public.financial_accounts(id) ON DELETE CASCADE;


--
-- Name: financial_account_entries financial_account_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_entries
    ADD CONSTRAINT financial_account_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: financial_account_transfers financial_account_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers
    ADD CONSTRAINT financial_account_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: financial_account_transfers financial_account_transfers_from_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers
    ADD CONSTRAINT financial_account_transfers_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;


--
-- Name: financial_account_transfers financial_account_transfers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers
    ADD CONSTRAINT financial_account_transfers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: financial_account_transfers financial_account_transfers_to_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_account_transfers
    ADD CONSTRAINT financial_account_transfers_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;


--
-- Name: financial_accounts financial_accounts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: financial_accounts financial_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: holidays holidays_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: income income_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income
    ADD CONSTRAINT income_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: inventory_count_items inventory_count_items_session_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_items
    ADD CONSTRAINT inventory_count_items_session_fk FOREIGN KEY (inventory_count_session_id) REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE NOT VALID;


--
-- Name: inventory_count_items inventory_count_items_variant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_items
    ADD CONSTRAINT inventory_count_items_variant_fk FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE NOT VALID;


--
-- Name: inventory_count_sessions inventory_count_sessions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_count_sessions inventory_count_sessions_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_sessions
    ADD CONSTRAINT inventory_count_sessions_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL NOT VALID;


--
-- Name: inventory_movements inventory_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: journal_entry_lines journal_entry_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: journal_entry_lines journal_entry_lines_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: journal_entry_lines journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: journal_entry_lines journal_entry_lines_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: journal_lines journal_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: journal_lines journal_lines_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loyalty_rules loyalty_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rules
    ADD CONSTRAINT loyalty_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: loyalty_rules loyalty_rules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rules
    ADD CONSTRAINT loyalty_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions loyalty_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: loyalty_transactions loyalty_transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions loyalty_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: marketing_attribution_events marketing_attribution_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events
    ADD CONSTRAINT marketing_attribution_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: marketing_attribution_events marketing_attribution_events_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events
    ADD CONSTRAINT marketing_attribution_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.marketing_posts(id) ON DELETE SET NULL;


--
-- Name: marketing_attribution_events marketing_attribution_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events
    ADD CONSTRAINT marketing_attribution_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_attribution_events marketing_attribution_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution_events
    ADD CONSTRAINT marketing_attribution_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_auto_reply_rules marketing_auto_reply_rules_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_auto_reply_rules
    ADD CONSTRAINT marketing_auto_reply_rules_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: marketing_auto_reply_rules marketing_auto_reply_rules_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_auto_reply_rules
    ADD CONSTRAINT marketing_auto_reply_rules_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_automation_logs marketing_automation_logs_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_logs
    ADD CONSTRAINT marketing_automation_logs_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.marketing_content_drafts(id) ON DELETE SET NULL;


--
-- Name: marketing_automation_logs marketing_automation_logs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_logs
    ADD CONSTRAINT marketing_automation_logs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_automation_logs marketing_automation_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_logs
    ADD CONSTRAINT marketing_automation_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_automation_settings marketing_automation_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_automation_settings
    ADD CONSTRAINT marketing_automation_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_brand_identity marketing_brand_identity_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_brand_identity
    ADD CONSTRAINT marketing_brand_identity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_campaigns marketing_campaigns_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_comment_dm_logs marketing_comment_dm_logs_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs
    ADD CONSTRAINT marketing_comment_dm_logs_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.marketing_posts(id) ON DELETE SET NULL;


--
-- Name: marketing_comment_dm_logs marketing_comment_dm_logs_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs
    ADD CONSTRAINT marketing_comment_dm_logs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.marketing_comment_dm_rules(id) ON DELETE SET NULL;


--
-- Name: marketing_comment_dm_logs marketing_comment_dm_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_logs
    ADD CONSTRAINT marketing_comment_dm_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_comment_dm_rules marketing_comment_dm_rules_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_rules
    ADD CONSTRAINT marketing_comment_dm_rules_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.marketing_posts(id) ON DELETE SET NULL;


--
-- Name: marketing_comment_dm_rules marketing_comment_dm_rules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_dm_rules
    ADD CONSTRAINT marketing_comment_dm_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_comment_events marketing_comment_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events
    ADD CONSTRAINT marketing_comment_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_comment_events marketing_comment_events_matched_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events
    ADD CONSTRAINT marketing_comment_events_matched_rule_id_fkey FOREIGN KEY (matched_rule_id) REFERENCES public.marketing_auto_reply_rules(id) ON DELETE SET NULL;


--
-- Name: marketing_comment_events marketing_comment_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_comment_events
    ADD CONSTRAINT marketing_comment_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_content_drafts marketing_content_drafts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_content_drafts marketing_content_drafts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_content_drafts marketing_content_drafts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_content_drafts marketing_content_drafts_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_content_drafts marketing_content_drafts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_content_drafts
    ADD CONSTRAINT marketing_content_drafts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_conversations marketing_conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_conversations
    ADD CONSTRAINT marketing_conversations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_conversations marketing_conversations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_conversations
    ADD CONSTRAINT marketing_conversations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_post_analytics marketing_post_analytics_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_analytics
    ADD CONSTRAINT marketing_post_analytics_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.marketing_posts(id) ON DELETE CASCADE;


--
-- Name: marketing_post_product_links marketing_post_product_links_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_product_links
    ADD CONSTRAINT marketing_post_product_links_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_post_product_links marketing_post_product_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_product_links
    ADD CONSTRAINT marketing_post_product_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_post_product_links marketing_post_product_links_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_product_links
    ADD CONSTRAINT marketing_post_product_links_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: marketing_post_templates marketing_post_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_post_templates
    ADD CONSTRAINT marketing_post_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_posts marketing_posts_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts
    ADD CONSTRAINT marketing_posts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;


--
-- Name: marketing_posts marketing_posts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts
    ADD CONSTRAINT marketing_posts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_posts marketing_posts_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts
    ADD CONSTRAINT marketing_posts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.marketing_post_templates(id) ON DELETE SET NULL;


--
-- Name: marketing_posts marketing_posts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_posts
    ADD CONSTRAINT marketing_posts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_settings marketing_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_settings
    ADD CONSTRAINT marketing_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_story_campaigns marketing_story_campaigns_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns
    ADD CONSTRAINT marketing_story_campaigns_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: marketing_story_campaigns marketing_story_campaigns_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns
    ADD CONSTRAINT marketing_story_campaigns_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_story_campaigns marketing_story_campaigns_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns
    ADD CONSTRAINT marketing_story_campaigns_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_story_campaigns marketing_story_campaigns_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_campaigns
    ADD CONSTRAINT marketing_story_campaigns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_story_exports marketing_story_exports_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports
    ADD CONSTRAINT marketing_story_exports_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: marketing_story_exports marketing_story_exports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports
    ADD CONSTRAINT marketing_story_exports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_story_exports marketing_story_exports_story_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports
    ADD CONSTRAINT marketing_story_exports_story_campaign_id_fkey FOREIGN KEY (story_campaign_id) REFERENCES public.marketing_story_campaigns(id) ON DELETE CASCADE;


--
-- Name: marketing_story_exports marketing_story_exports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_exports
    ADD CONSTRAINT marketing_story_exports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_generated_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_generated_campaign_id_fkey FOREIGN KEY (generated_campaign_id) REFERENCES public.marketing_story_campaigns(id) ON DELETE SET NULL;


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: marketing_story_trigger_suggestions marketing_story_trigger_suggestions_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_story_trigger_suggestions
    ADD CONSTRAINT marketing_story_trigger_suggestions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: money_accounts money_accounts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_accounts
    ADD CONSTRAINT money_accounts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: money_accounts money_accounts_financial_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_accounts
    ADD CONSTRAINT money_accounts_financial_account_id_fkey FOREIGN KEY (financial_account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL;


--
-- Name: money_accounts money_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_accounts
    ADD CONSTRAINT money_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: money_transactions money_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.money_accounts(id) ON DELETE RESTRICT;


--
-- Name: money_transactions money_transactions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: money_transactions money_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: money_transactions money_transactions_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.money_transactions(id) ON DELETE RESTRICT;


--
-- Name: money_transactions money_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.money_transactions
    ADD CONSTRAINT money_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_sales_employee_id_employee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_sales_employee_id_employee_fkey FOREIGN KEY (sales_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: orders orders_attendance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_attendance_log_id_fkey FOREIGN KEY (attendance_log_id) REFERENCES public.attendance_logs(id) ON DELETE SET NULL;


--
-- Name: orders orders_cashier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cashier_user_id_fkey FOREIGN KEY (cashier_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_sales_employee_id_employee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_sales_employee_id_employee_fkey FOREIGN KEY (sales_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: orders orders_sales_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_sales_employee_id_fkey FOREIGN KEY (sales_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: orders orders_salesperson_id_employee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_salesperson_id_employee_fkey FOREIGN KEY (salesperson_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: orders orders_seller_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_seller_user_id_fkey FOREIGN KEY (seller_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_method_account_mappings payment_method_account_mappings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_account_mappings
    ADD CONSTRAINT payment_method_account_mappings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: payment_method_account_mappings payment_method_account_mappings_financial_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_account_mappings
    ADD CONSTRAINT payment_method_account_mappings_financial_account_id_fkey FOREIGN KEY (financial_account_id) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;


--
-- Name: payment_method_account_mappings payment_method_account_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_account_mappings
    ADD CONSTRAINT payment_method_account_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payment_transaction_events payment_transaction_events_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transaction_events
    ADD CONSTRAINT payment_transaction_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.payment_transactions(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: product_audiences product_audiences_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_audiences
    ADD CONSTRAINT product_audiences_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_classification_options product_classification_options_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_classification_options
    ADD CONSTRAINT product_classification_options_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.product_classification_groups(id) ON DELETE CASCADE;


--
-- Name: product_variant_images product_variant_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_images
    ADD CONSTRAINT product_variant_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variant_images product_variant_images_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_images
    ADD CONSTRAINT product_variant_images_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: purchase_items purchase_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: purchase_items purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: recurring_task_rules recurring_task_rules_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_task_rules
    ADD CONSTRAINT recurring_task_rules_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.staff_task_templates(id) ON DELETE CASCADE;


--
-- Name: recurring_task_rules recurring_task_rules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_task_rules
    ADD CONSTRAINT recurring_task_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: return_items return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON DELETE CASCADE;


--
-- Name: returns returns_cashier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_cashier_user_id_fkey FOREIGN KEY (cashier_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: returns returns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: sales_employees sales_employees_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_employees
    ADD CONSTRAINT sales_employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: sales_employees sales_employees_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_employees
    ADD CONSTRAINT sales_employees_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: sales_opportunities sales_opportunities_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities
    ADD CONSTRAINT sales_opportunities_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: sales_opportunities sales_opportunities_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities
    ADD CONSTRAINT sales_opportunities_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: sales_opportunities sales_opportunities_product_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities
    ADD CONSTRAINT sales_opportunities_product_variant_id_fkey FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: sales_opportunities sales_opportunities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_opportunities
    ADD CONSTRAINT sales_opportunities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: shift_opening_assignments shift_opening_assignments_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments
    ADD CONSTRAINT shift_opening_assignments_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: shift_opening_assignments shift_opening_assignments_attendance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments
    ADD CONSTRAINT shift_opening_assignments_attendance_log_id_fkey FOREIGN KEY (attendance_log_id) REFERENCES public.attendance_logs(id) ON DELETE SET NULL;


--
-- Name: shift_opening_assignments shift_opening_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments
    ADD CONSTRAINT shift_opening_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: shift_opening_assignments shift_opening_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_opening_assignments
    ADD CONSTRAINT shift_opening_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: shipping_cities shipping_cities_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_cities
    ADD CONSTRAINT shipping_cities_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.shipping_providers(id) ON DELETE CASCADE;


--
-- Name: shipping_districts shipping_districts_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts
    ADD CONSTRAINT shipping_districts_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.shipping_cities(id) ON DELETE CASCADE;


--
-- Name: shipping_districts shipping_districts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts
    ADD CONSTRAINT shipping_districts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.shipping_providers(id) ON DELETE CASCADE;


--
-- Name: shipping_districts shipping_districts_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_districts
    ADD CONSTRAINT shipping_districts_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.shipping_zones(id) ON DELETE CASCADE;


--
-- Name: shipping_events shipping_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_events
    ADD CONSTRAINT shipping_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: shipping_zones shipping_zones_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.shipping_cities(id) ON DELETE CASCADE;


--
-- Name: shipping_zones shipping_zones_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.shipping_providers(id) ON DELETE CASCADE;


--
-- Name: staff_task_assignments staff_task_assignments_assigned_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_assigned_employee_id_fkey FOREIGN KEY (assigned_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_assignment_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_assignment_event_id_fkey FOREIGN KEY (assignment_event_id) REFERENCES public.attendance_events(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_current_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_current_assignee_id_fkey FOREIGN KEY (current_assignee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.staff_task_templates(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: staff_task_assignments staff_task_assignments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: staff_task_assignments staff_task_assignments_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_assignments
    ADD CONSTRAINT staff_task_assignments_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: staff_task_comments staff_task_comments_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments
    ADD CONSTRAINT staff_task_comments_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_comments staff_task_comments_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments
    ADD CONSTRAINT staff_task_comments_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_comments staff_task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments
    ADD CONSTRAINT staff_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.staff_task_assignments(id) ON DELETE CASCADE;


--
-- Name: staff_task_comments staff_task_comments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_comments
    ADD CONSTRAINT staff_task_comments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: staff_task_email_logs staff_task_email_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs
    ADD CONSTRAINT staff_task_email_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_email_logs staff_task_email_logs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs
    ADD CONSTRAINT staff_task_email_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.staff_task_assignments(id) ON DELETE SET NULL;


--
-- Name: staff_task_email_logs staff_task_email_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_email_logs
    ADD CONSTRAINT staff_task_email_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_history staff_task_history_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_history staff_task_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_history staff_task_history_from_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_from_employee_id_fkey FOREIGN KEY (from_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_history staff_task_history_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.staff_task_assignments(id) ON DELETE CASCADE;


--
-- Name: staff_task_history staff_task_history_to_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_history
    ADD CONSTRAINT staff_task_history_to_employee_id_fkey FOREIGN KEY (to_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_notification_queue staff_task_notification_queue_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_notification_queue
    ADD CONSTRAINT staff_task_notification_queue_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_notification_queue staff_task_notification_queue_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_notification_queue
    ADD CONSTRAINT staff_task_notification_queue_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.staff_task_assignments(id) ON DELETE CASCADE;


--
-- Name: staff_task_notification_queue staff_task_notification_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_notification_queue
    ADD CONSTRAINT staff_task_notification_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_templates staff_task_templates_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates
    ADD CONSTRAINT staff_task_templates_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: staff_task_templates staff_task_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates
    ADD CONSTRAINT staff_task_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_task_templates staff_task_templates_fixed_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates
    ADD CONSTRAINT staff_task_templates_fixed_employee_id_fkey FOREIGN KEY (fixed_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: staff_task_templates staff_task_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_task_templates
    ADD CONSTRAINT staff_task_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: stock_transfers stock_transfers_from_warehouse_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_from_warehouse_fkey FOREIGN KEY (from_warehouse) REFERENCES public.warehouses(id);


--
-- Name: stock_transfers stock_transfers_to_warehouse_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_to_warehouse_fkey FOREIGN KEY (to_warehouse) REFERENCES public.warehouses(id);


--
-- Name: stock_transfers stock_transfers_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: storefront_customer_events storefront_customer_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_events
    ADD CONSTRAINT storefront_customer_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: storefront_customer_sessions storefront_customer_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_customer_sessions
    ADD CONSTRAINT storefront_customer_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: task_activity_logs task_activity_logs_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_activity_logs
    ADD CONSTRAINT task_activity_logs_id_fkey FOREIGN KEY (id) REFERENCES public.staff_task_history(id) ON DELETE CASCADE;


--
-- Name: task_assignments task_assignments_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_id_fkey FOREIGN KEY (id) REFERENCES public.staff_task_assignments(id) ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: task_attachments task_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.staff_task_assignments(id) ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: task_templates task_templates_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_id_fkey FOREIGN KEY (id) REFERENCES public.staff_task_templates(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashbox(id);


--
-- Name: units units_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: variants variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variants
    ADD CONSTRAINT variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: warehouse_inventory warehouse_inventory_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_inventory
    ADD CONSTRAINT warehouse_inventory_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: warehouse_inventory warehouse_inventory_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_inventory
    ADD CONSTRAINT warehouse_inventory_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict e6MNBSWtbDeaygkSFVHtXE9uUIEi1tAQmE1QH9VSXmKAIfkgYgGMwym789CPbcO

