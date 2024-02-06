export const ditherImage = (pixels: number[][], width: number, height: number, threshold: number) => {
  // store of quantization errors (for dithering)
  const quants: number[][] = new Array(width).fill(1).map(() => new Array(height).fill(0));
  const storeQuantErr = (x: number, y: number, v: number) => {
    if (x < 0 || x >= width || y >= height) return;
    quants[x][y] += v;
  };

  const result = structuredClone(pixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luma = pixels[y][x];

      const dithered = luma + quants[x][y];
      result[y][x] = dithered > threshold ? 255 : 0;
      const qu_err = dithered - result[y][x];

      storeQuantErr(x + 1, y, (qu_err * 7) / 16);
      storeQuantErr(x - 1, y + 1, (qu_err * 3) / 16);
      storeQuantErr(x, y + 1, (qu_err * 5) / 16);
      storeQuantErr(x + 1, y + 1, (qu_err * 1) / 16);
    }
  }

  return result;
};
