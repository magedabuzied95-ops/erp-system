import assert from "node:assert/strict";
import test from "node:test";

import { orderMessages } from "../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js";

// A cache-primed thread window can reach FURTHER BACK than the page being
// hydrated over it. mergeMessagesByIdentity keeps each message at its
// first-seen position, so the merged result must be ordered chronologically.

const at = (iso, id) => ({ id, created_at: iso });

test("orders a merged window chronologically", () => {
  const merged = [
    at("2026-08-01T10:00:00Z", "old-1"),
    at("2026-08-01T12:00:00Z", "old-2"),
    at("2026-08-01T09:00:00Z", "oldest"),
    at("2026-08-01T13:00:00Z", "newest"),
  ];
  assert.deepEqual(
    orderMessages(merged).map((m) => m.id),
    ["oldest", "old-1", "old-2", "newest"]
  );
});

test("is stable for equal timestamps (incoming order preserved)", () => {
  const same = "2026-08-01T10:00:00Z";
  const merged = [at(same, "a"), at(same, "b"), at(same, "c")];
  assert.deepEqual(orderMessages(merged).map((m) => m.id), ["a", "b", "c"]);
});

test("falls back untouched when any message lacks a timestamp (optimistic bubble)", () => {
  // An in-flight "sending" bubble without created_at must NOT be reordered to
  // the top — the caller's existing merge order is returned instead.
  const fallback = [{ id: "keep-this-order" }];
  const merged = [
    at("2026-08-01T10:00:00Z", "real"),
    { id: "sending-123", delivery_status: "sending" },
  ];
  assert.equal(orderMessages(merged, fallback), fallback);
});

test("returns the fallback for an empty window and never mutates the input", () => {
  const fallback = ["fb"];
  assert.equal(orderMessages([], fallback), fallback);

  const input = [at("2026-08-01T12:00:00Z", "b"), at("2026-08-01T10:00:00Z", "a")];
  const snapshot = input.map((m) => m.id);
  orderMessages(input);
  assert.deepEqual(input.map((m) => m.id), snapshot, "input array must not be sorted in place");
});
