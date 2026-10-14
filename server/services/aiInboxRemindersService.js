import db from "../database/db.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";
import { sendAiInboxPushToUser } from "./aiInboxPushService.js";
import { createNotification } from "./notificationsService.js";
import { emitToRooms } from "../utils/socket.js";

/*
 * A reminder an operator sets by hand: "كلّم العميل ده بكرة الساعة 5".
 *
 * It is a row in `ai_followup_tasks` like the AI's own follow-ups, so the
 * follow-up centre lists it, snoozes it and closes it with the same buttons.
 * What differs is the trigger type and that nothing is ever sent to the
 * customer on its behalf: when it comes due the OPERATOR is told — a push on
 * the phone, a bell in the ERP, a toast in the open inbox — and the customer
 * hears from a person.
 */
export const MANUAL_REMINDER_TRIGGER = "manual_reminder";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const parseScheduledAt = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error("A valid reminder time is required"), { status: 400 });
  if (date.getTime() < Date.now() - 60 * 1000) throw Object.assign(new Error("The reminder time has already passed"), { status: 400 });
  return date;
};

const mapReminder = (row = {}) => ({
  id: Number(row.id),
  session_id: row.session_id,
  status: row.status,
  scheduled_at: row.scheduled_at,
  note: text(row.payload?.note || ""),
  created_by: row.payload?.created_by || null,
  created_by_name: text(row.payload?.created_by_name || ""),
  customer_name: text(row.payload?.customer_name || ""),
  channel: row.source_channel || "",
  notified_at: row.payload?.notified_at || null,
  created_at: row.created_at,
});

export const createManualReminder = async ({ tenantId, sessionId, scheduledAt, note = "", channel = "", customerName = "", user = {} } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = text(sessionId);
  if (!safeTenantId || !safeSessionId) throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  const when = parseScheduledAt(scheduledAt);
  await ensureAiSalesAgentSchema();
  const payload = {
    note: text(note).slice(0, 1000),
    created_by: numberOrNull(user.id),
    created_by_name: text(user.name || user.full_name || user.username || user.email || ""),
    customer_name: text(customerName).slice(0, 120),
  };
  const result = await db.query(
    `
    INSERT INTO ai_followup_tasks (tenant_id, session_id, source_channel, trigger_type, status, scheduled_at, payload, action_by)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb, $7)
    RETURNING *
    `,
    [safeTenantId, safeSessionId, text(channel) || "web_chat", MANUAL_REMINDER_TRIGGER, when, JSON.stringify(payload), payload.created_by]
  );
  return mapReminder(result.rows[0]);
};

export const listSessionReminders = async ({ tenantId, sessionId } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = text(sessionId);
  if (!safeTenantId || !safeSessionId) return [];
  await ensureAiSalesAgentSchema();
  const result = await db.query(
    `
    SELECT * FROM ai_followup_tasks
    WHERE tenant_id = $1 AND session_id = $2 AND trigger_type = $3 AND status IN ('pending', 'snoozed')
    ORDER BY scheduled_at ASC
    LIMIT 20
    `,
    [safeTenantId, safeSessionId, MANUAL_REMINDER_TRIGGER]
  );
  return result.rows.map(mapReminder);
};

const reminderTitle = (reminder) => (reminder.customer_name ? `⏰ تذكير: ${reminder.customer_name}` : "⏰ تذكير متابعة");

const notifyOne = async (row) => {
  const reminder = mapReminder(row);
  const tenantId = Number(row.tenant_id);
  const userId = reminder.created_by;
  const url = `/inbox/${encodeURIComponent(reminder.session_id)}`;
  const body = reminder.note || "حان وقت متابعة العميل";

  if (userId) {
    await sendAiInboxPushToUser({
      tenantId,
      userId,
      payload: {
        title: reminderTitle(reminder),
        body,
        tag: `ai-inbox-reminder-${reminder.id}`,
        data: { type: "ai_inbox_reminder", conversation_id: reminder.session_id, reminder_id: reminder.id, url },
      },
    }).catch((error) => console.warn("[inbox-reminder:push-failed]", { id: reminder.id, message: error?.message || String(error) }));

    await createNotification({
      tenant_id: tenantId,
      user_id: userId,
      type: "ai_inbox_reminder",
      category: "inbox",
      priority: "high",
      title: reminderTitle(reminder),
      message: body,
      action_url: `/admin/ai-inbox?conversation=${encodeURIComponent(reminder.session_id)}`,
      action_label: "افتح المحادثة",
      entity_type: "ai_followup_task",
      entity_id: String(reminder.id),
      metadata: { conversation_id: reminder.session_id, reminder_id: reminder.id },
    }).catch((error) => console.warn("[inbox-reminder:notification-failed]", { id: reminder.id, message: error?.message || String(error) }));

    emitToRooms([`user:${userId}`], "ai_inbox:reminder_due", { tenant_id: tenantId, reminder, at: new Date().toISOString() });
  } else {
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:reminder_due", { tenant_id: tenantId, reminder, at: new Date().toISOString() });
  }

  await db.query(
    `UPDATE ai_followup_tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('notified_at', NOW()), updated_at = NOW() WHERE id = $1`,
    [reminder.id]
  );
};

// Every minute: the reminders that just came due and have not rung yet. A
// snoozed reminder clears its `notified_at` when it is snoozed, so it rings again.
export const runDueRemindersTick = async () => {
  await ensureAiSalesAgentSchema();
  const due = await db.query(
    `
    SELECT * FROM ai_followup_tasks
    WHERE trigger_type = $1
      AND status IN ('pending', 'snoozed')
      AND COALESCE(snoozed_until, scheduled_at) <= NOW()
      AND (payload->>'notified_at') IS NULL
    ORDER BY scheduled_at ASC
    LIMIT 50
    `,
    [MANUAL_REMINDER_TRIGGER]
  );
  let rang = 0;
  for (const row of due.rows) {
    try {
      await notifyOne(row);
      rang += 1;
    } catch (error) {
      console.error("[inbox-reminder:tick-failed]", { id: row.id, message: error?.message || String(error) });
    }
  }
  return { due: due.rows.length, rang };
};

// Called when a reminder is snoozed: it rings again at the new time.
export const rearmReminderNotification = async ({ tenantId, id } = {}) => {
  await db.query(
    `UPDATE ai_followup_tasks SET payload = COALESCE(payload, '{}'::jsonb) - 'notified_at', updated_at = NOW() WHERE tenant_id = $1 AND id = $2 AND trigger_type = $3`,
    [numberOrNull(tenantId), numberOrNull(id), MANUAL_REMINDER_TRIGGER]
  ).catch(() => {});
};
