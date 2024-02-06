import { ArrayTools } from 'swiss-ak';
import { out } from 'swiss-node';

export const getTerminalSizeBox = (numCols: number, numRows: number) => {
  const termAspectRatio = numCols / numRows;

  const boxHeight = 10;
  const boxWidth = Math.round(Math.max(10, boxHeight * termAspectRatio));

  const horLineIndex = 2;
  const verLineIndex = 2;

  const maxRowsLabel = numRows * 2 + '';

  const verticalLine = ArrayTools.create(boxHeight - 2).map((_, i) => {
    if (i === horLineIndex) return out.center('+', maxRowsLabel.length, '-');
    if (i === horLineIndex + 2) return maxRowsLabel;
    return out.center('|', maxRowsLabel.length, ' ');
  });
  const innerBox = verticalLine.map((line, index) => {
    if (index === horLineIndex) {
      const label = `- ${numCols} `;
      return '-'.repeat(verLineIndex - 1) + line + label + '-'.repeat(boxWidth - verLineIndex - line.length - label.length);
    }
    return ' '.repeat(verLineIndex - 1) + line + ' '.repeat(boxWidth - verLineIndex - line.length);
  });
  const box = [
    '╭' + '─'.repeat(boxWidth - 1) + '╮',
    ...innerBox.map((line, index) => {
      return '│' + line + '│';
    }),
    '╰' + '─'.repeat(boxWidth - 1) + '╯'
  ].join('\n');

  return box;
};
