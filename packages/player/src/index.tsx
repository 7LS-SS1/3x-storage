"use client";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import "./player.css";

export type PlayerEvent = "ready" | "play" | "playing" | "pause" | "ended" | "error" | "timeupdate";
export type SecurePlayerProps = {
  source: string; sourceType?: string; poster?: string; title?: string; expiresAt?: number;
  onEvent?: (event: PlayerEvent, video: HTMLVideoElement) => void;
  onRefreshAuthorization?: () => Promise<string>;
};

type PlaybackError = {
  message: string;
  retryLabel: string;
};

export function isHlsPlayback(source: string, sourceType?: string) {
  if (sourceType?.toLowerCase().includes("mpegurl")) return true;
  try {
    return new URL(source).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return source.split("?", 1)[0]?.toLowerCase().endsWith(".m3u8") ?? false;
  }
}

export type HlsPlaybackMode = "hls.js" | "native" | "unsupported";

type WebKitFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitRequestFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

export function requestPlayerFullscreen(
  container: HTMLElement,
  video: HTMLVideoElement,
  fullscreenEnabled = typeof document === "undefined" ? false : document.fullscreenEnabled
) {
  const webkitVideo = video as WebKitFullscreenVideo;

  // iPhone Safari does not support element fullscreen consistently, but it
  // exposes a native fullscreen player directly on the video element.
  if (
    fullscreenEnabled !== true &&
    webkitVideo.webkitSupportsFullscreen !== false &&
    webkitVideo.webkitEnterFullscreen
  ) {
    webkitVideo.webkitEnterFullscreen();
    return;
  }

  if (container.requestFullscreen) {
    void container.requestFullscreen().catch(() => {
      webkitVideo.webkitEnterFullscreen?.();
    });
    return;
  }

  if (webkitVideo.webkitEnterFullscreen) {
    webkitVideo.webkitEnterFullscreen();
    return;
  }

  webkitVideo.webkitRequestFullscreen?.();
}

export function selectHlsPlaybackMode(
  hlsJsSupported: boolean,
  nativeSupport: CanPlayTypeResult
): HlsPlaybackMode {
  if (hlsJsSupported) return "hls.js";
  if (nativeSupport) return "native";
  return "unsupported";
}

function nativeMediaErrorMessage(error: MediaError | null) {
  switch (error?.code) {
    case 2:
      return "เครือข่ายขัดข้องระหว่างโหลดวิดีโอ กรุณาลองใหม่";
    case 3:
      return "เบราว์เซอร์ไม่สามารถถอดรหัสวิดีโอนี้ได้";
    case 4:
      return "เบราว์เซอร์ไม่รองรับรูปแบบวิดีโอนี้";
    default:
      return "ไม่สามารถเล่นวิดีโอนี้ได้ กรุณาลองใหม่";
  }
}

const fmt=(n:number)=>`${Math.floor(n/60).toString().padStart(2,"0")}:${Math.floor(n%60).toString().padStart(2,"0")}`;
export function SecureVideoPlayer({source,sourceType,poster,title,onEvent,onRefreshAuthorization}:SecurePlayerProps){
  const ref=useRef<HTMLVideoElement>(null); const wrap=useRef<HTMLDivElement>(null);
  const hlsManaged=useRef(false);
  const [src,setSrc]=useState(source); const [playing,setPlaying]=useState(false); const [started,setStarted]=useState(false); const [muted,setMuted]=useState(false); const [time,setTime]=useState(0); const [duration,setDuration]=useState(0); const [error,setError]=useState<PlaybackError|null>(null); const [retrying,setRetrying]=useState(false);
  useEffect(()=>{setSrc(source);setError(null)},[source]);
  useEffect(()=>{
    const video=ref.current;
    if(!video||!isHlsPlayback(src,sourceType))return;
    const playbackMode=selectHlsPlaybackMode(
      Hls.isSupported(),
      video.canPlayType("application/vnd.apple.mpegurl")
    );
    if(playbackMode==="native"){video.src=src;return;}
    if(playbackMode==="unsupported"){
      setError({message:"เบราว์เซอร์นี้ไม่รองรับการเล่น HLS",retryLabel:"ลองเล่นใหม่"});
      emit("error");
      return;
    }

    let disposed=false;
    let activeHls:Hls|null=null;
    let inlineFallbackUsed=false;
    let mediaRecoveryAttempts=0;
    let authorizationRefreshAttempted=false;

    const fail=(message:string)=>{
      if(disposed)return;
      setError({message,retryLabel:"ลองเล่นใหม่"});
      emit("error");
    };

    const attach=(enableWorker:boolean)=>{
      const instance=new Hls({enableWorker});
      activeHls=instance;
      hlsManaged.current=true;
      instance.on(Hls.Events.MANIFEST_PARSED,()=>{
        if(!disposed&&instance===activeHls)setError(null);
      });
      instance.on(Hls.Events.ERROR,(_event,data)=>{
        if(disposed||instance!==activeHls)return;

        if(
          !data.fatal&&
          enableWorker&&
          !inlineFallbackUsed&&
          data.details===Hls.ErrorDetails.INTERNAL_EXCEPTION&&
          data.event==="demuxerWorker"
        ){
          inlineFallbackUsed=true;
          queueMicrotask(()=>{
            if(disposed||instance!==activeHls)return;
            instance.destroy();
            attach(false);
          });
          return;
        }

        if(!data.fatal)return;
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&mediaRecoveryAttempts<2){
          mediaRecoveryAttempts+=1;
          if(mediaRecoveryAttempts===2)instance.swapAudioCodec();
          instance.recoverMediaError();
          return;
        }
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR&&!authorizationRefreshAttempted&&onRefreshAuthorization){
          authorizationRefreshAttempted=true;
          void onRefreshAuthorization().then(nextSource=>{
            if(disposed)return;
            setError(null);
            setSrc(nextSource);
          }).catch(()=>fail("โหลดสตรีมไม่สำเร็จและไม่สามารถต่ออายุสิทธิ์รับชมได้"));
          return;
        }
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){
          fail("เครือข่ายขัดข้องระหว่างโหลดสตรีม กรุณาลองใหม่");
          return;
        }
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR){
          fail("เบราว์เซอร์ไม่สามารถถอดรหัสสตรีมวิดีโอนี้ได้");
          return;
        }
        fail("ไม่สามารถเริ่มเล่นสตรีม HLS นี้ได้");
      });
      instance.loadSource(src);
      instance.attachMedia(video);
    };

    attach(true);
    return()=>{
      disposed=true;
      hlsManaged.current=false;
      activeHls?.destroy();
    };
  },[src,sourceType,onRefreshAuthorization]);
  const emit=(event:PlayerEvent)=>{const v=ref.current;if(v)onEvent?.(event,v)};
  const startPlayback=()=>{const video=ref.current;if(!video)return;if(video.ended)video.currentTime=0;void video.play()};
  const retry=async()=>{
    if(!onRefreshAuthorization||retrying)return;
    setRetrying(true);
    try{
      setSrc(await onRefreshAuthorization());
      setError(null);
    }catch{
      setError({message:"ไม่สามารถต่ออายุสิทธิ์รับชมได้ กรุณาลองใหม่อีกครั้ง",retryLabel:"ลองอีกครั้ง"});
    }finally{
      setRetrying(false);
    }
  };
  return <div className="svp" ref={wrap} onContextMenu={e=>e.preventDefault()}>
    <video ref={ref} src={isHlsPlayback(src,sourceType)?undefined:src} poster={poster} playsInline preload="metadata" aria-label={title??"เครื่องเล่นวิดีโอ"}
      onLoadedMetadata={e=>{setDuration(e.currentTarget.duration);emit("ready")}} onPlay={()=>{setPlaying(true);setStarted(true);emit("play")}}
      onPlaying={()=>emit("playing")} onPause={()=>{setPlaying(false);emit("pause")}} onEnded={()=>{setPlaying(false);setStarted(false);emit("ended")}}
      onTimeUpdate={e=>{setTime(e.currentTarget.currentTime);emit("timeupdate")}} onError={e=>{if(hlsManaged.current)return;setError({message:nativeMediaErrorMessage(e.currentTarget.error),retryLabel:"ลองเล่นใหม่"});emit("error")}}/>
    {poster&&!started&&!error&&<button type="button" className="svp-poster" aria-label={`เล่นวิดีโอ ${title??""}`.trim()} onClick={startPlayback}>
      <img src={poster} alt="" draggable={false}/><span><Play/></span>
    </button>}
    {error&&<div className="svp-error"><b>เกิดข้อผิดพลาดในการเล่น</b><span>{error.message}</span>{onRefreshAuthorization&&<button type="button" disabled={retrying} onClick={retry}>{retrying?"กำลังลองใหม่...":error.retryLabel}</button>}</div>}
    <div className="svp-controls"><input aria-label="เลื่อนตำแหน่งวิดีโอ" type="range" min="0" max={duration||0} value={time} onChange={e=>{if(ref.current)ref.current.currentTime=+e.target.value}}/>
      <div><span>
        <button aria-label="ย้อนกลับ 10 วินาที" onClick={()=>{if(ref.current)ref.current.currentTime-=10}}><RotateCcw/></button>
        <button aria-label={playing?"หยุดชั่วคราว":"เล่น"} onClick={()=>playing?ref.current?.pause():startPlayback()}>{playing?<Pause/>:<Play/>}</button>
        <button aria-label="เดินหน้า 10 วินาที" onClick={()=>{if(ref.current)ref.current.currentTime+=10}}><RotateCw/></button>
        <i>{fmt(time)} / {fmt(duration)}</i>
      </span><span>
        <button aria-label={muted?"เปิดเสียง":"ปิดเสียง"} onClick={()=>{if(ref.current){ref.current.muted=!muted;setMuted(!muted)}}}>{muted?<VolumeX/>:<Volume2/>}</button>
        <button type="button" aria-label="เต็มหน้าจอ" onClick={()=>{if(wrap.current&&ref.current)requestPlayerFullscreen(wrap.current,ref.current)}}><Maximize/></button>
      </span></div>
    </div>
  </div>;
}
