# Flight School ✈️

**Interactive Philadelphia Eagles roster hub** — every player, every contract, every Madden 26 rating, plus live news and scores from ESPN.

🌐 **Live at:** [eagles-hub.pplx.app](https://eagles-hub.pplx.app)

## What's inside

- **79-player active roster** with jersey numbers, age, height/weight, college, 2026 cap hits, depth tags, and Madden 26 overall ratings
- **Player detail modal** with full Madden attributes, scouting report (strengths/weaknesses), and contract breakdown
- **Depth chart** — every position group with starters and backups
- **Draft Central** — live 2026 draft picks plus the 2025 rookie class entering Year 2
- **Coaching staff** — all 27 coaches under Sirianni / Fangio / Mannion, filterable by side of ball
- **Live news** — auto-refreshes every 5 minutes from ESPN
- **Live schedule & scores** — real game state with LIVE indicator during games
- **Dark + light mode**, fully mobile-responsive
- Midnight green / silver Eagles palette throughout

## Tech

Pure static site — vanilla HTML/CSS/JS, no build step, no backend.

- `index.html` — page structure
- `styles.css` — design system & components
- `app.js` — roster filtering, modal, live data fetching
- `data.js` — bundled roster / Madden / coaches / draft data

## Data sources

Roster & salaries: PhiladelphiaEagles.com, Spotrac, OverTheCap.
Madden 26 ratings: EA Sports official ratings.
Coaches & draft: PhiladelphiaEagles.com, NFL.com.
Live news, scores, schedule: ESPN public API (`site.api.espn.com`).

## Run locally

```bash
python3 -m http.server 5000
# open http://localhost:5000
```

## License

MIT
