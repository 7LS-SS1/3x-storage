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
const fmt=(n:number)=>`${Math.floor(n/60).toString().padStart(2,"0")}:${Math.floor(n%60).toString().padStart(2,"0")}`;
export function SecureVideoPlayer({source,sourceType,poster,title,onEvent,onRefreshAuthorization}:SecurePlayerProps){
  const ref=useRef<HTMLVideoElement>(null); const wrap=useRef<HTMLDivElement>(null);
  const [src,setSrc]=useState(source); const [playing,setPlaying]=useState(false); const [muted,setMuted]=useState(false); const [time,setTime]=useState(0); const [duration,setDuration]=useState(0); const [error,setError]=useState("");
  useEffect(()=>setSrc(source),[source]);
  useEffect(()=>{
    const video=ref.current;
    if(!video||sourceType!=="application/vnd.apple.mpegurl")return;
    if(video.canPlayType("application/vnd.apple.mpegurl")){video.src=src;return;}
    if(!Hls.isSupported())return;
    const hls=new Hls({enableWorker:true});
    hls.loadSource(src);hls.attachMedia(video);
    hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal){setError("ไม่สามารถเล่นสตรีม HLS นี้ได้");emit("error")}});
    return()=>hls.destroy();
  },[src,sourceType]);
  const emit=(event:PlayerEvent)=>{const v=ref.current;if(v)onEvent?.(event,v)};
  const retry=async()=>{if(!onRefreshAuthorization)return;try{setSrc(await onRefreshAuthorization());setError("")}catch{setError("ลิงก์รับชมหมดอายุ กรุณาลองใหม่อีกครั้ง")}};
  return <div className="svp" ref={wrap} onContextMenu={e=>e.preventDefault()}>
    <video ref={ref} src={sourceType==="application/vnd.apple.mpegurl"?undefined:src} poster={poster} playsInline preload="metadata" aria-label={title??"เครื่องเล่นวิดีโอ"}
      onLoadedMetadata={e=>{setDuration(e.currentTarget.duration);emit("ready")}} onPlay={()=>{setPlaying(true);emit("play")}}
      onPlaying={()=>emit("playing")} onPause={()=>{setPlaying(false);emit("pause")}} onEnded={()=>emit("ended")}
      onTimeUpdate={e=>{setTime(e.currentTarget.currentTime);emit("timeupdate")}} onError={()=>{setError("ไม่สามารถเล่นวิดีโอนี้ได้");emit("error")}}/>
    {error&&<div className="svp-error"><b>เกิดข้อผิดพลาดในการเล่น</b><span>{error}</span>{onRefreshAuthorization&&<button onClick={retry}>ขอสิทธิ์รับชมใหม่</button>}</div>}
    <div className="svp-controls"><input aria-label="เลื่อนตำแหน่งวิดีโอ" type="range" min="0" max={duration||0} value={time} onChange={e=>{if(ref.current)ref.current.currentTime=+e.target.value}}/>
      <div><span>
        <button aria-label="ย้อนกลับ 10 วินาที" onClick={()=>{if(ref.current)ref.current.currentTime-=10}}><RotateCcw/></button>
        <button aria-label={playing?"หยุดชั่วคราว":"เล่น"} onClick={()=>playing?ref.current?.pause():ref.current?.play()}>{playing?<Pause/>:<Play/>}</button>
        <button aria-label="เดินหน้า 10 วินาที" onClick={()=>{if(ref.current)ref.current.currentTime+=10}}><RotateCw/></button>
        <i>{fmt(time)} / {fmt(duration)}</i>
      </span><span>
        <button aria-label={muted?"เปิดเสียง":"ปิดเสียง"} onClick={()=>{if(ref.current){ref.current.muted=!muted;setMuted(!muted)}}}>{muted?<VolumeX/>:<Volume2/>}</button>
        <button aria-label="เต็มหน้าจอ" onClick={()=>wrap.current?.requestFullscreen()}><Maximize/></button>
      </span></div>
    </div>
  </div>;
}
