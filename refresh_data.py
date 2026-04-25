#!/usr/bin/env python3
"""
Eagles Hub — Auto-update data.js from free ESPN endpoints.

Strategy:
  1. Fetch ESPN roster (authoritative for who is on the team).
  2. Fetch ESPN injuries (in-season only; empty in offseason).
  3. Fetch ESPN depth chart (in-season only; empty in offseason).
  4. Merge against the existing data.js so we KEEP hand-curated fields
     (strengths, weaknesses, cap_hit_2026, contract_summary, key_notes,
     position group, depth label) for players who are still on the roster.
  5. Add new players with sensible defaults.
  6. Drop players no longer on the roster (old defaults).
  7. Promote next-up player to "Starter" if current starter is on injury list.
  8. Write the new data.js preserving the existing schema.

Run:
    python3 refresh_data.py            # writes data.js in place
    python3 refresh_data.py --dry-run  # prints diff summary, doesn't write
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).parent
DATA_JS = ROOT / "data.js"

ESPN_ROSTER = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/phi/roster"
ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/phi/injuries"
# Core API gives a richer depth chart (with $refs for athletes). We use the current season.
ESPN_DEPTH_CORE_TPL = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{season}/teams/21/depthcharts"

USER_AGENT = "EaglesHub-Refresher/1.0 (auto-update; +https://eagles-hub.pplx.app)"

# Map ESPN position groupings -> our position_group field
GROUP_MAP = {
    "offense": "Offense",
    "defense": "Defense",
    "specialTeam": "Special Teams",
    "specialteams": "Special Teams",
}

# Default depth label for newly-added players (will be refined by depth chart if present)
DEFAULT_DEPTH = "Reserve"


def http_get_json(url, timeout=20, retries=2):
    """GET JSON with simple retry."""
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (URLError, HTTPError, json.JSONDecodeError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed GET {url}: {last_err}")


def parse_existing_data_js(path):
    """Extract the JSON object from data.js (which starts with `window.EAGLES_DATA = {...};`)."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"window\.EAGLES_DATA\s*=\s*", text)
    if not m:
        raise RuntimeError("Could not find `window.EAGLES_DATA =` in data.js")
    json_text = text[m.end():].rstrip().rstrip(";").strip()
    return json.loads(json_text)


def write_data_js(path, payload):
    """Write data.js preserving the same prefix shape."""
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(f"window.EAGLES_DATA = {body};\n", encoding="utf-8")


def height_to_str(inches):
    if not inches:
        return ""
    try:
        n = int(round(float(inches)))
    except (TypeError, ValueError):
        return ""
    feet, rem = divmod(n, 12)
    return f"{feet}'{rem}\""


def fetch_roster():
    """Returns a dict keyed by ESPN id -> normalized player record."""
    raw = http_get_json(ESPN_ROSTER)
    out = {}
    for grp in raw.get("athletes", []):
        group_label = GROUP_MAP.get((grp.get("position") or "").lower(), "Offense")
        for a in grp.get("items", []):
            espn_id = str(a.get("id") or "").strip()
            if not espn_id:
                continue
            pos = (a.get("position") or {}).get("abbreviation") or ""
            jersey_raw = a.get("jersey")
            try:
                jersey = int(jersey_raw) if jersey_raw not in (None, "") else None
            except (TypeError, ValueError):
                jersey = None
            college = ""
            if isinstance(a.get("college"), dict):
                college = a["college"].get("name", "") or ""
            try:
                weight = int(round(float(a.get("weight") or 0))) or None
            except (TypeError, ValueError):
                weight = None
            try:
                age = int(a.get("age")) if a.get("age") not in (None, "") else None
            except (TypeError, ValueError):
                age = None

            # years_pro: ESPN provides experience.years (sometimes)
            years_pro = None
            exp = a.get("experience")
            if isinstance(exp, dict):
                try:
                    years_pro = int(exp.get("years")) if exp.get("years") not in (None, "") else None
                except (TypeError, ValueError):
                    years_pro = None

            out[espn_id] = {
                "espn_id": espn_id,
                "name": a.get("fullName") or a.get("displayName") or "",
                "first_name": a.get("firstName") or "",
                "last_name": a.get("lastName") or "",
                "jersey_number": jersey,
                "position": pos,
                "position_group": group_label,
                "age": age,
                "height": a.get("displayHeight") or height_to_str(a.get("height")),
                "weight": weight,
                "college": college,
                "years_pro": years_pro,
                "headshot": f"https://a.espncdn.com/i/headshots/nfl/players/full/{espn_id}.png",
            }
    return out


def fetch_injuries():
    """Returns set of ESPN ids currently on the injury list and a dict id->status."""
    raw = http_get_json(ESPN_INJURIES)
    inj_status = {}
    for entry in raw.get("injuries", []) or []:
        for player in entry.get("injuries", []) or []:
            ath = player.get("athlete") or {}
            pid = str(ath.get("id") or "").strip()
            if not pid:
                continue
            inj_status[pid] = player.get("status") or player.get("type", {}).get("description") or "Injured"
    return inj_status


def fetch_depth_chart(season):
    """
    Returns: dict mapping position abbreviation (e.g. 'QB', 'LWR') to ordered list of ESPN ids.
    Resolves $ref URLs to athletes. In offseason this may be empty.
    """
    try:
        raw = http_get_json(ESPN_DEPTH_CORE_TPL.format(season=season))
    except Exception as e:
        print(f"  depth chart fetch failed ({e}); skipping", file=sys.stderr)
        return {}

    depth = {}
    items = raw.get("items") or []
    # ESPN typically has multiple "items" (e.g. Base 3-4 D, Nickel D, Offense). Merge them.
    for item in items:
        positions = item.get("positions") or {}
        for key, posdata in positions.items():
            pos_abbr = ((posdata.get("position") or {}).get("abbreviation") or key).upper()
            athletes = posdata.get("athletes") or []
            # Sort by slot number ascending
            athletes_sorted = sorted(athletes, key=lambda x: x.get("slot", 99))
            ordered_ids = []
            for slot_entry in athletes_sorted:
                ref = (slot_entry.get("athlete") or {}).get("$ref")
                if not ref:
                    continue
                # extract the id from the URL path
                m = re.search(r"/athletes/(\d+)", ref)
                if m:
                    ordered_ids.append(m.group(1))
            if ordered_ids:
                # If position already seen (e.g. base + nickel both list QB), keep the longer/first
                if pos_abbr not in depth or len(ordered_ids) > len(depth[pos_abbr]):
                    depth[pos_abbr] = ordered_ids
    return depth


def derive_depth_label(position, espn_id, depth_map):
    """Given a depth chart, return 'Starter' / 'Backup' / 'Reserve' for the player."""
    if not depth_map:
        return None
    # Try exact position match first, then match WR variants
    keys_to_try = [position]
    if position == "WR":
        keys_to_try += ["LWR", "RWR", "SWR"]
    for k in keys_to_try:
        if k in depth_map and espn_id in depth_map[k]:
            idx = depth_map[k].index(espn_id)
            if idx == 0:
                return "Starter"
            if idx == 1:
                return "Backup"
            return "Reserve"
    return None


def merge_players(existing_players, espn_roster, depth_map, injury_map):
    """
    Merge ESPN roster against existing curated data.
    - Keep curated fields (strengths, weaknesses, cap_hit_2026, contract_summary, key_notes)
      for players still on the roster.
    - Add new players with defaults.
    - Drop players no longer on roster.
    - Mark injured players in their `key_notes`.
    """
    # Index existing by espn_id (fall back to name for older records that may lack id)
    existing_by_id = {}
    existing_by_name = {}
    for p in existing_players:
        eid = str(p.get("espn_id") or "").strip()
        if eid:
            existing_by_id[eid] = p
        nm = (p.get("name") or "").strip().lower()
        if nm:
            existing_by_name[nm] = p

    merged = []
    seen_ids = set()
    new_count = 0
    kept_count = 0

    for espn_id, espn_p in espn_roster.items():
        seen_ids.add(espn_id)
        prev = existing_by_id.get(espn_id) or existing_by_name.get((espn_p["name"] or "").lower())

        # Start from ESPN-fresh fields
        rec = {
            "name": espn_p["name"],
            "jersey_number": espn_p["jersey_number"],
            "position": espn_p["position"] or (prev or {}).get("position", ""),
            "position_group": espn_p["position_group"] or (prev or {}).get("position_group", "Offense"),
            "depth": (prev or {}).get("depth", DEFAULT_DEPTH),
            "age": espn_p["age"] if espn_p["age"] is not None else (prev or {}).get("age"),
            "height": espn_p["height"] or (prev or {}).get("height", ""),
            "weight": espn_p["weight"] if espn_p["weight"] is not None else (prev or {}).get("weight"),
            "college": espn_p["college"] or (prev or {}).get("college", ""),
            "years_pro": espn_p["years_pro"] if espn_p["years_pro"] is not None else (prev or {}).get("years_pro"),
            "cap_hit_2026": (prev or {}).get("cap_hit_2026", 0),
            "base_salary": (prev or {}).get("base_salary", 0),
            "contract_summary": (prev or {}).get("contract_summary", ""),
            "strengths": (prev or {}).get("strengths", []),
            "weaknesses": (prev or {}).get("weaknesses", []),
            "key_notes": (prev or {}).get("key_notes", ""),
            "espn_id": espn_id,
            "headshot": espn_p["headshot"],
        }

        # Apply depth chart label if available
        derived_depth = derive_depth_label(rec["position"], espn_id, depth_map)
        if derived_depth:
            rec["depth"] = derived_depth

        # Inject injury note if the player is on the injury list
        if espn_id in injury_map:
            inj = injury_map[espn_id]
            inj_tag = f"[INJURY: {inj}]"
            base_notes = rec["key_notes"] or ""
            # Strip any prior injury tag
            base_notes = re.sub(r"\s*\[INJURY:[^\]]*\]\s*", " ", base_notes).strip()
            rec["key_notes"] = (inj_tag + (" " + base_notes if base_notes else "")).strip()

        if prev:
            kept_count += 1
        else:
            new_count += 1
            # New players: set blank curated fields explicitly so the UI doesn't error
            if not rec["strengths"]:
                rec["strengths"] = []
            if not rec["weaknesses"]:
                rec["weaknesses"] = []

        merged.append(rec)

    # Auto-promote next-up if a Starter is injured at a given position
    by_pos = {}
    for p in merged:
        by_pos.setdefault(p["position"], []).append(p)
    for pos, plist in by_pos.items():
        starters = [p for p in plist if p.get("depth") == "Starter"]
        for s in starters:
            if str(s.get("espn_id") or "") in injury_map:
                # Find next-up: prefer Backup, else first Reserve
                backups = [p for p in plist if p.get("depth") == "Backup"]
                reserves = [p for p in plist if p.get("depth") == "Reserve"]
                next_up = (backups + reserves)[:1]
                if next_up:
                    promoted = next_up[0]
                    promoted["depth"] = "Starter (filling in)"

    dropped_count = len([p for p in existing_players if str(p.get("espn_id") or "") not in seen_ids])

    return merged, {
        "new": new_count,
        "kept": kept_count,
        "dropped": dropped_count,
        "total": len(merged),
        "injured": len(injury_map),
        "depth_positions": len(depth_map),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Don't write data.js, just print summary")
    args = parser.parse_args()

    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] Refreshing Eagles Hub data...")

    existing = parse_existing_data_js(DATA_JS)
    existing_players = existing.get("roster", {}).get("players", [])
    print(f"  existing players: {len(existing_players)}")

    print("  fetching ESPN roster...")
    roster = fetch_roster()
    print(f"  roster size from ESPN: {len(roster)}")

    # Determine current season for depth chart endpoint
    today = datetime.now(timezone.utc)
    # NFL season year = current year if month >= March, else previous year
    season = today.year if today.month >= 3 else today.year - 1

    print(f"  fetching depth chart for season {season}...")
    depth_map = fetch_depth_chart(season)
    print(f"  depth chart positions: {len(depth_map)}")

    # If current season has no depth (offseason), try previous season
    if not depth_map and today.month <= 7:
        print(f"  empty; trying season {season - 1}...")
        depth_map = fetch_depth_chart(season - 1)
        print(f"  depth chart positions (prev season): {len(depth_map)}")

    print("  fetching injuries...")
    try:
        injury_map = fetch_injuries()
    except Exception as e:
        print(f"  injuries fetch failed ({e}); continuing with none", file=sys.stderr)
        injury_map = {}
    print(f"  injured players: {len(injury_map)}")

    merged, stats = merge_players(existing_players, roster, depth_map, injury_map)
    print(f"  merge: {stats}")

    # Build the new payload
    new_data = dict(existing)
    today_str = today.strftime("%Y-%m-%d")
    roster_block = dict(existing.get("roster", {}))
    roster_block["as_of_date"] = today_str
    roster_block["players"] = merged
    # Preserve / extend the note
    note = roster_block.get("note", "") or ""
    auto_note = f"Auto-refreshed {today_str} from ESPN public APIs."
    if "Auto-refreshed" in note:
        note = re.sub(r"Auto-refreshed[^.]*\.\s*", auto_note + " ", note)
    else:
        note = (auto_note + " " + note).strip()
    roster_block["note"] = note
    new_data["roster"] = roster_block
    new_data["last_refresh"] = today.isoformat(timespec="seconds")

    if args.dry_run:
        print("[DRY-RUN] not writing data.js")
        # Print first 3 new and dropped
        prev_ids = {str(p.get("espn_id") or "") for p in existing_players}
        new_ids = {str(p.get("espn_id") or "") for p in merged}
        added = [p for p in merged if str(p.get("espn_id") or "") not in prev_ids]
        dropped = [p for p in existing_players if str(p.get("espn_id") or "") not in new_ids]
        print(f"  added ({len(added)}): {[p['name'] for p in added[:5]]}")
        print(f"  dropped ({len(dropped)}): {[p.get('name') for p in dropped[:5]]}")
    else:
        write_data_js(DATA_JS, new_data)
        print(f"  wrote {DATA_JS}")

    print("done.")


if __name__ == "__main__":
    main()
