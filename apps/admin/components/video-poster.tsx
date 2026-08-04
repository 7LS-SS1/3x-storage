"use client";

import { ImageOff } from "lucide-react";
import React, { useEffect, useState } from "react";

export function MiniPoster({ title, url }: { title: string; url: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return (
      <span className="mini-thumb mini-thumb-empty" title="ไม่มีรูปหน้าปก">
        <ImageOff />
        <small>ไม่มีรูป</small>
      </span>
    );
  }

  return (
    <span className="mini-thumb mini-thumb-image">
      <img
        alt={`รูปหน้าปก ${title}`}
        loading="lazy"
        onError={() => setFailed(true)}
        src={url}
      />
    </span>
  );
}
