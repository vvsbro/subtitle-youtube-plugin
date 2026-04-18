# subtitle-youtube-plugin

Chrome extension for YouTube with two player actions:

- `Download subtitles`: saves the current video's subtitles to a `.txt` file and appends two ready-made ChatGPT prompt blocks.
- `Paste moments JSON`: reads JSON from the clipboard and renders custom moments directly on the current player.

Custom moments are now saved per video in local extension storage, so the overlay survives page reloads and is restored only for that specific video. If a new JSON paste fails, the last valid moments for the current video stay in place.

## Expected JSON format

```json
{
  "video_title": "Example video",
  "moments": [
    { "title": "Intro", "time": "0:00" },
    { "title": "Setup", "time": "1:42" },
    { "title": "Result", "time": "4:18" }
  ]
}
```

Accepted moment keys also include `chapters`, `items`, `timestamp`, `timecode`, `start`, and `seconds`.

## Files

- `manifest.json`: Manifest V3 configuration with clipboard access.
- `contentScript.js`: Injects the player buttons, downloads subtitles, reads clipboard JSON, and renders custom moments.
- `contentStyles.css`: Styles for the buttons, toast messages, and custom moments UI.

## Local install

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.
