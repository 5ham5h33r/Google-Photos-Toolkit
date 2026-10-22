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

Open and authenticate to Google Photos' Locked Folder, reload the page there, open GPTK, and select **Locked** as the source. Use **Repair locked dates**. Other unsupported Locked Folder actions are disabled and rejected; they are never silently changed into Unlock.

The repair works on the existing photos, without uploading copies:

1. It saves a recovery entry before temporarily moving one photo out of Locked Folder to read its filename and current date. It then returns the photo and verifies folder membership before proceeding to another photo.
2. Once all previewed photos are back in Locked Folder, a table shows the proposed changes. Uncheck changes you do not want and save the JSON change log before applying. Cancel leaves dates unchanged.
3. Each selected photo is opened individually again, checked against the preview, updated, read back to verify its date, and returned to Locked Folder. Stop prevents the next photo from opening; returning the current photo is still attempted.

Only one browser tab can run a repair or recovery for the account at a time. Unknown or ambiguous filenames, missing timezone offsets, and already matching dates are skipped. A leading `YYYY-MM-DD` followed by a UUID or opaque identifier supplies a date only; the existing clock time is preserved. Complete date/time names (including zero hours/minutes and three fractional-second digits) are supported. Calculations use each photo's saved UTC offset, not the browser timezone. Filenames that encode another timezone, such as UTC, need manual review. The general **Date from Name** action for non-locked sources is unchanged.

**Interruption and privacy:** photos temporarily appear in the ordinary library during inspection and editing. A browser crash, logout, network failure, or tab closure can leave the current photo outside Locked Folder. This cannot be made atomic with these undocumented APIs. A minimal recovery entry containing the account and photo identifiers is stored in this browser's Google Photos site storage; filenames, thumbnails, and credentials are not stored in that entry. Keep this site data until recovery completes. After reopening and authenticating to Locked Folder in the same account and browser profile, reload GPTK and use **Recover locked photo**. Recovery does not change dates and only clears the entry after verifying the photo is locked. It works even when the photo no longer appears in the Locked source. Other actions are blocked while recovery is pending.

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
