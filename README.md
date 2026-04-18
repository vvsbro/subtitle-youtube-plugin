# subtitle-youtube-plugin

Chrome extension that adds a button to the YouTube player and downloads the current video's subtitles as a `.txt` file.

## Files

- `manifest.json`: Manifest V3 configuration.
- `contentScript.js`: Injects the player button and fetches transcript/subtitle data.
- `contentStyles.css`: Styles for the button, spinner, and toast messages.

## Local install

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.
