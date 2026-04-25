<div align="center">

# YouTube Subtitle Downloader

### Minimal Chrome extension for saving YouTube subtitles and turning them into AI-ready context

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285f4?style=for-the-badge&logo=googlechrome&logoColor=fff)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-111?style=for-the-badge&logo=googlechrome&logoColor=fff)](#)
[![YouTube](https://img.shields.io/badge/YouTube-Subtitles-ff0033?style=for-the-badge&logo=youtube&logoColor=fff)](#)
[![AI Workflow](https://img.shields.io/badge/AI-Context%20Ready-00c853?style=for-the-badge)](#)

</div>

YouTube Subtitle Downloader добавляет в YouTube-плеер две аккуратные кнопки: скачать субтитры в `.txt` и вставить готовый JSON с таймкодами обратно поверх видео. Основной сценарий простой: забрал субтитры, загрузил файл в ChatGPT, Gemini или любую другую нейронку, попросил сделать выжимку, главы, таймкоды или план работы с контекстом.

## Что умеет

- Скачивает субтитры текущего YouTube-видео в `.txt`.
- Добавляет в файл готовые AI-команды для генерации моментов.
- Сохраняет текст с таймкодами в формате `[0:42] фраза из видео`.
- Читает JSON из буфера обмена и рисует кастомные моменты на таймлайне плеера.
- Запоминает моменты отдельно для каждого видео через `chrome.storage`.
- Поддерживает JSON из ChatGPT, Gemini, Claude и других LLM, если структура совпадает.

## AI Workflow

1. Открой видео на YouTube.
2. Нажми кнопку `Download subtitles` в панели плеера.
3. Загрузи скачанный `.txt` в ChatGPT, Gemini или другую нейронку.
4. Попроси модель сжать контекст, найти важные места или собрать таймкоды.
5. Скопируй JSON с моментами.
6. Нажми `Paste moments JSON` на YouTube и получи метки прямо на таймлайне.

## Для чего это удобно

- `Разбор длинных видео`: быстро получить краткую выжимку без ручного просмотра.
- `Работа с контекстом`: загрузить субтитры в нейронку и задавать вопросы по видео.
- `Таймкоды`: попросить модель найти главы, сильные моменты, ошибки, тезисы или TODO.
- `Монтаж`: получить список важных фрагментов для нарезки.
- `Обучение`: превратить лекцию или подкаст в структурированный конспект.

## Готовый промпт

```text
Проанализируй субтитры из файла и верни только валидный JSON.

Нужно найти 8-16 самых важных моментов видео.
Каждый момент должен быть коротким, понятным и привязанным к точному таймкоду.

Формат:
{
  "video_title": "Название видео",
  "moments": [
    { "title": "Короткое название момента", "time": "0:00" }
  ]
}

Правила:
- Верни только JSON, без Markdown и объяснений.
- Сортируй моменты по времени.
- Используй формат mm:ss или hh:mm:ss.
- Не дублируй похожие моменты.
- Названия делай короткими, чтобы они нормально смотрелись на таймлайне.
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

## Как установить

```text
1. Открой chrome://extensions/
2. Включи Developer mode
3. Нажми Load unpacked
4. Выбери папку с этим репозиторием
5. Открой YouTube-видео и проверь кнопки в панели плеера
```

## Как пользоваться

- `Download subtitles`: скачивает субтитры и добавляет в конец файла готовые команды для ChatGPT.
- `Paste moments JSON`: берет JSON из буфера обмена, валидирует его и показывает моменты на видео.
- Если новый JSON сломан, последние рабочие моменты для текущего видео остаются на месте.
- Моменты переживают перезагрузку страницы, но привязаны только к конкретному YouTube-видео.

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
