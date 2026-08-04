"use client";

import { SecureVideoPlayer, type PlayerEvent } from "@video/player";
import { useCallback, useEffect, useRef, useState } from "react";
import { playbackRefreshDelay } from "./playback-refresh";

type PlaybackGrant = {
  playbackSessionId: string;
  expires: number;
  mediaUrl: string;
  eventToken: string;
  mediaType?: string;
  posterUrl?: string | null;
};

export function EmbedPlayer({
  title,
  initialGrant
}: {
  title: string;
  initialGrant: PlaybackGrant;
}) {
  const grant = useRef(initialGrant);
  const refreshInFlight = useRef<Promise<string> | null>(null);
  const continuousStartedAt = useRef<number | null>(null);
  const playEventSent = useRef(false);
  const [source, setSource] = useState(initialGrant.mediaUrl);
  const [poster, setPoster] = useState(initialGrant.posterUrl || null);
  const [expires, setExpires] = useState(initialGrant.expires);

  const refreshAuthorization = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const pending = (async () => {
      const response = await fetch("/backend/playback/refresh", {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playbackSessionId: grant.current.playbackSessionId,
          eventToken: grant.current.eventToken
        })
      });
      if (!response.ok) throw new Error("ไม่สามารถต่ออายุสิทธิ์รับชมได้");
      const next = await response.json() as PlaybackGrant;
      grant.current = next;
      setSource(next.mediaUrl);
      setPoster(next.posterUrl || null);
      setExpires(next.expires);
      return next.mediaUrl;
    })();
    refreshInFlight.current = pending;
    try {
      return await pending;
    } finally {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        await refreshAuthorization();
      } catch {
        if (!cancelled) retryTimer = setTimeout(() => void refresh(), 15_000);
      }
    };
    const refreshTimer = setTimeout(
      () => void refresh(),
      playbackRefreshDelay(expires)
    );
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [expires, refreshAuthorization]);

  function recordPlayEvent() {
    const current = grant.current;
    void fetch("/backend/playback/events", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playbackSessionId: current.playbackSessionId,
        eventType: "play_started",
        continuousSeconds: 3,
        eventToken: current.eventToken
      })
    }).then(response => {
      if (!response.ok) playEventSent.current = false;
    }).catch(() => {
      playEventSent.current = false;
    });
  }

  function onPlayerEvent(event: PlayerEvent) {
    if (event === "playing") {
      continuousStartedAt.current ??= performance.now();
      return;
    }
    if (event === "pause" || event === "ended" || event === "error") {
      continuousStartedAt.current = null;
      return;
    }
    if (
      event === "timeupdate" &&
      !playEventSent.current &&
      continuousStartedAt.current !== null &&
      performance.now() - continuousStartedAt.current >= 3000
    ) {
      playEventSent.current = true;
      recordPlayEvent();
    }
  }

  return (
    <SecureVideoPlayer
      onEvent={onPlayerEvent}
      onRefreshAuthorization={refreshAuthorization}
      source={source}
      sourceType={initialGrant.mediaType}
      poster={poster || undefined}
      title={title}
    />
  );
}
