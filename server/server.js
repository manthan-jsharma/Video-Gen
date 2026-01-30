import express from 'express';
import multer from 'multer';
import cors from 'cors';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// 1. Enable CORS for everything (Crucial for video loading)
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(express.json({ limit: '50mb' }));

// 2. Serve Static Files with debug logging
app.use('/uploads', (req, res, next) => {
    console.log("📂 Serving:", req.url);
    next();
}, express.static(path.join(__dirname, 'uploads')));

app.use('/output', express.static(path.join(__dirname, 'output')));

if (!fs.existsSync('server/uploads')) fs.mkdirSync('server/uploads', { recursive: true });
if (!fs.existsSync('server/output')) fs.mkdirSync('server/output', { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'server/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/ /g, '_')) // Sanitize filename
});
const upload = multer({ storage });

app.post('/api/upload', upload.fields([{ name: 'video' }, { name: 'audio' }]), (req, res) => {
  const files = req.files;
  console.log("📥 Files received:", files);
  
  res.json({
    videoPath: files['video'] ? `http://localhost:${PORT}/uploads/${files['video'][0].filename}` : null,
    audioPath: files['audio'] ? `http://localhost:${PORT}/uploads/${files['audio'][0].filename}` : null,
    // Store local paths for FFmpeg
    localVideoPath: files['video'] ? files['video'][0].path : null,
    localAudioPath: files['audio'] ? files['audio'][0].path : null
  });
});

app.post('/api/render', async (req, res) => {
  const { videoUrl, srtData, htmlContent, layoutConfig, bgMusicUrl, duration, localAudioPath, localVideoPath } = req.body;
  
  const rawVideoPath = path.join(__dirname, 'output', `raw-${Date.now()}.mp4`);
  const finalOutputPath = path.join(__dirname, 'output', `final-${Date.now()}.mp4`);

  console.log("🎬 Starting Render Pipeline...");
  console.log("👉 Video Source:", videoUrl);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--window-size=540,960',
        '--autoplay-policy=no-user-gesture-required'
      ],
      defaultViewport: { width: 540, height: 960 }
    });

    const page = await browser.newPage();
    
    // Log console messages from the browser to your node terminal (Helps Debugging!)
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

    await page.goto(`http://localhost:3000/render-view`, { waitUntil: 'networkidle0' });

    await page.evaluate((data) => {
      window.dispatchEvent(new CustomEvent('INIT_RENDER', { detail: data }));
    }, { videoUrl, srtData, htmlContent, layoutConfig, bgMusicUrl });

    console.log("⏳ Waiting for video buffer...");
    // Increased timeout and added visible error check
    await page.waitForSelector('#ready-to-record', { timeout: 90000 });
    console.log("✅ Video Loaded & Ready!");

    const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
    const recorder = new PuppeteerScreenRecorder(page, {
        fps: 30,
        videoFrame: { width: 540, height: 960 },
        ffmpeg_Path: null, 
        videoCrf: 18,
        autopad: { color: 'black' },
    });

    await recorder.start(rawVideoPath);

    await page.evaluate(() => {
        window.dispatchEvent(new Event('START_PLAYBACK'));
    });

    await new Promise(r => setTimeout(r, (duration * 1000) + 2000));
    await recorder.stop();
    await browser.close();

    console.log("🎵 Merging Audio...");
    
    // AUDIO LOGIC FIX:
    // 1. Priority: Background Music (localAudioPath)
    // 2. Fallback: Original Video Audio (localVideoPath)
    // 3. Last Resort: Silent
    
    const audioSource = localAudioPath || localVideoPath;

    if (audioSource) {
        console.log("🎤 Using Audio Source:", audioSource);
        await new Promise((resolve, reject) => {
            ffmpeg()
              .input(rawVideoPath)
              .input(audioSource)
              .outputOptions([
                '-c:v copy',       // Don't re-encode video (fast)
                '-c:a aac',        // Encode audio to AAC
                '-map 0:v:0',      // Use video from input 0 (recording)
                '-map 1:a:0',      // Use audio from input 1 (source file)
                '-shortest'        // Stop when the shortest stream ends
              ])
              .save(finalOutputPath)
              .on('end', () => resolve())
              .on('error', (err) => {
                  console.error("FFmpeg Merge Error:", err);
                  reject(err);
              });
        });
        res.json({ downloadUrl: `http://localhost:${PORT}/output/${path.basename(finalOutputPath)}` });
    } else {
        console.warn("⚠️ No audio source found. Exporting silent video.");
        res.json({ downloadUrl: `http://localhost:${PORT}/output/${path.basename(rawVideoPath)}` });
    }

  } catch (error) {
    console.error("❌ Render failed:", error);
    if(browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Render Server running at http://localhost:${PORT}`);
});