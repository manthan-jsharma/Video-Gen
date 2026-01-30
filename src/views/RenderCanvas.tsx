import React, { useEffect, useState } from 'react';
import { ReelPlayer } from './ReelPlayer';

export const RenderCanvas: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [debugMsg, setDebugMsg] = useState("Initializing...");

  // FORCE HD RESOLUTION
  const WIDTH = 1080;
  const HEIGHT = 1920;

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
    <div 
      className="relative overflow-hidden bg-black"
      // Explicitly set the container size to match Puppeteer's viewport
      style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }} 
    >
      <div className="absolute top-0 left-0 z-[999] bg-red-500/50 text-white text-[24px] pointer-events-none">
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
        // Scale font up for 1080p (32px on 540p -> 64px on 1080p)
        subtitleFontSize={data.subtitleFontSize ? data.subtitleFontSize * 2 : 64} 
      />

      <RenderController isPlaying={isPlaying} setDebugMsg={setDebugMsg}/>
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

    video.onerror = () => {
        const err = video.error;
        setDebugMsg(`❌ Video Error: ${err?.code} - ${err?.message}`);
        console.error("Video Error Details:", err);
    };

    const signalReady = () => {
        if (!document.getElementById('ready-to-record')) {
            console.log("✅ Video Ready. Signaling Server.");
            setDebugMsg("✅ Ready. Waiting for server record command...");
            const div = document.createElement('div');
            div.id = 'ready-to-record';
            document.body.appendChild(div);
        }
    };

    if (video.readyState >= 3) signalReady();
    video.oncanplay = signalReady;
    video.onloadeddata = signalReady;
    
    // Timeout fallback
    const timeout = setTimeout(() => {
        setDebugMsg("⚠️ Timeout forced ready. Video might be broken.");
        signalReady();
    }, 15000);

    if (isPlaying) {
      setDebugMsg("▶️ Playing...");
      video.muted = false; 
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