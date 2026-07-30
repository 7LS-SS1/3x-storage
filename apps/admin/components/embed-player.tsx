"use client";

import { SecureVideoPlayer, type PlayerEvent } from "@video/player";
import { useRef } from "react";

type PlaybackGrant = {
  playbackSessionId: string;
  expires: number;
  mediaUrl: string;
  eventToken: string;
};

export function EmbedPlayer({
  title,
  initialGrant
}: {
  title: string;
  initialGrant: PlaybackGrant;
}) {
  const grant = useRef(initialGrant);
  const continuousStartedAt = useRef<number | null>(null);
  const playEventSent = useRef(false);

  async function refreshAuthorization() {
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
    return next.mediaUrl;
  }

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
      source={initialGrant.mediaUrl}
      title={title}
    />
  );
}
