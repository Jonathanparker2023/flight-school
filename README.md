# Flight School ✈️

**An independent Philly football fan project** — every player, every contract, every Madden 26 rating, plus live news and scores.

🌐 **Live at:** [eagles-hub.pplx.app](https://eagles-hub.pplx.app)

## What's inside

- **79-player active roster** with jersey numbers, age, height/weight, college, 2026 cap hits, depth tags, and Madden 26 overall ratings
- **Player detail modal** with full Madden attributes, scouting report (strengths/weaknesses), and contract breakdown
- **Depth chart** — every position group with starters and backups
- **Formation view** — interactive 11-personnel offense, base defense, and field-goal special teams
- **Draft Central** — live 2026 draft picks plus the 2025 rookie class entering Year 2
- **Coaching staff** — full staff filterable by side of ball
- **Live news** — auto-refreshes every 5 minutes from ESPN
- **Live schedule & scores** — real game state with LIVE indicator during games
- **Dark + light mode**, fully mobile-responsive

## Tech

Pure static site — vanilla HTML/CSS/JS, no build step, no backend.

- `index.html` — page structure
- `styles.css` — design system & components
- `app.js` — roster filtering, modal, formation engine, live data fetching
- `data.js` — bundled roster / Madden / coaches / draft data
- `refresh_data.py` — weekly auto-refresh from public ESPN endpoints

## Data sources

Roster & salaries: public team pages, Spotrac, OverTheCap.
Madden 26 ratings: EA Sports official ratings (publicly published).
Coaches & draft: public press releases and team pages.
Live news, scores, schedule: ESPN public API (`site.api.espn.com`).

## Run locally

```bash
python3 -m http.server 5000
# open http://localhost:5000
```

## Disclaimer

Flight School is an independent fan project and is **not affiliated with, endorsed by, or sponsored by** the Philadelphia Eagles, the National Football League, or any of their affiliates. All team names, logos, and trademarks are the property of their respective owners. Player names and statistics presented here are factual data.

## License

MIT — for the original code in this repository. Third-party data and trademarks remain the property of their respective owners.
