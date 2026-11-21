# Up Next 📺

A TV show tracker in the spirit of TV Time. You can search shows, tick off episodes, see what's next for every show you're watching, and keep an eye on upcoming air dates.

It runs in the browser and can be installed to your phone's home screen. It has no backend and no account: your data stays on your device.

## Features

- **Search** any show (data from [TVmaze](https://www.tvmaze.com))
- **Up Next**: the next unwatched episode for every show you're watching, with one-tap ticking
- **Episode checklist**: tick episodes or whole seasons. If you skip ahead, it asks whether to mark the earlier episodes too
- **Discover**: browse what's popular this week, new series premiering soon or just premiered, returning seasons, and what's on today. Filter by region (US, Australia, UK, Canada, Japan, Korea, China), language (English, Japanese, Korean, Chinese) and type, including Anime. Streaming services are always included
- **Upcoming**: a calendar of new episodes, shown in your local time, with premieres flagged
- **My Shows**: a poster grid you can filter by Watching, Up to date, Plan to watch, Completed and Stopped
- **Actor pages**: tap anyone in a show's cast to see their upcoming, current and past series
- **Stats**: time spent watching, episodes per week, and top genres
- **Sync**: keep devices in step through a private GitHub Gist (paste a token that can only touch gists)
- **New-episode alerts**: a banner, NEW tags and an app-icon badge for episodes that aired since you last checked
- **Rewatch**: start a show again without losing your history; rewatches count in Stats
- **Sorting**: sort My Shows by name, recently watched, next airing, most left or recently added
- **People search**: find actors directly from Search
- **Backup**: export and import your data as a JSON file
- **Offline**: the app shell and posters are cached

## Install on your phone

Open the site, then:

- **Android (Chrome):** menu ⋮ → *Add to Home screen*
- **iPhone (Safari):** Share → *Add to Home Screen*

## Run locally

No build step is needed:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

GitHub Pages serves the `main` branch root (Settings → Pages → Deploy from branch → `main` / root).

## Project layout

| File | What it does |
| --- | --- |
| `index.html` | App shell: top bar, view container, tab bar |
| `styles.css` | All styling (dark theme, mobile-first) |
| `js/app.js` | Routing, views, actions |
| `js/api.js` | TVmaze API calls (rate-limited queue) |
| `js/store.js` | localStorage persistence, episode cache, merge logic, backup |
| `js/sync.js` | Optional GitHub Gist sync |
| `sw.js` | Service worker for offline use |

## Credits

Show and episode data comes from [TVmaze](https://www.tvmaze.com/api) and is licensed under CC BY-SA.
