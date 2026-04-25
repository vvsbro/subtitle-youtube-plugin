<div align="center">

# YouTube Subtitle Downloader

### Minimal Chrome extension for saving YouTube subtitles and turning them into AI-ready context

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285f4?style=for-the-badge&logo=googlechrome&logoColor=fff)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-111?style=for-the-badge&logo=googlechrome&logoColor=fff)](#)
[![YouTube](https://img.shields.io/badge/YouTube-Subtitles-ff0033?style=for-the-badge&logo=youtube&logoColor=fff)](#)
[![AI Workflow](https://img.shields.io/badge/AI-Context%20Ready-00c853?style=for-the-badge)](#)

</div>

YouTube Subtitle Downloader adds two clean actions directly to the YouTube player: export the current video's subtitles as a `.txt` file, then paste AI-generated JSON moments back onto the video timeline. The workflow is built for ChatGPT, Gemini, Claude, or any other model that can work with long video context.

## Overview

- Download subtitles from the current YouTube video as a `.txt` file.
- Export transcript lines with readable timestamps like `[0:42] spoken text`.
- Append ready-to-use AI prompt blocks to the downloaded file.
- Paste moments JSON from the clipboard and render custom markers on the YouTube timeline.
- Store custom moments per video with `chrome.storage`.
- Keep the last valid moments in place if a new JSON paste fails.

## AI Workflow

1. Open a YouTube video.
2. Click `Download subtitles` in the player controls.
3. Upload the downloaded `.txt` file to ChatGPT, Gemini, Claude, or another LLM.
4. Ask the model to summarize the video, compress the context, find key points, or generate timestamps.
5. Copy the returned JSON.
6. Click `Paste moments JSON` on YouTube and get AI-generated markers directly on the timeline.

## Use Cases

- `Long video analysis`: turn a full transcript into a short, useful summary.
- `AI context work`: upload subtitles and ask questions about the video.
- `Timestamps`: generate chapters, highlights, mistakes, claims, or TODO items.
- `Editing`: find strong fragments for clips or shorts.
- `Learning`: convert lectures, interviews, and podcasts into structured notes.

## Ready Prompt

```text
Analyze the uploaded transcript and return only valid JSON.

Find 8-16 of the most important moments in the video.
Each moment must be short, readable, and attached to an accurate timestamp.

Format:
{
  "video_title": "Video title",
  "moments": [
    { "title": "Short moment title", "time": "0:00" }
  ]
}

Rules:
- Return JSON only. No Markdown. No explanation.
- Sort moments by time ascending.
- Use mm:ss or hh:mm:ss.
- Remove duplicates and weak overlaps.
- Keep titles short enough to look good on a video timeline.
```

## Expected JSON

```json
{
  "video_title": "Example video",
  "moments": [
    { "title": "Intro", "time": "0:00" },
    { "title": "Main idea", "time": "1:42" },
    { "title": "Final result", "time": "4:18" }
  ]
}
```

The parser is forgiving: it also accepts arrays under `chapters`, `items`, or `segments`, and time fields named `timestamp`, `timecode`, `start`, `startTime`, `seconds`, or `at`.

## Local Install

```text
1. Open chrome://extensions/
2. Enable Developer mode
3. Click Load unpacked
4. Select this repository folder
5. Open a YouTube video and check the player controls
```

## Controls

- `Download subtitles`: extracts subtitles and downloads a `.txt` file with AI prompts included.
- `Paste moments JSON`: reads JSON from the clipboard, validates it, and renders moments on the video timeline.
- Saved moments survive page reloads and are restored only for the matching video.
- If pasted JSON is invalid, the previous valid moments stay visible.

## Tech Stack

- Chrome Extension Manifest V3.
- Vanilla JavaScript content script.
- YouTube timed text API fallback plus transcript UI fallback.
- `chrome.storage` for per-video moments.
- Clipboard API for importing AI-generated JSON.
- Plain CSS injected only on YouTube watch pages.

## Project Files

- `manifest.json`: extension permissions, YouTube matches, content script registration.
- `contentScript.js`: subtitle extraction, export builder, clipboard JSON parser, timeline markers.
- `contentStyles.css`: player buttons, toasts, moment markers, hover states.

## Notes

- Works only on YouTube watch pages.
- If a video has no captions and YouTube cannot expose a transcript, export is unavailable.
- For best results, ask the AI model to return raw JSON only.

---

<div align="center">
Download the context. Ask the model. Bring the moments back.
</div>
