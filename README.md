# Google Photos Toolkit

Bulk organize your media

![demo](media/demo.png)

## How It Works

In your browser, utilizing GP's undocumented web api

## How To Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) userscript manager for your browser
   - If you're on Android, try [Firefox](https://www.mozilla.org/firefox/browsers/mobile/android/), it supports Tampermonkey
2. Click [Install](https://github.com/xob0t/Google-Photos-Toolkit/releases/latest/download/google_photos_toolkit.user.js)
3. Accept installation

### Finding space-consuming media

This example groups all space-consuming media in one album.

1. Make sure "Library" is the selected source
2. Select `SPACE-CONSUMING` in the `Space` filter
3. Select action `Add to new album`

### Identify media not in any albums

Select all albums in the `Exclude albums` filter, then use appropriate action.

### Identifying duplicates/similar images

Use `Similarity` filter with action `Add to new album`
Media with similar thumbnails will be added to the album.

### Deleting all media in the library

As simple as selecting "Library" source, clicking `Move to trash`, then clearing it.

### Repair dates in Locked Folder (experimental)

Open and authenticate to Google Photos' Locked Folder, keep that authenticated page open, open GPTK, and select **Locked** as the source. Use **Repair locked dates**. Other unsupported Locked Folder actions are disabled and rejected; they are never silently changed into Unlock.

Do not reload after authentication: Google may request your password again. If installing an updated userscript, load it before authenticating to Locked Folder.

**Maximum photos per repair run** defaults to **1** for an initial test and can be increased to at most 100. The limit applies before any photos are temporarily opened, including the metadata-inspection pass. Date interval, Image/Video type and duration filters narrow the candidate selection; filters requiring unavailable Locked Folder metadata are disabled. The first matching photos, up to this limit, are inspected. A skipped or already-correct first photo still uses one slot. Leave the limit at 1 until a live inspection/edit/re-lock test succeeds. The source scan is read-only and may list many more items than the inspection limit; the log reports both counts.

The repair works on the existing photos, without uploading copies:

1. It saves a recovery entry before temporarily moving one photo out of Locked Folder to read its filename and current date. Google can change the photo's media ID during that move, so the script resolves its current library ID by its stable deduplication identifier. This lookup is bounded to nearby timeline pages; if it cannot find the item, no date is written. It then returns the photo and verifies folder membership before proceeding to another photo.
2. Once all previewed photos are back in Locked Folder, a table shows the proposed changes. Uncheck changes you do not want, click **Download change log**, and check that the JSON file saved before applying. The browser download cannot be confirmed by the script. Cancel leaves dates unchanged.
3. Each selected photo is opened individually again, checked against the preview, updated, read back to verify its date, and returned to Locked Folder. Stop prevents the next photo from opening; returning the current photo is still attempted.

Only one browser tab can run a repair or recovery for the account at a time. Unknown or ambiguous filenames, missing timezone offsets, and already matching dates are skipped. A leading `YYYY-MM-DD` followed by a UUID or opaque identifier supplies a date only; the existing clock time is preserved. Complete date/time names (including zero hours/minutes and three fractional-second digits) are supported. Calculations use each photo's saved UTC offset, not the browser timezone. Filenames that encode another timezone, such as UTC, need manual review. The general **Date from Name** action for non-locked sources is unchanged.

Failed metadata requests before a date write are skipped only after the item is confirmed back in Locked Folder. A failed source page stops selection instead of using partial results. Identity mismatches, account changes and unverified restoration stop the run. A lost date-write response triggers readback: a matching date is counted as verified; missing/mismatched readback stops with an uncertain outcome rather than claiming the date stayed unchanged. Stop prevents another item from opening and still runs cleanup. Recovery ignores date filters and the inspection cap. Browser close warnings also cover cleanup and pending recovery, although browsers can suppress those warnings.

For local development, run `pnpm build:test` to create a separate **Google Photos Toolkit - Locked Dates TEST** userscript with automatic update URLs disabled. Replace the previous TEST script's contents in Tampermonkey and keep other Toolkit copies disabled. Run `pnpm mock:serve` and open `http://127.0.0.1:8766/lockedfolder` to exercise the full production bundle against synthetic RPC responses. The mock intercepts fetch and has a CSP that blocks network connections; its confirmation dialog is stubbed and recorded. It includes photo/video success, missing metadata, failed restoration/recovery, lost writes, failed readback, stale preview, account/identity failures, pagination and Stop scenarios. Mock success does not establish compatibility with Google's live private APIs.

**Interruption and privacy:** photos temporarily appear in the ordinary library during inspection and editing. A browser crash, logout, network failure, or tab closure can leave the current photo outside Locked Folder. This cannot be made atomic with these undocumented APIs. A minimal recovery entry containing the account and photo identifiers is stored in this browser's Google Photos site storage; filenames, thumbnails, and credentials are not stored in that entry. Keep this site data until recovery completes. After reopening and authenticating to Locked Folder in the same account and browser profile, open GPTK and use **Recover locked photo**. Recovery does not change dates and only clears the entry after verifying the photo is locked. It works even when the photo no longer appears in the Locked source. Other actions are blocked while recovery is pending.

The downloaded JSON change log includes filenames, identifiers, and old/new dates; keep it private. It is a record for manual restoration, not a one-click date rollback. Google can change these private APIs; automated tests use simulated responses and do not establish live compatibility. Test a small selection before broad use. Web Locks, working persistent site storage, and a current authenticated Locked Folder session are required.

### Use GPTK's api

GPTK exports it's api class globally so you can use it in your browser's console.  
It's much more powerful than the UI!

Example usage.
Scan the whole library for media owned by `ownerName` and move it to trash if found.

```js
let nextPageId = null;
const ownerName = 'John';
do {
  const page = await gptkApi.getItemsByUploadedDate(nextPageId);
  for (const item of page.items) {
    if (item.isOwned) continue;
    const itemInfo = await gptkApi.getItemInfoExt(item.mediaKey);
    console.log(`${item.mediaKey} is shared by ${itemInfo.owner.name}`);
    if (itemInfo.owner.name == ownerName) {
      await gptkApi.moveItemsToTrash([itemInfo.dedupKey]);
      console.log(`${item.mediaKey} moved to trash`);
    }
  }
  nextPageId = page.nextPageId;
} while (nextPageId);
console.log('DONE');
```

## Contributions welcome

If you want to learn more about how GP's api works, read [https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c](https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c)  
I just found this post, after doing all the work from zero :D

Also, i've made a userscript that parses all responses and logs them to console in a more readable way, you can find it here - [https://github.com/xob0t/Google-Photos-Toolkit/tree/main/tools](https://github.com/xob0t/Google-Photos-Toolkit/tree/main/tools)

## BUGS

If something does not work, open an [issue](https://github.com/xob0t/Google-Photos-Toolkit/issues) and describe it in detail

If you have a question, open a [discussion](https://github.com/xob0t/Google-Photos-Toolkit/discussions)

## Credits

Borrowed some code and UI inspiration from [undiscord](https://github.com/victornpb/undiscord)

## My Other Google Photos Projects

- Python client with unlimited uploads: [https://github.com/xob0t/gphotos_mobile_client](https://github.com/xob0t/gphotos_mobile_client)
- Disguise any file as media for GP to accept and store it: [https://github.com/xob0t/gp-file-hide](https://github.com/xob0t/gp-file-hide)

## ♥

If GPTK is useful to you, please consider supporting the project:

BTC `12znTocLytrrYhQT4AJVeJdR8KTULWbKb7`  
BTC Cash `qq7w48d6s3rddgxshl6ae48k7c5jyck76crvppqenn`  
DOGE `DQjBzT2qMuXkLMawUXG7umTf3k9VeT4Y6K`  
Etherium `0xcfe559D9F6056F82a6CFdEDA51c00132035955c8`  
Litecoin `ltc1qcgc873py5k28qm85sk5d53yfwzle4cztmvkh6l`
