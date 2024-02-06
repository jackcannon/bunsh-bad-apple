import { MathsTools } from 'swiss-ak';

enum MODE {
  CENTRE = 'centre', // more at centre, less at edges
  EDGE = 'edge', // more at edges, less at centre
  NUDGE = 'nudge' // add/subtract a fixed amount away from the centre
}

// kind of like a contrast function, but very basic and not very good
export const spreadLuminance = (value: number, amount: number = 1.1, mode: MODE = MODE.CENTRE) => {
  let result = value;

  if (value < 128) {
    if (mode === MODE.CENTRE) result = value * (1 / amount);
    if (mode === MODE.EDGE) result = 128 - (128 - value) * amount;
    if (mode === MODE.NUDGE) result = value - (amount - 1) * 255;
  } else {
    if (mode === MODE.CENTRE) result = 255 - (255 - value) * (1 / amount);
    if (mode === MODE.EDGE) result = 128 + (value - 128) * amount;
    if (mode === MODE.NUDGE) result = value + (amount - 1) * 255;
  }
  return Math.round(MathsTools.clamp(MathsTools.ff(result), 0, 255));
};
