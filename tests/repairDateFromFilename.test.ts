import {describe, expect, it} from 'vitest';
import {repairDateFromFilename, proposeRepairDate} from '../src/utils/repairDateFromFilename';

describe('conservative repair dates', () => {
  it.each([
    '2023-05-15_c19f0000-20b4-4000-a000-000000000000-main.jpg',
    '2023-05-15_ee18fc15-28f5-4000-a000-000000000000-main.jpg',
    '2023-05-15_b~opaque04opaque.jpeg',
  ])('does not read time from an identifier: %s', name => {
    expect(repairDateFromFilename(name)?.hour).toBeUndefined();
    expect(repairDateFromFilename(name)?.year).toBeGreaterThan(2000);
  });
  it.each([
    ['IMG_20230515_003022.jpg', 0, 30, 22],
    ['Screenshot_2023-05-15-00-30-22.png', 0, 30, 22],
    ['Screenshot_2023-05-15-14-00-22.png', 14, 0, 22],
    ['Screenshot 2023-05-15 143022.png', 14, 30, 22],
    ['PXL_20230515_143022123.jpg', 14, 30, 22],
    ['IMG20240127180629.jpg', 18, 6, 29],
  ])('reads a complete timestamp: %s', (name, hour, minute, second) => {
    expect(repairDateFromFilename(name)).toMatchObject({hour, minute, second});
  });
  it.each(['Snapchat-421429335-edited.jpg', 'ssnaps_A2FDE52B.jpg', '2023-02-30.jpg',
    'copy_20230515_of_20220101.jpg', 'IMG_20230515_240000.jpg', '2023-05-15_14-60-22.png'])('skips unknown, invalid, or ambiguous names: %s', name => {
    expect(repairDateFromFilename(name)).toBeNull();
  });
  it('preserves the clock for date-only names in the photo timezone', () => {
    const old = Date.parse('2026-10-22T19:43:12Z'); // 01:13:12 in +05:30
    expect(proposeRepairDate('2017-05-04_random-id.jpg', old, 19800000)).toEqual({
      timestampSec: Date.parse('2017-05-03T19:43:12Z') / 1000, timezoneSec: 19800,
    });
  });
  it('uses the stored timezone rather than local Date construction', () => {
    expect(proposeRepairDate('IMG_20230515_003022.jpg', 0, 19800000)).toEqual({
      timestampSec: Date.parse('2023-05-14T19:00:22Z') / 1000, timezoneSec: 19800,
    });
  });
  it('does not invent an offset when it is unknown', () => {
    expect(proposeRepairDate('2023-05-15.jpg', 0, undefined)).toBeNull();
    expect(proposeRepairDate('2023-05-15.jpg', 0, 0)?.timezoneSec).toBe(0);
  });
  it.each(['hashabc20230515def.jpg','abc20230515123456def.mp4','2023-05-15extra.jpg','2023-05-15T14.jpg','2023-05-15T14xx.jpg'])('does not infer a date embedded in an opaque token or incomplete timestamp: %s',name=>{
    expect(repairDateFromFilename(name)).toBeNull();
  });
  it('rejects an out-of-range original date even with an explicit filename time',()=>{
    expect(proposeRepairDate('IMG_20230515_003022.jpg',1e18,0)).toBeNull();
  });
});
