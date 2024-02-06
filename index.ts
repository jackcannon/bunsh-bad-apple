import { $ } from 'bun';
import fs from 'fs/promises';
import path from 'path';

import minimist from 'minimist';
import { ArrayTools, ColourTools, PromiseTools, fn, getProgressBar, seconds, wait, waitUntil } from 'swiss-ak';
import { ansi, ask, out, getLineCounter, getKeyListener } from 'swiss-node';
import Jimp from 'jimp';
import { getTerminalSizeBox } from './utils/getTerminalSizeBox';
import { ditherImage } from './utils/dither';
import { spreadLuminance } from './utils/spreadLuminance';

const lc = getLineCounter();
ask.customise({ general: { lc, timelineFastSpeed: 20 }, formatters: { formatPrompt: 'fullBox' } });

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
  const numFrames = Number(probe.nb_frames);

  return { width, height, framerate, aspectRatio, numFrames };
})();

// extract and get user input (at same time)
let userInput = await (async () => {
  let loader: ReturnType<typeof out.loading> = { stop: fn.noop };

  const extractFramesFromVideo = async () => {
    await fs.rm(DIR_FRAMES, { recursive: true });
    await fs.mkdir(DIR_FRAMES, { recursive: true });

    await $`ffmpeg -r 1 -i ${FILE_SRC} -r 1 ${path.join(DIR_FRAMES, 'frame-%04d.bmp')}`.quiet();
  };

  // ask for the output size and framerate
  const getUserInput = async () => {
    const maxCols = process.stdout.columns;
    const maxRows = process.stdout.rows - 1;

    const suggWidth = Math.floor(Math.min(maxCols, videoStats.width, maxRows * 2 * videoStats.aspectRatio));
    const suggHeight = Math.floor(Math.min(suggWidth / videoStats.aspectRatio, maxRows * 2));

    lc.log();
    lc.log(out.center('Terminal Size:', undefined, ' ', false));
    lc.log(out.center(getTerminalSizeBox(maxCols, maxRows), undefined, ' ', false));
    lc.log();
    lc.log(out.center(`Suggested Width: ${suggWidth}`, undefined, ' ', false));
    lc.log(out.center(`Suggested Height: ${suggHeight}`, undefined, ' ', false));

    const width = await ask.number('How wide would you like the display?', suggWidth);

    const idealHeight = Math.floor(Math.min(width / videoStats.aspectRatio, maxRows * 2));
    const height = await ask.number('How tall would you like the display?', idealHeight);

    const preprocess = await ask.boolean('Would you like to pre-process the frames?', true);

    const dither = await ask.boolean('Would you like to dither the output?', true);

    const showFramerate = await ask.boolean('Would you like to display the framerate?', true);

    lc.log();
    lc.log('  Hint: Use a lower threshold for darker videos and a higher threshold for brighter videos.');
    lc.log('        50% is fine for bad apple');
    lc.log();
    const threshold = await ask.number('What threshold would you like to use (%)?', 50);

    lc.checkpoint('pre-trim');
    let trim: { start: number; end: number } = { start: 0, end: videoStats.numFrames };
    const isTrim = await ask.boolean('Would you like to trim the video?', false);
    if (isTrim) {
      lc.clearToCheckpoint('pre-trim');
      trim = await ask.trim('How would you like to trim the video?', videoStats.numFrames, videoStats.framerate);
    }

    loader = out.loading((s) => `Extracting the frames from the video: ${s}`);

    return { width, height, preprocess, dither, showFramerate, threshold, trim };
  };

  const { userInput } = await PromiseTools.allObj({
    frames: extractFramesFromVideo(),
    userInput: getUserInput()
  });
  loader.stop();
  return userInput;
})();

const kl = getKeyListener((key) => {
  switch (key) {
    case 'q':
    case 'esc':
    case 'exit':
      process.stdout.write(ansi.clear + ansi.cursor.show);
      process.exit(0);
  }
});

const allFrames = (await fs.readdir(DIR_FRAMES))
  .sort()
  .map((frame) => path.join(DIR_FRAMES, frame))
  .slice(userInput.trim.start, userInput.trim.end);

const getSingleFrameOutput = async (frame: string) => {
  const colourArgs = userInput.dither ? '' : `-threshold ${`${userInput.threshold}%`}`;

  await $`gm convert ${frame} -resize ${`${userInput.width}x${userInput.height}!`} ${colourArgs} ${frame}`.text();
  const image = await Jimp.read(frame);

  const { width, height, data } = image.bitmap;

  let pixels: number[][] = ArrayTools.create(height, 1).map(() => []);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const baseIndex = (y * width + x) * 4;
      const rgb: [number, number, number] = [data[baseIndex], data[baseIndex + 1], data[baseIndex + 2]];
      pixels[y][x] = ColourTools.getLuminance(rgb);
      // if (userInput.dither) pixels[y][x] = spreadLuminance(pixels[y][x], 1.6);
    }
  }
  const threshold = (userInput.threshold / 100) * 255;

  pixels = ditherImage(pixels, width, height, threshold);

  // const chars = [' ', '"', 'o', '8'];
  const chars = [' ', '▀', '▄', '█'];
  let result: string = '';
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const isTop = (pixels[y]?.[x] ?? 0) > threshold;
      const isBot = (pixels[y + 1]?.[x] ?? 0) > threshold;
      result += chars[Number(isTop) * 1 + Number(isBot) * 2];
    }
    result += '\n';
  }

  result = result.slice(0, -1);

  result = out.center(result);

  await wait(10);
  return result;
};

const preprocessed: string[] = await (async () => {
  if (!userInput.preprocess) return [];

  lc.log('');
  const progress = getProgressBar(allFrames.length, { prefix: 'Processing frames', prefixWidth: 20 });
  progress.start();

  const result = await PromiseTools.mapLimit(32, allFrames, async (frame) => {
    const result = await getSingleFrameOutput(frame);
    progress.next();
    return result;
  });

  lc.wrap(2, () => progress.finish());

  return result;
})();

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

  process.stdout.write(ansi.cursor.hide);
  const perFrame = seconds(1 / videoStats.framerate);
  const start = Date.now();
  let lastFrameTime = Date.now();
  for (let i = 0; i < frameOuts.length; i++) {
    const processStart = Date.now();
    const frameOutput = userInput.preprocess ? preprocessed[i] : await getSingleFrameOutput(allFrames[i]);
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
  kl.stop();
  process.exit();
}
