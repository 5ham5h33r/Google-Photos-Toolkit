export interface RepairDate {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** Conservative parser for repairs: never consume digits from UUIDs or opaque IDs. */
export function repairDateFromFilename(filename: string): RepairDate | null {
  const name = filename.replace(/^.*[\\/]/, '');
  const dates = [...name.matchAll(/(?<!\d)((?:19|20)\d{2})(?:[-_](\d{2})[-_](\d{2})|(\d{2})(\d{2}))(?!\d)/g)];
  // Compact timestamps need a separate match because the date is followed by digits.
  const compact = [...name.matchAll(/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)/g)];
  if (dates.length + compact.length !== 1) return null;
  const match = compact[0] ?? dates[0];
  const result: RepairDate = {
    year: Number(match[1]),
    month: Number(compact.length ? match[2] : match[2] ?? match[4]),
    day: Number(compact.length ? match[3] : match[3] ?? match[5]),
  };
  if (compact.length) {
    result.hour = Number(match[4]);
    result.minute = Number(match[5]);
    result.second = Number(match[6]);
  } else {
    const tail = name.slice((match.index ?? 0) + match[0].length);
    // An opaque suffix (including a UUID) is date-only. Explicit times must be complete.
    const time = tail.match(/^[T _-](?:(\d{2})(\d{2})(\d{2})(?:\d{3})?|(\d{2})[.:-](\d{2})[.:-](\d{2}))(?![\dA-Za-z])/);
    if (time) {
      result.hour = Number(time[1] ?? time[4]);
      result.minute = Number(time[2] ?? time[5]);
      result.second = Number(time[3] ?? time[6]);
    } else if (/^[T _-]\d{2}(?:[.:-]\d{2}|\d{2})/.test(tail) && !/^_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tail)) {
      return null;
    }
  }
  const date = new Date(Date.UTC(result.year, result.month - 1, result.day));
  if (date.getUTCFullYear() !== result.year || date.getUTCMonth() !== result.month - 1 || date.getUTCDate() !== result.day) return null;
  if (result.hour !== undefined && (result.hour > 23 || (result.minute ?? 0) > 59 || (result.second ?? 0) > 59)) return null;
  return result;
}

export interface RepairTimestamp {
  timestampSec: number;
  timezoneSec: number;
}

export function proposeRepairDate(filename: string, timestampMs: number, offsetMs: number | undefined): RepairTimestamp | null {
  const date = repairDateFromFilename(filename);
  if (!date || !Number.isFinite(timestampMs) || offsetMs === undefined || !Number.isFinite(offsetMs) ||
      Math.abs(offsetMs) > 14 * 3600000 || offsetMs % 60000 !== 0) return null;
  // Use the photo's recorded fixed offset, never the browser's local timezone.
  const clock = new Date(timestampMs + offsetMs);
  const timestampSec = Math.floor((Date.UTC(date.year, date.month - 1, date.day,
    date.hour ?? clock.getUTCHours(), date.minute ?? clock.getUTCMinutes(), date.second ?? clock.getUTCSeconds()) - offsetMs) / 1000);
  return Number.isSafeInteger(timestampSec) ? { timestampSec, timezoneSec: offsetMs / 1000 } : null;
}
