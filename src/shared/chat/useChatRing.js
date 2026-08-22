import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Ring ("نداء"): an attention call that carries no audio.
 *
 * One hook serves every surface (POS dock, manager portal, employee app).
 * The caller wires two things: how to subscribe to `employee-chat:ring` /
 * `employee-chat:ring-answered`, and how to answer over its own API.
 *
 * Incoming: loops the ringtone + vibration until answered, answered elsewhere,
 * or RING_TTL_MS passes. Outgoing: tracks one pending ring per thread and
 * resolves it from the answered event.
 */

export const RING_TTL_MS = 120000;
export const RING_SOUND_SRC = "/sounds/ring-call.wav";
const VIBRATE_PATTERN = [400, 200, 400, 1200];

const now = () => Date.now();

export default function useChatRing({ subscribe, answer, isIncoming, onIncoming } = {}) {
  const [incoming, setIncoming] = useState(null); // { message, thread, thread_id, sender_name, expires_at }
  const [outgoing, setOutgoing] = useState(null); // { thread_id, message_id, status: 'ringing'|'answered'|'missed', answered_by, seconds, started_at }
  const audioRef = useRef(null);
  const vibrateTimer = useRef(null);
  const expireTimer = useRef(null);
  const outgoingTimer = useRef(null);
  const incomingRef = useRef(null);
  const isIncomingRef = useRef(isIncoming);
  const onIncomingRef = useRef(onIncoming);
  isIncomingRef.current = isIncoming;
  onIncomingRef.current = onIncoming;

  const stopRinging = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (vibrateTimer.current) window.clearInterval(vibrateTimer.current);
    vibrateTimer.current = null;
    if (expireTimer.current) window.clearTimeout(expireTimer.current);
    expireTimer.current = null;
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
  }, []);

  const startRinging = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) {
      const audio = new Audio(RING_SOUND_SRC);
      audio.loop = true;
      audio.preload = "auto";
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    audio.volume = 1;
    audio.currentTime = 0;
    audio.play().catch(() => {
      /* autoplay blocked until the user touches the page; the overlay still shows */
    });
    if (navigator.vibrate) {
      navigator.vibrate(VIBRATE_PATTERN);
      vibrateTimer.current = window.setInterval(() => navigator.vibrate(VIBRATE_PATTERN), 2400);
    }
  }, []);

  const clearIncoming = useCallback(() => {
    incomingRef.current = null;
    setIncoming(null);
    stopRinging();
  }, [stopRinging]);

  const answerIncoming = useCallback(async () => {
    const current = incomingRef.current;
    if (!current) return null;
    clearIncoming();
    try {
      return await answer?.(current);
    } catch {
      return null;
    }
  }, [answer, clearIncoming]);

  const dismissIncoming = useCallback(() => clearIncoming(), [clearIncoming]);

  const registerOutgoing = useCallback((result) => {
    const message = result?.message;
    if (!message?.id) return;
    if (outgoingTimer.current) window.clearTimeout(outgoingTimer.current);
    setOutgoing({ thread_id: String(message.thread_id || result?.thread?.id || ""), message_id: String(message.id), status: "ringing", started_at: now() });
    outgoingTimer.current = window.setTimeout(() => {
      setOutgoing((current) => (current && current.message_id === String(message.id) && current.status === "ringing" ? { ...current, status: "missed" } : current));
    }, RING_TTL_MS);
  }, []);

  const clearOutgoing = useCallback(() => {
    if (outgoingTimer.current) window.clearTimeout(outgoingTimer.current);
    setOutgoing(null);
  }, []);

  useEffect(() => {
    if (typeof subscribe !== "function") return undefined;
    const off = subscribe({
      onRing: (payload = {}) => {
        const message = payload?.message;
        if (!message?.id) return;
        if (typeof isIncomingRef.current === "function" && !isIncomingRef.current(payload)) return;
        const expiresAt = new Date(payload.expires_at || 0).getTime() || now() + RING_TTL_MS;
        if (expiresAt <= now()) return;
        const next = {
          message,
          thread: payload.thread || null,
          thread_id: String(payload.thread_id || message.thread_id || payload.thread?.id || ""),
          employee_id: payload.employee_id ?? payload.thread?.employee_id ?? null,
          sender_type: payload.sender_type || message.sender_type,
          sender_name: payload.sender_name || message.sender_name || payload.thread?.employee_name || "",
          expires_at: expiresAt,
        };
        incomingRef.current = next;
        setIncoming(next);
        startRinging();
        if (expireTimer.current) window.clearTimeout(expireTimer.current);
        expireTimer.current = window.setTimeout(() => {
          if (incomingRef.current?.message?.id === message.id) clearIncoming();
        }, Math.max(1000, expiresAt - now()));
        onIncomingRef.current?.(next);
      },
      onRingAnswered: (payload = {}) => {
        const messageId = String(payload?.message_id || payload?.message?.id || "");
        if (!messageId) return;
        if (incomingRef.current && String(incomingRef.current.message?.id) === messageId) clearIncoming();
        setOutgoing((current) =>
          current && current.message_id === messageId
            ? { ...current, status: "answered", answered_by: payload.answered_by || "", seconds: Number(payload.seconds || 0) }
            : current
        );
      },
    });
    return () => {
      off?.();
    };
  }, [subscribe, startRinging, clearIncoming]);

  useEffect(
    () => () => {
      stopRinging();
      if (outgoingTimer.current) window.clearTimeout(outgoingTimer.current);
    },
    [stopRinging]
  );

  return { incoming, outgoing, answerIncoming, dismissIncoming, registerOutgoing, clearOutgoing };
}
