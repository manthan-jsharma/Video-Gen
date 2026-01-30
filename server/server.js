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

app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/output', express.static(path.join(__dirname, 'output')));

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'))
});
const upload = multer({ storage });

app.post('/api/upload', upload.fields([{ name: 'video' }, { name: 'audio' }]), (req, res) => {
  const files = req.files;
  console.log("📥 Files received:", Object.keys(files));
  
  res.json({
    videoPath: files['video'] ? `http://localhost:${PORT}/uploads/${files['video'][0].filename}` : null,
    audioPath: files['audio'] ? `http://localhost:${PORT}/uploads/${files['audio'][0].filename}` : null,
    localVideoPath: files['video'] ? files['video'][0].path : null,
    localAudioPath: files['audio'] ? files['audio'][0].path : null
  });
});

app.post('/api/render', async (req, res) => {
  const { videoUrl, srtData, htmlContent, layoutConfig, bgMusicUrl, duration, localAudioPath, localVideoPath } = req.body;
  
  // 1. SET HIGH QUALITY RESOLUTION
  const WIDTH = 1080;  
  const HEIGHT = 1920; 

  const rawVideoPath = path.join(outputDir, `raw-${Date.now()}.mp4`);
  const finalOutputPath = path.join(outputDir, `final-${Date.now()}.mp4`);
  const safeVideoPath = path.join(uploadDir, `safe-render-${Date.now()}.mp4`);

  console.log("🎬 Starting High-Quality Render Pipeline...");

  let browser;
  try {
    // 2. PREPARE VIDEO (Transcode if necessary)
    let renderVideoUrl = videoUrl;

    if (localVideoPath) {
        console.log("⚙️  Optimizing video for playback...");
        await new Promise((resolve, reject) => {
            ffmpeg(localVideoPath)
                .outputOptions([
                    '-c:v libx264', '-preset ultrafast', '-c:a aac', '-y'
                ])
                .save(safeVideoPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });
        renderVideoUrl = `http://localhost:${PORT}/uploads/${path.basename(safeVideoPath)}`;
    }

    // 3. RECORD (Using System Chrome)
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      args: [
        '--no-sandbox', 
        `--window-size=${WIDTH},${HEIGHT}`, 
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',
        '--enable-gpu',
        '--ignore-gpu-blocklist'
      ],
      defaultViewport: { width: WIDTH, height: HEIGHT }
    });

    const page = await browser.newPage();
    await page.goto(`http://localhost:3000/render-view`, { waitUntil: 'networkidle0' });

    await page.evaluate((data) => {
      window.dispatchEvent(new CustomEvent('INIT_RENDER', { detail: data }));
    }, { videoUrl: renderVideoUrl, srtData, htmlContent, layoutConfig, bgMusicUrl });

    console.log("⏳ Waiting for video buffer...");
    await page.waitForSelector('#ready-to-record', { timeout: 90000 });
    console.log("✅ Video Loaded & Ready!");

    const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
    const recorder = new PuppeteerScreenRecorder(page, {
        fps: 30, 
        videoFrame: { width: WIDTH, height: HEIGHT },
        ffmpeg_Path: null, 
        videoCrf: 18, 
        autopad: { color: 'black' },
    });

    await recorder.start(rawVideoPath);

    await page.evaluate(() => { window.dispatchEvent(new Event('START_PLAYBACK')); });

    await new Promise(r => setTimeout(r, (duration * 1000) + 1000));
    await recorder.stop();
    await browser.close();

    // 4. MERGE AUDIO
    console.log("🎵 Merging Audio...");
    // Use the uploaded WAV (localAudioPath) if available.
    const audioSource = localAudioPath || safeVideoPath;

    if (audioSource && fs.existsSync(audioSource)) {
        console.log("🎤 Using Audio Source:", audioSource);
        await new Promise((resolve, reject) => {
            ffmpeg()
              .input(rawVideoPath)
              .input(audioSource)
              .outputOptions([
                '-c:v copy',       
                '-c:a aac',        
                '-map 0:v:0',      
                '-map 1:a:0',      
                '-shortest'
              ])
              .save(finalOutputPath)
              .on('end', () => resolve())
              .on('error', (err) => reject(err));
        });
        res.json({ downloadUrl: `http://localhost:${PORT}/output/${path.basename(finalOutputPath)}` });
    } else {
        res.json({ downloadUrl: `http://localhost:${PORT}/output/${path.basename(rawVideoPath)}` });
    }

    if (fs.existsSync(safeVideoPath)) try { fs.unlinkSync(safeVideoPath); } catch(e) {}

  } catch (error) {
    console.error("❌ Render failed:", error);
    if(browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Render Server running at http://localhost:${PORT}`);
});