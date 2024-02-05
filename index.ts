import { $ } from 'bun';
import fs from 'fs/promises';
import path from 'path';

import minimist from 'minimist';
import { ArrayTools, PromiseTools, fn, seconds, wait, waitUntil } from 'swiss-ak';
import { ansi, ask, out, LOG, getLineCounter, getKeyListener } from 'swiss-node';
import Jimp from 'jimp';

await LOG('---- START ----');
await LOG('---- START ----');

const lc = getLineCounter();
ask.customise({ general: { lc } });

const args = minimist(process.argv.slice(2));

const FILE_SRC = args.source ? path.resolve(args.source) : await ask.fileExplorer('Select the source video', 'f', path.resolve('files'));
const DIR_FRAMES = path.resolve('files/frames');

// get the video stats
const videoStats = await (async () => {
  const probeLines = (await $`ffprobe -select_streams v -show_streams ${FILE_SRC} 2>/dev/null | grep =`.text()).split('\n').filter(fn.exists);

  const probe = Object.fromEntries(probeLines.map((line) => line.split('=').map((x) => x.trim())));

  const width = Number(probe.width);
  const height = Number(probe.height);
  const aspectRatio = width / height;
  const framerate = Number(probe.r_frame_rate.split('/')[0]) / Number(probe.r_frame_rate.split('/')[1]);

  return { width, height, framerate, aspectRatio };
})();

// extract and get user input (at same time)
let userInput = await (async () => {
  let loader: ReturnType<typeof out.loading> = { stop: fn.noop };

  const extractFramesFromVideo = async () => {
    // const loader = out.loading((s) => `Extracting the frames from the video: ${s}`);
    await fs.rm(DIR_FRAMES, { recursive: true });
    await fs.mkdir(DIR_FRAMES, { recursive: true });

    await $`ffmpeg -r 1 -i ${FILE_SRC} -r 1 ${path.join(DIR_FRAMES, 'frame-%04d.bmp')}`.quiet();
    // loader.stop();
  };

  // ask for the output size and framerate
  const getUserInput = async () => {
    const maxCols = process.stdout.columns;
    const maxRows = process.stdout.rows - 1;

    const maxWidth = Math.floor(Math.min(maxCols, videoStats.width, maxRows * 2 * videoStats.aspectRatio));
    const width = await ask.number('How wide would you like the display?', maxWidth);

    const idealHeight = Math.floor(Math.min(width / videoStats.aspectRatio, maxRows * 2));
    const height = await ask.number('How tall would you like the display?', idealHeight);

    const showFramerate = await ask.boolean('Would you like to display the framerate?', false);

    loader = out.loading((s) => `Extracting the frames from the video: ${s}`);

    return { width, height, showFramerate };
  };

  const { userInput } = await PromiseTools.allObj({
    frames: extractFramesFromVideo(),
    userInput: getUserInput()
  });
  loader.stop();
  return userInput;
})();

const allFrames = (await fs.readdir(DIR_FRAMES)).sort().map((frame) => path.join(DIR_FRAMES, frame));

const getSingleFrameOutput = async (frame: string) => {
  await $`gm convert ${frame} -resize ${`${userInput.width}x${userInput.height}!`} -threshold 50% ${frame}`.text();
  const image = await Jimp.read(frame);

  const { width, height, data } = image.bitmap;

  const pixels: boolean[][] = ArrayTools.create(height, 1).map(() => []);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y][x] = data[(y * width + x) * 4] > 128;
    }
  }

  const chars = [' ', '▀', '▄', '█'];
  let result: string = '';
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const isTop = Number(pixels[y]?.[x] ?? false);
      const isBot = Number(pixels[y + 1]?.[x] ?? false);
      result += chars[isTop * 1 + isBot * 2];
    }
    result += '\n';
  }

  result = result.slice(0, -1);

  result = out.center(result);
  return result;
};

// run animation
{
  lc.clear();
  await ask.pause('Animation is ready to start. Press enter to continue.');
  await wait(1000);

  const frameOuts = ArrayTools.create(allFrames.length, 1);

  const displayFrame = (frameOut: string) => {
    const output = lc.ansi.moveHome() + frameOut;
    lc.overwrite(output);
  };

  const kl = getKeyListener((key) => {
    switch (key) {
      case 'q':
      case 'esc':
      case 'exit':
        process.stdout.write(ansi.clear + ansi.cursor.show);
        process.exit(0);
    }
  });

  process.stdout.write(ansi.cursor.hide);
  const perFrame = seconds(1 / videoStats.framerate);
  const start = Date.now();
  let lastFrameTime = Date.now();
  for (let i = 0; i < frameOuts.length; i++) {
    const processStart = Date.now();
    const frameOutput = await getSingleFrameOutput(allFrames[i]);
    const processTime = Date.now() - processStart;

    const thisFrameTime = Date.now();
    const delta = thisFrameTime - lastFrameTime;
    lastFrameTime = thisFrameTime;

    displayFrame(frameOutput);

    if (userInput.showFramerate) {
      const debugInfo = [
        `Frame: ${(i + 1 + '').padStart(4, ' ')}/${frameOuts.length}`,
        `FPS: ${(1000 / delta).toFixed(2).padStart(6, ' ')}/s`,
        `Frame Time: ${delta}ms`,
        `Process Time: ${processTime}ms`
      ].join('\n');
      process.stdout.write(ansi.cursor.up(debugInfo.split('\n').length) + debugInfo + '\n');
    }

    await waitUntil(start + (i + 1) * perFrame);
  }
  process.stdout.write(ansi.cursor.show);
}
