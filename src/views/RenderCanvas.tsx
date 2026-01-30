import React, { useEffect, useState } from 'react';
import { ReelPlayer } from './ReelPlayer';

export const RenderCanvas: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [debugMsg, setDebugMsg] = useState("Initializing...");

  useEffect(() => {
    const handleInit = (e: CustomEvent) => {
      console.log("Received Data in Canvas:", e.detail);
      setDebugMsg("Data Received. Loading Video...");
      setData(e.detail);
    };

    const handlePlay = () => {
      console.log("Starting Playback...");
      setIsPlaying(true);
    };

    window.addEventListener('INIT_RENDER', handleInit as EventListener);
    window.addEventListener('START_PLAYBACK', handlePlay);
    return () => {
      window.removeEventListener('INIT_RENDER', handleInit as EventListener);
      window.removeEventListener('START_PLAYBACK', handlePlay);
    };
  }, []);

  if (!data) return <div className="text-white p-4">Waiting for render config... <br/> {debugMsg}</div>;

  return (
    <div className="w-[540px] h-[960px] relative overflow-hidden bg-black">
      {/* Visual Debugger (Only visible if render fails/stalls) */}
      <div className="absolute top-0 left-0 z-[999] bg-red-500/50 text-white text-[10px] pointer-events-none">
        {debugMsg}
      </div>

      <ReelPlayer
        videoUrl={data.videoUrl}
        srtData={data.srtData}
        htmlContent={data.htmlContent}
        layoutConfig={data.layoutConfig}
        fullScreenMode={true}
        renderMode={true}
        toggleFullScreen={() => {}}
        bgMusicUrl={data.bgMusicUrl}
        subtitleFontSize={data.subtitleFontSize || 32}
      />

      {/* Controller that checks video state */}
      <RenderController 
        isPlaying={isPlaying} 
        setDebugMsg={setDebugMsg}
      />
    </div>
  );
};

const RenderController = ({ isPlaying, setDebugMsg }: { isPlaying: boolean, setDebugMsg: (s: string) => void }) => {
  useEffect(() => {
    const video = document.querySelector('video');
    const audio = document.querySelector('audio');

    if (!video) {
        setDebugMsg("❌ Video Element Not Found!");
        return;
    }

    // 1. Error Handling
    video.onerror = () => {
        const err = video.error;
        setDebugMsg(`❌ Video Error: ${err?.code} - ${err?.message}`);
        console.error("Video Error Details:", err);
    };

    // 2. Success Handling
    const signalReady = () => {
        if (!document.getElementById('ready-to-record')) {
            console.log("✅ Video Ready. Signaling Server.");
            setDebugMsg("✅ Ready. Waiting for server record command...");
            const div = document.createElement('div');
            div.id = 'ready-to-record';
            document.body.appendChild(div);
        }
    };

    // Check immediately
    if (video.readyState >= 3) signalReady();
    
    // Check on event
    video.oncanplay = signalReady;
    video.onloadeddata = signalReady;
    
    // Fallback: If video takes too long, force ready so we get at least logs
    const timeout = setTimeout(() => {
        setDebugMsg("⚠️ Timeout forced ready. Video might be broken.");
        signalReady();
    }, 10000);

    // 3. Playback Logic
    if (isPlaying) {
      setDebugMsg("▶️ Playing...");
      video.muted = false; // Ensure not muted
      video.volume = 1.0;
      
      const playPromise = video.play();
      if (playPromise !== undefined) {
          playPromise.catch(error => {
              setDebugMsg(`❌ Play Error: ${error.message}`);
          });
      }
      
      if (audio) {
          audio.currentTime = video.currentTime;
          audio.play().catch(e => console.warn("Audio play error", e));
      }
    } else {
      video.pause();
    }

    return () => clearTimeout(timeout);
  }, [isPlaying]);

  return null;
};