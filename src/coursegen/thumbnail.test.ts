import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  findExistingThumbnail,
  findPrimaryMp4,
  pickEarlyFrameSeconds
} from './thumbnail.ts';

describe('coursegen video thumbnails', () => {
  it('picks a random early frame inside the first 12s / 12% window', () => {
    for (let i = 0; i < 20; i++) {
      const long = pickEarlyFrameSeconds(210);
      assert.ok(long >= 1.5 && long <= 12);

      const short = pickEarlyFrameSeconds(34);
      assert.ok(short >= 1.5 && short <= 34 * 0.12);
    }
  });

  it('clamps to the video duration for very short clips', () => {
    const seek = pickEarlyFrameSeconds(1);
    assert.ok(seek >= 0 && seek <= 0.9);
  });

  it('prefers an existing thumbnail.jpg over capturing again', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-thumb-'));
    const thumbnail = path.join(dir, 'thumbnail.jpg');
    writeFileSync(thumbnail, 'fake');
    writeFileSync(path.join(dir, 'final.mp4'), 'fake');
    assert.equal(findExistingThumbnail(dir), thumbnail);
  });

  it('prefers final.mp4 as the thumbnail source', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-mp4-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'preview.mp4'), 'a');
    writeFileSync(path.join(dir, 'final.mp4'), 'b');
    assert.equal(findPrimaryMp4(dir), path.join(dir, 'final.mp4'));
  });
});
