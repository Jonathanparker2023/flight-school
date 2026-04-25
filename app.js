/* =========================================================
   EAGLES HUB — App Logic
   ========================================================= */
(function () {
  'use strict';

  const DATA = window.EAGLES_DATA || {};
  const ROSTER = (DATA.roster && DATA.roster.players) || [];
  const MADDEN = (DATA.madden && DATA.madden.players) || [];
  const COACHES = DATA.coaches || [];
  const DRAFT = DATA.draft || {};

  // -------- Theme toggle --------
  (function () {
    const html = document.documentElement;
    const btn = document.querySelector('[data-theme-toggle]');
    let theme = 'dark';
    try {
      if (window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'light';
    } catch (_) {}
    html.setAttribute('data-theme', theme);
    if (!btn) return;
    btn.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', theme);
    });
  })();

  // -------- Helpers --------
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 10e6 ? 1 : 2) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function fmtMoneyFull(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + n.toLocaleString('en-US');
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function ovrTier(o) {
    if (o == null) return 'avg';
    if (o >= 95) return 'elite';
    if (o >= 87) return 'star';
    if (o >= 78) return 'good';
    return 'avg';
  }
  function attrTier(v) {
    if (v == null) return 'low';
    if (v >= 92) return 'elite';
    if (v >= 82) return 'high';
    if (v >= 70) return 'mid';
    return 'low';
  }
  function initials(name) {
    if (!name) return '';
    return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  }

  // -------- Madden index --------
  const maddenIndex = {};
  MADDEN.forEach((m) => {
    maddenIndex[m.name.toLowerCase()] = m;
  });
  function getMadden(name) {
    return maddenIndex[name.toLowerCase()] || null;
  }

  // -------- Player lookup helpers --------
  function findStarter(position, fallbackPositions) {
    let p = ROSTER.find((x) => x.position === position && x.depth === 'Starter');
    if (p) return p;
    if (fallbackPositions) {
      for (const fp of fallbackPositions) {
        p = ROSTER.find((x) => x.position === fp && x.depth === 'Starter');
        if (p) return p;
      }
    }
    // any depth at this position with highest madden
    const list = ROSTER.filter((x) => x.position === position).sort((a, b) =>
      ((getMadden(b.name) || {}).overall || 0) - ((getMadden(a.name) || {}).overall || 0)
    );
    return list[0] || null;
  }

  function findStartersByPosition(position, count) {
    const starters = ROSTER.filter((x) => x.position === position && x.depth === 'Starter');
    if (starters.length >= count) return starters.slice(0, count);
    // fall back to any depth, ranked by Madden OVR
    const all = ROSTER.filter((x) => x.position === position).sort(
      (a, b) => ((getMadden(b.name) || {}).overall || 0) - ((getMadden(a.name) || {}).overall || 0)
    );
    return all.slice(0, count);
  }

  // -------- Hero stats --------
  function fillHeroStats() {
    document.getElementById('statRoster').textContent = ROSTER.length;
    const totalCap = ROSTER.reduce((sum, p) => sum + (p.cap_hit_2026 || 0), 0);
    document.getElementById('statCap').textContent = '$' + (totalCap / 1e6).toFixed(0) + 'M';
    document.getElementById('rosterAsOf').textContent = (DATA.roster && DATA.roster.as_of_date) || '—';
    document.getElementById('maddenVersion').textContent = (DATA.madden && DATA.madden.game_version) || 'Madden 26';
  }

  // -------- FORMATION VIEW --------

  // VERTICAL FIELD layout. top:0 = top endzone (defense's end), top:100 = bottom endzone.
  // Offense lines up at the bottom (top:75-90), attacking upward.
  // Defense aligns in the top half (top:25-50), defending against bottom-side offense.
  // left% spans full sideline-to-sideline (0=left sideline, 100=right sideline).
  const FORMATIONS = {
    offense: {
      label: '11 Personnel · Trips Right',
      slots: [
        // O-Line — 5 across at the LOS. Alternate name labels above/below so they don't collide.
        { pos: 'LT', label: 'LT',    top: 66, left: 36 },
        { pos: 'LG', label: 'LG',    top: 66, left: 43, nameAbove: true },
        { pos: 'C',  label: 'C',     top: 66, left: 50 },
        { pos: 'RG', label: 'RG',    top: 66, left: 57, nameAbove: true },
        { pos: 'RT', label: 'RT',    top: 66, left: 64 },
        // X (split end) — way out wide LEFT at the numbers, on the LOS
        { pos: 'WR', label: 'X',     top: 66, left: 10, index: 0 },
        // Y — TE flexed just outside RT, on the LOS
        { pos: 'TE', label: 'Y',     top: 66, left: 73 },
        // Z — slot receiver outside Y, off the line
        { pos: 'WR', label: 'Z',     top: 72, left: 82, index: 1 },
        // Trips wide — split out RIGHT at the numbers
        { pos: 'WR', label: 'SLOT',  top: 66, left: 92, index: 2 },
        // QB in shotgun — deep behind center
        { pos: 'QB', label: 'Q',     top: 80, left: 53 },
        // RB / Tailback offset to the QB's left, slightly deeper
        { pos: 'RB', label: 'T',     top: 86, left: 42 },
      ],
    },
    defense: {
      label: 'Vic Fangio · 4-2-5 Nickel',
      slots: [
        // Defensive line (4 across, deep at LOS — names render ABOVE chip so they
        // don't cover the player's face).
        { pos: 'DE', label: 'LE',    top: 50, left: 32, index: 0, nameAbove: true },
        { pos: 'DT', label: 'DT',    top: 50, left: 44, index: 0, nameAbove: true },
        { pos: 'DT', label: 'NT',    top: 50, left: 56, index: 1, nameAbove: true },
        { pos: 'DE', label: 'RE',    top: 50, left: 68, index: 1, nameAbove: true },
        // Linebackers (off-ball, sit between DL and safeties — plenty of room)
        { pos: 'LB', label: 'MLB',   top: 30, left: 42, index: 0 },
        { pos: 'LB', label: 'WLB',   top: 30, left: 58, index: 1 },
        // Cornerbacks (way out wide on the numbers, even with the LOS — plenty of horizontal
        // space so labels go below by default)
        { pos: 'CB', label: 'CB',    top: 50, left: 10, index: 0 },
        { pos: 'CB', label: 'CB',    top: 50, left: 90, index: 1 },
        // Nickel (slot CB, inside the LWR — sits a touch off the line, label above to
        // avoid colliding with NT/DT name labels)
        { pos: 'CB', label: 'NCB',   top: 42, left: 20, index: 2, nameAbove: true },
        // Safeties (deepest, spread wide horizontally)
        { pos: 'S',  label: 'FS',    top: 14, left: 28, index: 0 },
        { pos: 'S',  label: 'SS',    top: 14, left: 72, index: 1 },
      ],
    },
    special: {
      label: 'Field Goal Unit',
      slots: [
        // Holder + kicker behind the line, snapper at LOS
        { pos: 'K',  label: 'K',     top: 92, left: 50 },
        { pos: 'P',  label: 'P/H',   top: 84, left: 50 },
        { pos: 'LS', label: 'LS',    top: 72, left: 50 },
        // Protection (5-man interior + wings)
        { pos: 'LT', label: 'LT',    top: 72, left: 38 },
        { pos: 'LG', label: 'LG',    top: 72, left: 44 },
        { pos: 'RG', label: 'RG',    top: 72, left: 56 },
        { pos: 'RT', label: 'RT',    top: 72, left: 62 },
        { pos: 'TE', label: 'WING-L',top: 72, left: 28, index: 0 },
        { pos: 'TE', label: 'WING-R',top: 72, left: 72, index: 1 },
        // Gunner out wide on the line
        { pos: 'WR', label: 'GUNNER',top: 72, left: 12, index: 2 },
      ],
    },
  };

  // Real Philadelphia Eagles primary logo (saved locally as eagles-logo.svg)
  const EAGLES_LOGO_SVG = `<img src="eagles-logo.svg" alt="Philadelphia Eagles" />`;

  function buildFieldChrome() {
    // VERTICAL field: endzones top + bottom, yard lines horizontal.
    // Field-of-play spans 8% to 92% of total height (endzones occupy 0-8% top and 92-100% bottom).
    // The 9 yard-line numbers (10,20,30,40,50,40,30,20,10) are spaced evenly at 10% increments
    // within the field-of-play, which is 84% tall — so 9.33% increments starting at 8% + 9.33%.
    const labels = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    const yardNums = [];
    for (let i = 0; i < labels.length; i++) {
      // Position numbers at the yard lines: 10% in from each goal line, then every 10% across
      const topPct = 8 + (i + 1) * 8.4; // 16.4, 24.8, ..., 83.6
      yardNums.push(`<div class="yard-num left" style="top:${topPct}%">${labels[i]}</div>`);
      yardNums.push(`<div class="yard-num right" style="top:${topPct}%">${labels[i]}</div>`);
    }
    return `
      <div class="endzone top">EAGLES</div>
      <div class="endzone bottom">EAGLES</div>
      <div class="field-play">
        <div class="sideline left"></div>
        <div class="sideline right"></div>
        <div class="midfield"></div>
        <div class="hashes-left"></div>
        <div class="hashes-right"></div>
      </div>
      ${yardNums.join('')}
      <div class="field-logo">${EAGLES_LOGO_SVG}</div>
    `;
  }

  function renderFormation(unit) {
    const field = document.getElementById('field');
    const formation = FORMATIONS[unit] || FORMATIONS.offense;
    document.getElementById('formationName').textContent = formation.label;

    const used = new Set();
    const playerHTML = formation.slots
      .filter((slot) => !slot._skip)
      .map((slot) => {
        // Find player for slot — pick by index of starters at that position
        let player = null;
        const idx = slot.index || 0;
        const candidates = ROSTER.filter((p) => p.position === slot.pos && p.depth === 'Starter' && !used.has(p.name));
        if (candidates[idx]) player = candidates[idx];
        else if (candidates[0]) player = candidates[0];
        else {
          // Fallback to any depth
          const fallback = ROSTER.filter((p) => p.position === slot.pos && !used.has(p.name))
            .sort((a, b) => ((getMadden(b.name) || {}).overall || 0) - ((getMadden(a.name) || {}).overall || 0));
          player = fallback[idx] || fallback[0] || null;
        }
        if (!player) return ''; // no player available
        used.add(player.name);

        const m = getMadden(player.name);
        const ovr = m ? m.overall : null;
        const tier = ovrTier(ovr);
        const headshot = player.headshot;
        const avatarInner = headshot
          ? `<img src="${escape(headshot)}" alt="${escape(player.name)}" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<span class=&quot;initials&quot;>${escape(initials(player.name))}</span>'+this.parentElement.innerHTML;" />`
          : `<span class="initials">${escape(initials(player.name))}</span>`;
        // Show last name; if any other player on the field shares it, prepend first initial (e.g. "A. Brown")
        const parts = player.name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
        const lastName = parts[parts.length - 1].replace(/[().]/g, '');
        const firstInitial = parts[0] ? parts[0][0] : '';
        const sameLast = ROSTER.filter((p) => {
          const lp = p.name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
          return lp[lp.length - 1].replace(/[().]/g, '') === lastName;
        });
        const displayName = sameLast.length > 1 ? `${firstInitial}. ${lastName}` : lastName;
        // If nameAbove is set, render the name label ABOVE the avatar instead of below.
        // Used to stagger O-line labels so they don't overlap, and to keep D-line names
        // off the players' faces.
        const above = !!slot.nameAbove;
        const avatarBlock = `
            <div class="fp-avatar">
              ${avatarInner}
              <div class="fp-jersey">${player.jersey_number || '–'}</div>
            </div>
            <div class="fp-pos">${escape(slot.label)}</div>`;
        const labelBlock = `<div class="fp-label">${escape(displayName)}</div>`;
        const inner = above ? labelBlock + avatarBlock : avatarBlock + labelBlock;
        // Vertical field: players use raw top/left percentages (sideline-to-sideline = 0%-100%).
        return `
          <div class="fp ovr-${tier}${above ? ' fp-name-above' : ''}" data-name="${escape(player.name)}"
               style="top:${slot.top}%; left:${slot.left}%;"
               role="button" tabindex="0"
               aria-label="${escape(player.name)}, ${escape(slot.label)}">
            ${inner}
          </div>
        `;
      })
      .join('');

    field.innerHTML = buildFieldChrome() + playerHTML;

    field.querySelectorAll('.fp').forEach((el) => {
      el.addEventListener('click', () => openModal(el.dataset.name));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(el.dataset.name);
        }
      });
    });
  }

  // -------- ROSTER GRID --------
  const state = {
    group: 'all',
    depth: 'all',
    search: '',
    sort: 'overall',
    view: 'formation',
    unit: 'offense',
  };

  function filterAndSortRoster() {
    let list = ROSTER.slice();
    if (state.group !== 'all') list = list.filter((p) => p.position_group === state.group);
    if (state.depth !== 'all') list = list.filter((p) => p.depth === state.depth);
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.college || '').toLowerCase().includes(q) ||
          (p.position || '').toLowerCase().includes(q) ||
          String(p.jersey_number || '').includes(q)
      );
    }
    const sortFns = {
      overall: (a, b) => ((getMadden(b.name) || {}).overall || 0) - ((getMadden(a.name) || {}).overall || 0),
      cap: (a, b) => (b.cap_hit_2026 || 0) - (a.cap_hit_2026 || 0),
      age_asc: (a, b) => (a.age || 0) - (b.age || 0),
      age_desc: (a, b) => (b.age || 0) - (a.age || 0),
      jersey: (a, b) => (a.jersey_number || 999) - (b.jersey_number || 999),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    list.sort(sortFns[state.sort] || sortFns.overall);
    return list;
  }

  function renderRoster() {
    const grid = document.getElementById('rosterGrid');
    const empty = document.getElementById('rosterEmpty');
    const list = filterAndSortRoster();
    grid.innerHTML = list.map(playerCardHTML).join('');
    empty.hidden = list.length > 0;

    grid.querySelectorAll('.player-card').forEach((el) => {
      el.addEventListener('click', () => openModal(el.dataset.name));
    });
  }

  function playerCardHTML(p) {
    const m = getMadden(p.name);
    const ovr = m ? m.overall : null;
    const tier = ovrTier(ovr);
    const ovrLabel = ovr ? ovr + ' OVR' : 'NR';
    const avatarInner = p.headshot
      ? `<img src="${escape(p.headshot)}" alt="" loading="lazy" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;
    return `
      <article class="player-card" data-name="${escape(p.name)}" tabindex="0" role="button" aria-label="${escape(p.name)} details">
        <div class="pc-top">
          <div class="pc-avatar">${avatarInner}</div>
          <div class="pc-jersey">#${p.jersey_number || '–'}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin-left:auto;">
            <span class="pc-pos">${escape(p.position)}</span>
            <span class="depth-badge depth-${escape(p.depth)}">${escape(p.depth)}</span>
          </div>
        </div>
        <div>
          <div class="pc-name">${escape(p.name)}</div>
          <div class="pc-meta">
            <span>${p.age}y</span>
            <span>${escape(p.height || '')}</span>
            <span>${p.weight || ''} lb</span>
            <span>${escape(p.college || '')}</span>
          </div>
        </div>
        <div class="pc-stats">
          <div class="pc-stat">
            <div class="pc-stat-label">Madden</div>
            <div class="pc-stat-val"><span class="pc-ovr ovr-${tier}">${ovrLabel}</span></div>
          </div>
          <div class="pc-stat">
            <div class="pc-stat-label">2026 Cap</div>
            <div class="pc-stat-val">${fmtMoney(p.cap_hit_2026)}</div>
          </div>
        </div>
      </article>
    `;
  }

  // -------- MODAL --------
  function openModal(name) {
    const p = ROSTER.find((x) => x.name === name);
    if (!p) return;
    const m = getMadden(name);
    const body = document.getElementById('modalBody');
    body.innerHTML = modalHTML(p, m);
    const modal = document.getElementById('playerModal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('playerModal').hidden = true;
    document.body.style.overflow = '';
  }
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  function modalHTML(p, m) {
    const ovr = m ? m.overall : null;
    const tier = ovrTier(ovr);
    const trait = m && m.dev_trait ? m.dev_trait : null;

    // Build attributes grid (order by value desc, take top 12)
    let attrsHTML = '';
    if (m && m.key_attributes) {
      const entries = Object.entries(m.key_attributes)
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      attrsHTML = entries
        .map(
          ([k, v], i) => `
        <div class="attr-pill" style="--bar-width:${v}%; --bar-delay:${300 + i * 60}ms;">
          <span class="attr-name">${escape(formatAttrName(k))}</span>
          <span class="attr-val ${attrTier(v)}">${v}</span>
        </div>
      `
        )
        .join('');
    }

    const strengths = (p.strengths || []).map((s) => `<li>${escape(s)}</li>`).join('');
    const weaknesses = (p.weaknesses || []).map((s) => `<li>${escape(s)}</li>`).join('');

    const headshotInner = p.headshot
      ? `<img src="${escape(p.headshot)}" alt="${escape(p.name)}" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;

    return `
      <div class="modal-hero">
        <div class="mh-headshot">${headshotInner}</div>
        <div class="mh-text">
          <span class="mh-pos">${escape(p.position)} · ${escape(p.depth)}</span>
          <div class="mh-name">${escape(p.name)}</div>
          <div class="mh-meta">
            <span>${p.age} years old</span>
            <span>${escape(p.height || '')} · ${p.weight || ''} lb</span>
            <span>${escape(p.college || '')}</span>
            <span>Year ${p.years_pro || '?'} pro</span>
          </div>
        </div>
        <div class="mh-jersey">#${p.jersey_number || '–'}</div>
      </div>
      <div class="modal-body-content">
        ${
          m
            ? `
          <div class="modal-ovr-block">
            <div class="mob-overall ${tier}" data-ovr="${ovr}">${ovr}</div>
            <div class="mob-meta">
              <div class="mob-label">Madden 26 Overall</div>
              <div style="font-size:13px;color:var(--text-muted);">${escape(m.archetype || '')}</div>
              ${trait ? `<span class="mob-trait ${escape(trait)}">${escape(trait)}</span>` : ''}
            </div>
          </div>
        `
            : '<div style="padding:var(--space-3);color:var(--text-muted);font-size:13px;">No Madden 26 rating on file.</div>'
        }

        ${
          attrsHTML
            ? `
          <div class="mb-section">
            <h3>Key Attributes</h3>
            <div class="attr-grid">${attrsHTML}</div>
          </div>
        `
            : ''
        }

        <div class="mb-section">
          <h3>Scouting Report</h3>
          <div class="swl-grid">
            <div class="swl-list strengths">
              <h4>✓ Strengths</h4>
              <ul>${strengths || '<li>—</li>'}</ul>
            </div>
            <div class="swl-list weaknesses">
              <h4>△ Weaknesses</h4>
              <ul>${weaknesses || '<li>—</li>'}</ul>
            </div>
          </div>
        </div>

        <div class="mb-section">
          <h3>Contract</h3>
          <div class="contract-box">
            <div class="contract-row"><span>2026 Cap Hit</span><strong>${fmtMoneyFull(p.cap_hit_2026)}</strong></div>
            <div class="contract-row"><span>2026 Base Salary</span><strong>${fmtMoneyFull(p.base_salary)}</strong></div>
            <div class="contract-row"><span>Deal</span><strong style="font-family:var(--font-body);font-weight:500;text-align:right;max-width:60%;">${escape(p.contract_summary || '—')}</strong></div>
          </div>
        </div>

        ${
          p.key_notes
            ? `
          <div class="mb-section">
            <h3>Latest</h3>
            <p style="font-size:14px;color:var(--text);line-height:1.6;">${escape(p.key_notes)}</p>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  function formatAttrName(k) {
    const map = {
      speed: 'Speed', acceleration: 'Acceleration', agility: 'Agility', awareness: 'Awareness',
      strength: 'Strength', stamina: 'Stamina', injury: 'Injury', toughness: 'Toughness',
      throw_power: 'Throw Power', throw_accuracy_short: 'Short Acc', throw_accuracy_med: 'Mid Acc',
      throw_accuracy_deep: 'Deep Acc', throw_under_pressure: 'TUP', play_action: 'Play Action',
      break_sack: 'Break Sack', catching: 'Catching', short_route_running: 'Short Routes',
      medium_route_running: 'Mid Routes', deep_route_running: 'Deep Routes', spectacular_catch: 'Spec Catch',
      catch_in_traffic: 'CIT', release: 'Release', juke_move: 'Juke', spin_move: 'Spin',
      stiff_arm: 'Stiff Arm', trucking: 'Trucking', carrying: 'Carrying', break_tackle: 'Break Tackle',
      ball_carrier_vision: 'BCV', tackle: 'Tackle', power_moves: 'Power Moves', finesse_moves: 'Finesse',
      block_shedding: 'Block Shed', play_recognition: 'Play Rec', pursuit: 'Pursuit', hit_power: 'Hit Power',
      man_coverage: 'Man Cov', zone_coverage: 'Zone Cov', press: 'Press', pass_block: 'Pass Block',
      pass_block_power: 'PB Power', pass_block_finesse: 'PB Finesse', run_block: 'Run Block',
      run_block_power: 'RB Power', run_block_finesse: 'RB Finesse', impact_blocking: 'Impact Block',
      lead_block: 'Lead Block', kick_power: 'Kick Power', kick_accuracy: 'Kick Acc',
      jumping: 'Jumping', return_skill: 'Return',
    };
    return map[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // -------- DEPTH CHART --------
  function renderDepthChart() {
    const positions = {};
    ROSTER.forEach((p) => {
      if (!positions[p.position]) positions[p.position] = [];
      positions[p.position].push(p);
    });
    const order = [
      'QB','RB','FB','WR','TE','LT','LG','C','RG','RT','OL',
      'DE','EDGE','DT','LB','ILB','OLB','MLB','CB','S','FS','SS',
      'K','P','LS',
    ];
    const sortedKeys = Object.keys(positions).sort((a, b) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const html = sortedKeys
      .map((pos) => {
        const players = positions[pos]
          .slice()
          .sort((a, b) => {
            const order = { Starter: 0, Backup: 1, Reserve: 2, Rookie: 3 };
            const da = order[a.depth] ?? 4;
            const db = order[b.depth] ?? 4;
            if (da !== db) return da - db;
            return ((getMadden(b.name) || {}).overall || 0) - ((getMadden(a.name) || {}).overall || 0);
          })
          .slice(0, 5);

        return `
          <div class="depth-pos-card">
            <div class="dpc-pos">${escape(pos)}</div>
            ${players
              .map(
                (p, i) => `
              <div class="dpc-row" data-name="${escape(p.name)}">
                <span class="dpc-rank">${i + 1}</span>
                <span class="dpc-name">${escape(p.name)}</span>
                <span class="dpc-jersey">#${p.jersey_number || '–'}</span>
              </div>
            `
              )
              .join('')}
          </div>
        `;
      })
      .join('');

    const grid = document.getElementById('depthChart');
    grid.innerHTML = html;
    grid.querySelectorAll('.dpc-row').forEach((row) => {
      row.addEventListener('click', () => openModal(row.dataset.name));
    });
  }

  // -------- DRAFT --------
  function renderDraft(year) {
    const status = document.getElementById('draftStatus');
    const list = document.getElementById('draftList');

    if (year === '2026') {
      const d = DRAFT.draft_2026 || {};
      const completed = d.completed;
      status.className = 'draft-status' + (completed ? ' complete' : '');
      status.innerHTML = completed
        ? `<strong>2026 Draft complete.</strong> ${escape(d.status_note || '')}`
        : `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--primary);box-shadow:0 0 8px var(--primary);"></span><strong>Draft in progress.</strong> ${escape(d.status_note || '')}`;
      const picks = d.picks || [];
      list.innerHTML = picks
        .map(
          (p) => `
        <div class="draft-card">
          <div class="dc-head">
            <span class="dc-round">R${p.round}</span>
            <span class="dc-pick">PICK #${p.pick_number}</span>
          </div>
          <div class="dc-name">${escape(p.name)}</div>
          <div class="dc-meta">${escape(p.position || '')} · ${escape(p.college || '')}</div>
          ${p.notes ? `<div class="dc-notes">${escape(p.notes)}</div>` : ''}
        </div>
      `
        )
        .join('');
      if (d.trades_summary) {
        list.insertAdjacentHTML('beforeend', `
          <div class="draft-card" style="border-left-color:var(--silver);">
            <div class="dc-head"><span class="dc-round">TRADES</span></div>
            <div class="dc-name">2026 Trades</div>
            <div class="dc-notes" style="margin-top:8px;">${escape(d.trades_summary)}</div>
          </div>
        `);
      }
    } else {
      const picks = DRAFT.draft_2025_class || [];
      status.className = 'draft-status complete';
      status.innerHTML = `<strong>2025 Class · Year 2.</strong> Howie Roseman's haul, with Year 1 production summarized below.`;
      list.innerHTML = picks
        .map(
          (p) => `
        <div class="draft-card">
          <div class="dc-head">
            <span class="dc-round">R${p.round}</span>
            <span class="dc-pick">PICK #${p.pick_number}</span>
          </div>
          <div class="dc-name">${escape(p.name)}</div>
          <div class="dc-meta">${escape(p.position || '')} · ${escape(p.college || '')}</div>
          ${p.year1_summary ? `<div class="dc-notes">${escape(p.year1_summary)}</div>` : ''}
        </div>
      `
        )
        .join('');
    }
  }

  // -------- COACHES --------
  function renderCoaches(side) {
    const grid = document.getElementById('staffGrid');
    let list = COACHES.slice();
    if (side && side !== 'all') list = list.filter((c) => c.side === side);
    list.sort((a, b) => {
      const order = { Head: 0, Offense: 1, Defense: 2, 'Special Teams': 3 };
      return (order[a.side] ?? 9) - (order[b.side] ?? 9);
    });
    grid.innerHTML = list
      .map(
        (c) => `
      <div class="staff-card">
        <div class="staff-avatar">${initials(c.name)}</div>
        <div>
          <div class="staff-name">${escape(c.name)}</div>
          <div class="staff-title">${escape(c.title)}</div>
          <div class="staff-bg">${escape(c.background_short || '')}</div>
          ${c.years_with_eagles != null && c.years_with_eagles !== '' ? `<div class="staff-years">${escape(formatYears(c.years_with_eagles))}</div>` : ''}
        </div>
      </div>
    `
      )
      .join('');
  }
  function formatYears(y) {
    if (y == null || y === '') return '';
    const n = Number(y);
    if (!isNaN(n)) return n === 1 ? '1st year with Eagles' : n + ' years with Eagles';
    return String(y);
  }

  // -------- LIVE: NEWS --------
  const ESPN_NEWS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=21&limit=12';
  const ESPN_TEAM = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/phi';
  const ESPN_SCHEDULE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/phi/schedule';

  async function loadNews() {
    try {
      const res = await fetch(ESPN_NEWS, { cache: 'no-store' });
      if (!res.ok) throw new Error('news fetch ' + res.status);
      const data = await res.json();
      const articles = (data.articles || []).slice(0, 12);
      renderNews(articles);
      renderHeroNews(articles.slice(0, 4));
      document.getElementById('newsUpdatedAt').textContent = 'updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (err) {
      console.warn('News load failed:', err);
      const fallback = `<div class="empty-state">Live news temporarily unavailable. <button class="btn-ghost" onclick="location.reload()">Retry</button></div>`;
      document.getElementById('newsGrid').innerHTML = fallback;
      document.getElementById('heroNewsList').innerHTML = `<div style="font-size:13px;color:var(--text-muted);">Live news feed unavailable right now.</div>`;
    }
  }

  function renderNews(articles) {
    const grid = document.getElementById('newsGrid');
    if (!articles.length) {
      grid.innerHTML = '<div class="empty-state">No recent articles.</div>';
      return;
    }
    grid.innerHTML = articles
      .map((a) => {
        const img = (a.images && a.images[0] && a.images[0].url) || '';
        const link = (a.links && a.links.web && a.links.web.href) || '#';
        return `
          <a class="news-card" href="${escape(link)}" target="_blank" rel="noopener noreferrer">
            ${img ? `<div class="news-img" style="background-image:url('${escape(img)}')"></div>` : ''}
            <div class="news-body">
              <div class="news-headline">${escape(a.headline || '')}</div>
              <div class="news-desc">${escape((a.description || '').slice(0, 150))}${(a.description || '').length > 150 ? '…' : ''}</div>
              <div class="news-time">${timeAgo(a.published)}</div>
            </div>
          </a>
        `;
      })
      .join('');
  }

  function renderHeroNews(articles) {
    const list = document.getElementById('heroNewsList');
    if (!articles.length) { list.innerHTML = ''; return; }
    list.innerHTML = articles
      .map((a) => {
        const link = (a.links && a.links.web && a.links.web.href) || '#';
        return `
          <a class="hnc-item" href="${escape(link)}" target="_blank" rel="noopener noreferrer">
            <h4>${escape(a.headline || '')}</h4>
            <time>${timeAgo(a.published)}</time>
          </a>
        `;
      })
      .join('');
  }

  // -------- LIVE: TEAM (record) --------
  async function loadTeam() {
    try {
      const res = await fetch(ESPN_TEAM, { cache: 'no-store' });
      if (!res.ok) throw new Error('team ' + res.status);
      const data = await res.json();
      const team = data.team || {};
      const summary = (team.record && team.record.items && team.record.items[0] && team.record.items[0].summary) || '—';
      const standing = team.standingSummary || '—';
      document.getElementById('statRecord').textContent = summary;
      document.getElementById('statStanding').textContent = standing;
    } catch (err) {
      console.warn('Team load failed:', err);
      document.getElementById('statRecord').textContent = '—';
      document.getElementById('statStanding').textContent = '—';
    }
  }

  // -------- LIVE: SCHEDULE --------
  async function loadSchedule() {
    try {
      const res = await fetch(ESPN_SCHEDULE, { cache: 'no-store' });
      if (!res.ok) throw new Error('sched ' + res.status);
      const data = await res.json();
      const events = data.events || [];
      renderSchedule(events);
    } catch (err) {
      console.warn('Schedule load failed:', err);
      document.getElementById('scheduleList').innerHTML = '<div class="empty-state">Live schedule unavailable right now.</div>';
    }
  }

  function renderSchedule(events) {
    const list = document.getElementById('scheduleList');
    if (!events.length) {
      list.innerHTML = '<div class="empty-state">No scheduled games.</div>';
      return;
    }
    const now = Date.now();
    const sorted = events.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const past = sorted.filter((e) => new Date(e.date).getTime() < now).slice(-2);
    const future = sorted.filter((e) => new Date(e.date).getTime() >= now).slice(0, 4);
    const display = [...past, ...future];

    list.innerHTML = display
      .map((e) => {
        const comp = (e.competitions && e.competitions[0]) || {};
        const status = comp.status || e.status || {};
        const stateType = (status.type && status.type.state) || 'pre';
        const detail = (status.type && status.type.shortDetail) || (e.date ? new Date(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
        const competitors = comp.competitors || [];
        const isLive = stateType === 'in';

        return `
          <div class="game-card${isLive ? ' live' : ''}">
            <div class="game-status">
              <span>${escape(e.week ? 'Week ' + (e.week.number || '') : '')}</span>
              <span class="${isLive ? 'live-tag' : ''}">${isLive ? '<span class="dot" style="width:6px;height:6px;border-radius:50%;background:#E64B4B;display:inline-block;animation:pulse 1.6s infinite;"></span> LIVE · ' : ''}${escape(detail)}</span>
            </div>
            <div class="game-teams">
              ${competitors
                .map((c) => {
                  const t = c.team || {};
                  const isEagles = (t.abbreviation || '').toLowerCase() === 'phi';
                  const logo = (t.logos && t.logos[0] && t.logos[0].href) || t.logo || '';
                  const score = c.score && (c.score.displayValue || c.score);
                  const showScore = stateType !== 'pre' && score != null;
                  return `
                    <div class="game-team">
                      ${logo ? `<img src="${escape(logo)}" alt="${escape(t.displayName || '')}" />` : '<div style="width:28px;height:28px;"></div>'}
                      <span class="gt-name${isEagles ? ' is-eagles' : ''}">${escape(t.displayName || t.name || '')}</span>
                      ${showScore ? `<span class="gt-score">${escape(score)}</span>` : ''}
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // -------- VIEW + UNIT TOGGLES --------
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.vtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    const formationView = document.getElementById('formationView');
    const gridView = document.getElementById('gridView');
    if (view === 'formation') {
      formationView.hidden = false;
      gridView.hidden = true;
      renderFormation(state.unit);
    } else {
      formationView.hidden = true;
      gridView.hidden = false;
      renderRoster();
    }
  }

  function setUnit(unit) {
    state.unit = unit;
    document.querySelectorAll('#unitFilter .chip').forEach((b) => {
      b.classList.toggle('active', b.dataset.unit === unit);
    });
    renderFormation(unit);
  }

  // -------- WIRE UP --------
  function wireFilters() {
    document.querySelectorAll('.vtab').forEach((b) =>
      b.addEventListener('click', () => setView(b.dataset.view))
    );
    document.querySelectorAll('#unitFilter .chip').forEach((b) =>
      b.addEventListener('click', () => setUnit(b.dataset.unit))
    );
    document.querySelectorAll('#groupFilter .chip').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#groupFilter .chip').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); state.group = b.dataset.group; renderRoster();
      })
    );
    document.querySelectorAll('#depthFilter .chip').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#depthFilter .chip').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); state.depth = b.dataset.depth; renderRoster();
      })
    );
    document.getElementById('search').addEventListener('input', (e) => {
      state.search = e.target.value; renderRoster();
    });
    document.getElementById('sort').addEventListener('change', (e) => {
      state.sort = e.target.value; renderRoster();
    });
    document.querySelectorAll('.draft-tabs .tab').forEach((t) =>
      t.addEventListener('click', () => {
        document.querySelectorAll('.draft-tabs .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active'); renderDraft(t.dataset.draft);
      })
    );
    document.querySelectorAll('.staff-tabs .chip').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('.staff-tabs .chip').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); renderCoaches(b.dataset.side);
      })
    );
    document.getElementById('refreshNews').addEventListener('click', () => {
      document.getElementById('newsGrid').innerHTML = '<div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>';
      loadNews();
    });
  }

  // -------- BOOT --------
  function boot() {
    fillHeroStats();
    renderFormation(state.unit);
    renderRoster();
    renderDepthChart();
    renderDraft('2026');
    renderCoaches('all');
    wireFilters();
    loadNews();
    loadTeam();
    loadSchedule();
    setInterval(loadNews, 5 * 60 * 1000);
    setInterval(loadTeam, 5 * 60 * 1000);
    setInterval(loadSchedule, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
