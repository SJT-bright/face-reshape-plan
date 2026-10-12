/* 本地视频首帧：第 0 秒必须是第一段颜色，不能抽到后面的画面。 */
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { videoPoster } = require('../src/js/video-poster');

const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'face-poster-'));
const clip = path.join(root, 'red-then-blue.mp4');
const real = path.join(__dirname, '..', '跟练视频', '抖音-清醒雄竞的爽感-7620084017840344329.mp4');

function center(file) {
  const image = nativeImage.createFromPath(file);
  const { width, height } = image.getSize();
  assert.ok(width > 0 && height > 0, file);
  const bitmap = image.getBitmap();
  const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return { b: bitmap[i], g: bitmap[i + 1], r: bitmap[i + 2], width, height };
}

app.whenReady().then(async () => {
  try {
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip
    ]);
    const first = await videoPoster(clip, path.join(root, 'ffmpeg'));
    assert.match(first, /^file:/);
    const red = center(new URL(first).pathname);
    assert.ok(red.r > 200 && red.g < 50 && red.b < 50, `首帧应是红色，实际 ${JSON.stringify(red)}`);
    assert.equal(await videoPoster(clip, path.join(root, 'ffmpeg')), first, '同一文件应复用已生成的首帧');

    process.env.FACE_POSTER_NO_FFMPEG = '1';
    const browser = await videoPoster(clip, path.join(root, 'browser'));
    delete process.env.FACE_POSTER_NO_FFMPEG;
    assert.match(browser, /^file:/);
    const again = center(new URL(browser).pathname);
    assert.ok(again.r > 200 && again.g < 50 && again.b < 50, `无 ffmpeg 时首帧也应是红色，实际 ${JSON.stringify(again)}`);

    assert.equal(await videoPoster(path.join(root, 'missing.mp4'), path.join(root, 'none')), '');
    fs.writeFileSync(path.join(root, 'not-video.mp4'), 'not a video');
    assert.equal(await videoPoster(path.join(root, 'not-video.mp4'), path.join(root, 'bad')), '');

    if (fs.existsSync(real)) {
      const url = await videoPoster(real, path.join(root, 'douyin'));
      assert.match(url, /^file:/);
      const frame = nativeImage.createFromPath(new URL(url).pathname);
      const { width, height } = frame.getSize();
      const bitmap = frame.getBitmap();
      let luma = 0;
      const step = Math.max(4, Math.floor(bitmap.length / 4 / 400)) * 4;
      let n = 0;
      for (let i = 0; i < bitmap.length; i += step) {
        luma += bitmap[i + 2] * 0.2126 + bitmap[i + 1] * 0.7152 + bitmap[i] * 0.0722;
        n++;
      }
      assert.ok(width >= 320 && height >= 320, `抖音首帧尺寸异常 ${width}x${height}`);
      assert.ok(luma / n > 12, '抖音首帧不应是黑屏');
      fs.copyFileSync(new URL(url).pathname, '/tmp/douyin-first-frame.jpg');
      console.log('DOUYIN_FRAME', width, height, 'luma', Math.round(luma / n));
    }
    console.log('VIDEO_POSTER_PASS');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
