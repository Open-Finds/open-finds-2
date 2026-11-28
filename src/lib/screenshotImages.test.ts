import { expect, it } from 'vitest';
import { shrinkImage, shrinkImages } from './screenshotImages';

it('skips anything that is not a picture, and reads at most the limit', async () => {
  const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
  expect(await shrinkImage(text)).toBeNull();
  expect(await shrinkImages([text, text, text], 2)).toEqual([]);
});
