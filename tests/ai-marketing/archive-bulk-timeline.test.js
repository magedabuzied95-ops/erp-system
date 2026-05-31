import test from "node:test";
import assert from "node:assert/strict";

const memoryQueue = () => {
  const rows = new Map();
  const timeline = [];
  let sequence = 0;
  const event = (queue_id, action, status, details = {}) => ({ queue_id, action, status, details, sequence: ++sequence, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString() });
  const referenced = (url, exceptId) => Array.from(rows.values()).some((row) => row.id !== exceptId && [
    row.final_asset_url,
    row.story_image_url,
    ...(row.media_urls || []),
  ].includes(url));
  return {
    add(row) {
      rows.set(row.id, { media_urls: [], metadata: {}, ...row });
    },
    archive(id) {
      const row = rows.get(id);
      row.metadata.previous_status = row.status;
      row.status = "archived";
      timeline.push(event(id, "archived", "archived"));
    },
    restore(id) {
      const row = rows.get(id);
      row.status = row.metadata.previous_status || "published";
      timeline.push(event(id, "restored", row.status));
    },
    delete(id) {
      const row = rows.get(id);
      const removed = [];
      for (const url of [row.final_asset_url, row.story_image_url, ...(row.media_urls || [])].filter(Boolean)) {
        if (!referenced(url, id)) removed.push(url);
      }
      rows.delete(id);
      timeline.push(event(id, "deleted", "deleted"));
      return removed;
    },
    duplicate(id, newId) {
      const row = rows.get(id);
      rows.set(newId, { ...row, id: newId, status: "pending_approval", publish_status: "draft" });
      timeline.push(event(newId, "created", "pending_approval", { duplicated_from_queue_id: id }));
    },
    list(filter = "default") {
      return Array.from(rows.values()).filter((row) => filter === "archived" ? row.status === "archived" : row.status !== "archived");
    },
    bulk(action, ids) {
      const affected = [];
      for (const id of ids) {
        const row = rows.get(id);
        if (!row) continue;
        if (action === "archive") this.archive(id);
        if (action === "delete") this.delete(id);
        if (action === "publish" && ["ready", "publish_failed"].includes(row.status)) row.status = "published";
        affected.push(id);
      }
      return affected;
    },
    timeline(id) {
      return timeline.filter((row) => row.queue_id === id).sort((a, b) => b.sequence - a.sequence);
    },
  };
};

test("archive hides by default, archived filter returns item, restore makes it visible", () => {
  const queue = memoryQueue();
  queue.add({ id: 1, status: "published" });
  queue.archive(1);
  assert.equal(queue.list().length, 0);
  assert.equal(queue.list("archived").length, 1);
  queue.restore(1);
  assert.equal(queue.list().length, 1);
});

test("delete removes media only when no other queue item references the same path", () => {
  const queue = memoryQueue();
  queue.add({ id: 1, status: "published", final_asset_url: "/uploads/stories/shared.png" });
  queue.add({ id: 2, status: "ready", final_asset_url: "/uploads/stories/shared.png" });
  assert.deepEqual(queue.delete(1), []);
  assert.deepEqual(queue.delete(2), ["/uploads/stories/shared.png"]);
});

test("bulk archive, delete, and publish handle selected rows deterministically", () => {
  const queue = memoryQueue();
  queue.add({ id: 1, status: "published" });
  queue.add({ id: 2, status: "ready" });
  queue.add({ id: 3, status: "publish_failed" });
  assert.deepEqual(queue.bulk("archive", [1]), [1]);
  assert.deepEqual(queue.bulk("publish", [2, 3]), [2, 3]);
  assert.equal(queue.list().find((row) => row.id === 2).status, "published");
  assert.deepEqual(queue.bulk("delete", [2]), [2]);
});

test("timeline includes required actions newest-first with payload shape", () => {
  const queue = memoryQueue();
  queue.add({ id: 1, status: "published" });
  queue.archive(1);
  queue.restore(1);
  queue.duplicate(1, 2);
  queue.delete(1);
  const events = queue.timeline(1);
  assert.deepEqual(events.map((event) => event.action), ["deleted", "restored", "archived"]);
  for (const event of events) {
    assert.ok(event.timestamp);
    assert.ok(event.action);
    assert.ok(event.status);
  }
});
