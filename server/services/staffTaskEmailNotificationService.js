import process from "node:process";
import net from "node:net";
import tls from "node:tls";
import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();

const smtpRequest = (socket, expectedCodes = []) =>
  new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      if (/^\d{3}\s/.test(last)) {
        socket.off("data", onData);
        const code = Number(last.slice(0, 3));
        if (expectedCodes.length && !expectedCodes.includes(code)) {
          reject(new Error(`SMTP rejected command: ${last}`));
          return;
        }
        resolve(buffer);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

const smtpCommand = async (socket, command, expectedCodes = [250]) => {
  socket.write(`${command}\r\n`);
  return smtpRequest(socket, expectedCodes);
};

const encodeBase64 = (value) => Buffer.from(String(value || ""), "utf8").toString("base64");

const wrapBase64 = (value) => String(value || "").match(/.{1,76}/g)?.join("\r\n") || "";

const buildRawEmail = ({ fromHeader, to, subject, body, attachments = [] }) => {
  const safeAttachments = (Array.isArray(attachments) ? attachments : []).filter((item) => item?.content);
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${encodeBase64(subject)}?=`,
    "MIME-Version: 1.0",
  ];
  if (!safeAttachments.length) {
    return [...headers, "Content-Type: text/plain; charset=UTF-8", "", body, ".", ""].join("\r\n");
  }
  const boundary = `mone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(encodeBase64(body)),
  ];
  safeAttachments.forEach((attachment) => {
    const filename = text(attachment.filename || "attachment.pdf").replace(/[\r\n"]/g, "_");
    const mimeType = text(attachment.contentType || "application/octet-stream");
    const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(content.toString("base64"))
    );
  });
  parts.push(`--${boundary}--`, ".", "");
  return parts.join("\r\n");
};

export const sendSmtpMail = async ({ to, subject, body, attachments = [] }) => {
  const host = text(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 587);
  const user = text(process.env.SMTP_USER);
  const pass = text(process.env.SMTP_PASS);
  const from = text(process.env.MAIL_FROM || process.env.SMTP_FROM || user);
  const fromName = text(process.env.MAIL_FROM_NAME || process.env.SMTP_FROM_NAME || "");
  const fromHeader = fromName ? `=?UTF-8?B?${encodeBase64(fromName)}?= <${from}>` : from;

  if (!host || !from) {
    throw new Error("SMTP is not configured");
  }

  const socket = port === 465
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await smtpRequest(socket, [220]);
  await smtpCommand(socket, `EHLO ${host}`, [250]);

  if (port !== 465) {
    await smtpCommand(socket, "STARTTLS", [220]);
    const secureSocket = tls.connect({ socket, servername: host });
    await smtpCommand(secureSocket, `EHLO ${host}`, [250]);
    if (user && pass) {
      await smtpCommand(secureSocket, "AUTH LOGIN", [334]);
      await smtpCommand(secureSocket, encodeBase64(user), [334]);
      await smtpCommand(secureSocket, encodeBase64(pass), [235]);
    }
    await smtpCommand(secureSocket, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(secureSocket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(secureSocket, "DATA", [354]);
    secureSocket.write(buildRawEmail({ fromHeader, to, subject, body, attachments }));
    await smtpRequest(secureSocket, [250]);
    await smtpCommand(secureSocket, "QUIT", [221]);
    secureSocket.end();
    return;
  }

  if (user && pass) {
    await smtpCommand(socket, "AUTH LOGIN", [334]);
    await smtpCommand(socket, encodeBase64(user), [334]);
    await smtpCommand(socket, encodeBase64(pass), [235]);
  }
  await smtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
  await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
  await smtpCommand(socket, "DATA", [354]);
  socket.write(buildRawEmail({ fromHeader, to, subject, body, attachments }));
  await smtpRequest(socket, [250]);
  await smtpCommand(socket, "QUIT", [221]);
  socket.end();
};

export const enqueueStaffTaskEmail = async (clientOrPool = db, {
  tenantId,
  taskId,
  employeeId,
  userId = null,
  recipient,
  type = "task_assigned",
  payload = {},
}) => {
  const to = text(recipient);
  if (!to || !taskId || !employeeId) return { skipped: true };

  const dedupeKey = `${type}:${taskId}:${employeeId}`;
  await clientOrPool.query(
    `
    INSERT INTO staff_task_notification_queue (
      tenant_id, task_id, employee_id, user_id, notification_type, channel, recipient, dedupe_key, payload, status, next_attempt_at
    )
    VALUES ($1,$2,$3,$4,$5,'email',$6,$7,$8::jsonb,'pending',NOW())
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `,
    [tenantId, taskId, employeeId, userId, type, to, dedupeKey, JSON.stringify({ ...payload, dedupe_key: dedupeKey })]
  );
  return { queued: true };
};

const buildTaskEmail = (row = {}) => {
  const payload = row.payload || {};
  const title = text(payload.title_ar || payload.task_title_ar || payload.title || "مهمة جديدة");
  if (Array.isArray(payload.tasks) && payload.tasks.length) {
    const subject = text(payload.subject_ar || payload.subject || "تم تحديث قائمة مهامك");
    const taskLines = payload.tasks
      .map((task, index) => `${index + 1}. ${text(task.title_ar || task.task_title_ar || task.title)}${task.due_at ? ` - الموعد ${task.due_at}` : ""}`)
      .join("\n");
    return {
      subject,
      body: [
        `مرحبًا ${payload.assignee_name || ""}،`,
        "",
        text(payload.message_ar || payload.message || "تم تحديث قائمة مهامك بعد تسجيل الحضور."),
        "",
        taskLines,
        "",
        "افتح لوحة مهام الموظفين لمراجعة المهام وتنفيذها.",
      ].filter(Boolean).join("\n"),
    };
  }
  const subject = row.notification_type === "task_reassigned"
    ? `تم إعادة تعيين مهمة: ${title}`
    : `مهمة جديدة: ${title}`;
  const body = [
    `مرحبًا ${payload.assignee_name || ""}،`,
    "",
    row.notification_type === "task_reassigned"
      ? "تم إعادة تعيين مهمة لك داخل النظام."
      : "تم تعيين مهمة جديدة لك داخل النظام.",
    "",
    `المهمة: ${title}`,
    (payload.description_ar || payload.description) ? `التفاصيل: ${payload.description_ar || payload.description}` : "",
    payload.priority ? `الأولوية: ${payload.priority}` : "",
    payload.due_at ? `الموعد: ${payload.due_at}` : "",
    "",
    "افتح لوحة مهام الموظفين لمراجعتها وتنفيذها.",
  ].filter(Boolean).join("\n");
  return { subject, body };
};

export const processStaffTaskEmailQueue = async ({ limit = 20 } = {}) => {
  const enabled = String(process.env.STAFF_TASK_EMAIL_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
  if (!enabled) return { skipped: true };

  const client = await db.connect();
  const processed = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      SELECT *
      FROM staff_task_notification_queue
      WHERE channel = 'email'
        AND status IN ('pending','retry')
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [Math.min(Math.max(Number(limit || 20), 1), 100)]
    );

    for (const row of result.rows) {
      const { subject, body } = buildTaskEmail(row);
      try {
        await sendSmtpMail({ to: row.recipient, subject, body });
        await client.query(
          `
          UPDATE staff_task_notification_queue
          SET status = 'sent', attempts = attempts + 1, updated_at = NOW(), last_error = NULL
          WHERE id = $1
          `,
          [row.id]
        );
        await client.query(
          `
          INSERT INTO staff_task_email_logs (
            tenant_id, employee_id, user_id, task_id, email_type, sent_to, subject, sent_at, dedupe_key, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,'sent')
          ON CONFLICT (dedupe_key) DO NOTHING
          `,
          [
            row.tenant_id,
            row.employee_id,
            row.user_id,
            row.task_id,
            row.notification_type,
            row.recipient,
            subject,
            text(row.payload?.dedupe_key || `${row.notification_type}:${row.task_id}:${row.employee_id}`),
          ]
        );
        processed.push({ id: row.id, status: "sent" });
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        const terminal = attempts >= 5;
        await client.query(
          `
          UPDATE staff_task_notification_queue
          SET status = $1,
              attempts = $2,
              next_attempt_at = NOW() + (($2 * 5) * INTERVAL '1 minute'),
              last_error = $3,
              updated_at = NOW()
          WHERE id = $4
          `,
          [terminal ? "failed" : "retry", attempts, error.message, row.id]
        );
        await client.query(
          `
          INSERT INTO staff_task_email_logs (
            tenant_id, employee_id, user_id, task_id, email_type, sent_to, subject, sent_at, dedupe_key, status, error_message
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,'failed',$9)
          ON CONFLICT (dedupe_key) DO NOTHING
          `,
          [
            row.tenant_id,
            row.employee_id,
            row.user_id,
            row.task_id,
            row.notification_type,
            row.recipient,
            subject,
            text(row.payload?.dedupe_key || `${row.notification_type}:${row.task_id}:${row.employee_id}`),
            error.message,
          ]
        );
        processed.push({ id: row.id, status: terminal ? "failed" : "retry", error: error.message });
      }
    }
    await client.query("COMMIT");
    return { processed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const sendLoginTaskDigestIfNeeded = async (userId, employeeId, tenantId) => {
  const enabled = String(process.env.STAFF_TASK_EMAIL_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
  if (!enabled || !userId || !employeeId || !tenantId) return { skipped: true };

  const employeeResult = await db.query(
    `
    SELECT e.id, e.full_name, e.email, u.email AS user_email
    FROM employees e
    LEFT JOIN users u ON u.id = $2
    WHERE e.id = $1
      AND e.tenant_id = $3
    LIMIT 1
    `,
    [employeeId, userId, tenantId]
  );
  const employee = employeeResult.rows[0];
  const sentTo = text(employee?.email || employee?.user_email);
  if (!sentTo) return { skipped: true, reason: "missing_email" };

  const tasksResult = await db.query(
    `
    SELECT id, title, title_ar, status, priority, due_at
    FROM staff_task_assignments
    WHERE tenant_id = $1
      AND current_assignee_id = $2
      AND assigned_date >= CURRENT_DATE - INTERVAL '1 day'
      AND status IN ('pending','overdue','reassigned','rejected','redo_requested','manager_review')
    ORDER BY due_at NULLS LAST, priority DESC, id DESC
    LIMIT 25
    `,
    [tenantId, employeeId]
  );

  if (!tasksResult.rows.length) return { skipped: true, reason: "no_tasks" };

  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `staff_task_login_digest:${employeeId}:${today}`;
  const duplicate = await db.query(
    `
    SELECT id
    FROM staff_task_email_logs
    WHERE tenant_id = $1
      AND dedupe_key = $2
      AND status = 'sent'
    LIMIT 1
    `,
    [tenantId, dedupeKey]
  );
  if (duplicate.rows[0]) return { skipped: true, reason: "duplicate" };

  const subject = "مهامك اليوم في النظام";
  const taskLines = tasksResult.rows.map((task, index) => `${index + 1}. ${text(task.title_ar || task.title)} - ${task.status}`).join("\n");
  const body = [
    `مرحبًا ${employee?.full_name || ""}،`,
    "تم تحديث مهامك اليوم داخل النظام.",
    "يرجى تسجيل الدخول ومراجعة قائمة مهامك وتنفيذ المطلوب.",
    "",
    taskLines,
    "",
    "شكراً لك.",
  ].join("\n");

  try {
    await sendSmtpMail({ to: sentTo, subject, body });
    await db.query(
      `
      INSERT INTO staff_task_email_logs (
        tenant_id, employee_id, user_id, email_type, sent_to, subject, sent_at, dedupe_key, status
      )
      VALUES ($1,$2,$3,'login_digest',$4,$5,NOW(),$6,'sent')
      ON CONFLICT (dedupe_key) DO NOTHING
      `,
      [tenantId, employeeId, userId, sentTo, subject, dedupeKey]
    );
    return { sent: true };
  } catch (error) {
    await db.query(
      `
      INSERT INTO staff_task_email_logs (
        tenant_id, employee_id, user_id, email_type, sent_to, subject, sent_at, dedupe_key, status, error_message
      )
      VALUES ($1,$2,$3,'login_digest',$4,$5,NOW(),$6,'failed',$7)
      ON CONFLICT (dedupe_key) DO NOTHING
      `,
      [tenantId, employeeId, userId, sentTo, subject, dedupeKey, error.message]
    );
    console.warn("[staff-tasks] login digest email failed", error.message);
    return { sent: false, error: error.message };
  }
};
