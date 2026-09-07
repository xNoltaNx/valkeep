/* Valheim Server Board - browser client. */

const $ = id => document.getElementById(id);

const el = {
  sprite: $('sprite'),
  serverName: $('serverName'), worldName: $('worldName'),
  portNum: $('portNum'), buildId: $('buildId'),
  statusPlate: $('statusPlate'), statusWord: $('statusWord'), uptime: $('uptime'),
  joinCode: $('joinCode'), copyCode: $('copyCode'), codeHint: $('codeHint'),
  notices: $('notices'),
  btnStart: $('btnStart'), btnStop: $('btnStop'), btnRestart: $('btnRestart'),
  btnBackup: $('btnBackup'), btnUpdate: $('btnUpdate'),
  playerRows: $('playerRows'), playersEmpty: $('playersEmpty'),
  playerCount: $('playerCount'), playerQual: $('playerQual'),
  backupRows: $('backupRows'), backupsEmpty: $('backupsEmpty'), backupCount: $('backupCount'),
  console: $('console'), consoleEmpty: $('consoleEmpty'),
  logFilter: $('logFilter'), followLog: $('followLog'),
  dock: $('consoleDock'), dockGrip: $('dockGrip'), dockToggle: $('dockToggle'),
  dockBody: $('consoleBody'),
  diagStrip: $('diagStrip'), diagCpu: $('diagCpu'),
  diagMem: $('diagMem'), diagThreads: $('diagThreads'),
  accessRows: $('accessRows'), accessEmpty: $('accessEmpty'),
  knownCount: $('knownCount'), allowListWarning: $('allowListWarning'),
  connection: $('connection'), connectionText: $('connectionText'),
  worldSelect: $('f-worldSelect'), worldNew: $('f-worldNew'),
  newWorldField: $('newWorldField'), worldNote: $('worldNote'),
  preset: $('f-preset'), presetNote: $('presetNote'),
  modifierFields: $('modifierFields'), toggleFields: $('toggleFields'),
  settingsForm: $('settingsForm'), settingsErrors: $('settingsErrors'),
  confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'),
  confirmBody: $('confirmBody'), confirmOk: $('confirmOk')
};

let config = null;
let worldProfiles = {};
let lastState = null;
const logLines = [];
const LOG_MAX = 800;

// Inline the sprites so <use href="#..."> resolves without extra requests.
Promise.all(['/icons.svg', '/art.svg'].map(u => fetch(u).then(r => r.text())))
  .then(parts => { el.sprite.innerHTML = parts.join(''); })
  .catch(() => {});

let gameplay = null;

/* ---------- helpers ---------- */

const api = async (path, options) => {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? (body.errors ?? []).join(' ') ?? `HTTP ${res.status}`);
  return body;
};

function duration(seconds) {
  if (!seconds || seconds < 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m`
    : `${m}m ${String(s).padStart(2, '0')}s`;
}

function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function when(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function confirmAction({ title, body, ok }) {
  el.confirmTitle.textContent = title;
  el.confirmBody.textContent = body;
  el.confirmOk.textContent = ok;
  el.confirmDialog.showModal();
  return new Promise(resolve => {
    el.confirmDialog.addEventListener(
      'close',
      () => resolve(el.confirmDialog.returnValue === 'ok'),
      { once: true }
    );
  });
}

let noticeSeq = 0;
function notice(text, { sticky = false } = {}) {
  const id = `notice-${++noticeSeq}`;
  const div = document.createElement('div');
  div.className = 'notice';
  div.id = id;
  div.innerHTML =
    '<svg class="ico" aria-hidden="true"><use href="#i-warning"></use></svg><p></p>';
  div.querySelector('p').textContent = text;
  el.notices.append(div);
  if (!sticky) setTimeout(() => div.remove(), 9000);
  return div;
}

/* ---------- rendering ---------- */

function renderStatus(s) {
  lastState = s;

  el.serverName.textContent = s.serverName || 'Valheim';
  el.worldName.textContent = s.world || '--';
  el.portNum.textContent = s.port ?? '--';
  el.buildId.textContent = s.buildid || '--';

  const state = s.running ? 'running' : 'stopped';
  const word = s.running ? 'Running' : 'Stopped';
  if (el.statusPlate.dataset.state !== state) {
    el.statusPlate.dataset.state = state;
    document.documentElement.dataset.state = state;
    el.statusWord.textContent = word;
    // The one authored moment: the plate rolls like a flip board.
    el.statusWord.dataset.rolling = 'true';
    setTimeout(() => { delete el.statusWord.dataset.rolling; }, 340);
  }

  // A server we adopted rather than started has no known start time, and
  // showing 0m 00s would be a confident lie.
  el.uptime.textContent = !s.running ? "--"
    : (s.adopted && !s.startedAt) ? "unknown" : duration(s.uptimeSeconds);

  if (s.joinCode) {
    el.joinCode.textContent = s.joinCode;
    el.joinCode.dataset.empty = 'false';
    el.copyCode.hidden = false;
    el.codeHint.textContent = 'Share this with your friends. It changes every restart.';
  } else {
    el.joinCode.textContent = 'Not registered';
    el.joinCode.dataset.empty = 'true';
    el.copyCode.hidden = true;
    el.codeHint.textContent = s.running
      ? (s.crossplay
        ? 'Waiting for the crossplay session to register.'
        : 'Crossplay is off, so there is no join code. Friends connect by IP and port.')
      : 'Crossplay code appears once the server registers. It changes every restart.';
  }

  el.playerCount.textContent = s.playerCount ?? 0;
  // Never claim more certainty than the log supports.
  el.playerQual.textContent = s.playerCountSource === 'session'
    ? 'reported by the server'
    : 'inferred from connections';

  renderPlayers(s);

  renderConnection(s);
  renderDiagnostics(s);

  el.btnStart.disabled = s.running || !s.installed;
  el.btnStop.disabled = !s.running;
  el.btnRestart.disabled = !s.running;
  el.btnBackup.disabled = !s.installed;
  el.btnUpdate.disabled = s.running;
}

function renderDiagnostics(s) {
  const d = s.diagnostics;
  // Only shown while the server is up: stale numbers from a dead process would
  // be worse than none.
  el.diagStrip.hidden = !s.running || !d;
  if (el.diagStrip.hidden) return;

  // A single sample cannot give a rate, so the first tick honestly shows nothing.
  el.diagCpu.textContent = d.cpuPercent === null ? 'measuring' : d.cpuPercent + '%';
  el.diagCpu.dataset.load = (d.cpuPercent ?? 0) >= 80 ? 'high' : 'normal';
  el.diagMem.textContent = d.memoryMB >= 1024
    ? (d.memoryMB / 1024).toFixed(2) + ' GB'
    : d.memoryMB + ' MB';
  el.diagThreads.textContent = String(d.threads);
}

function renderConnection(s) {
  const c = s.connection;
  if (!c) return;
  el.connection.dataset.reachable = String(c.reachable);

  let text = c.detail;
  if (s.adopted) {
    text = "This server was already running when the panel started, so the panel adopted it. "
      + text;
  }
  if (c.method === 'direct' && c.publicAddress) {
    text += ` Your address is ${c.publicAddress}.`;
  }
  el.connectionText.textContent = text;
}

function renderPlayers(s) {
  const names = s.players ?? [];
  const count = s.playerCount ?? 0;
  el.playerRows.replaceChildren();

  const rows = [];
  names.forEach((n, i) => rows.push({ idx: i + 1, who: n, tag: '' }));
  // The count can exceed the names we know: someone connected but has not
  // spawned a character yet. Show the gap rather than hiding it.
  for (let i = names.length; i < count; i++) {
    rows.push({ idx: i + 1, who: 'Connecting', tag: 'no character yet' });
  }

  for (const r of rows) {
    const li = document.createElement('li');
    const idx = document.createElement('span');
    idx.className = 'idx data';
    idx.textContent = String(r.idx).padStart(2, '0');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = r.who;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = r.tag;
    li.append(idx, who, tag);
    el.playerRows.append(li);
  }
  el.playersEmpty.hidden = rows.length > 0;
}

async function loadBackups() {
  let list = [];
  try {
    list = await api('/api/backups');
  } catch {
    return;
  }
  el.backupCount.textContent = list.length;
  el.backupRows.replaceChildren();

  for (const b of list) {
    const li = document.createElement('li');

    const w = document.createElement('span');
    w.className = 'when';
    w.textContent = when(b.createdAt);
    if (b.label) {
      const tag = document.createElement('span');
      tag.className = 'label';
      tag.textContent = b.label;
      w.append(tag);
    }

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = `${bytes(b.sizeBytes)} / ${b.fileCount} files`;

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-restore"></use></svg><span>Restore</span>';
    btn.addEventListener('click', () => restore(b));

    li.append(w, size, btn);
    el.backupRows.append(li);
  }
  el.backupsEmpty.hidden = list.length > 0;
}

function renderLog() {
  const needle = el.logFilter.value.trim().toLowerCase();
  const shown = needle
    ? logLines.filter(l => l.toLowerCase().includes(needle))
    : logLines;
  el.console.textContent = shown.join('\n');

  el.consoleEmpty.hidden = shown.length > 0;
  el.consoleEmpty.textContent = logLines.length
    ? 'No log lines match that filter.'
    : 'Nothing logged yet. The console fills once the server starts.';

  if (el.followLog.checked) el.console.scrollTop = el.console.scrollHeight;
}

function pushLog(line) {
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.shift();
  renderLog();
}

/* ---------- actions ---------- */

async function act(button, path, body) {
  const previous = button.disabled;
  button.disabled = true;
  try {
    await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    notice(err.message);
    button.disabled = previous;
  }
}

el.btnStart.addEventListener('click', () => act(el.btnStart, '/api/server/start'));

el.btnStop.addEventListener('click', async () => {
  const ok = await confirmAction({
    title: 'Stop the server?',
    body: 'Everyone online will be disconnected. A backup is taken first, and the world is saved during shutdown.',
    ok: 'Stop server'
  });
  if (ok) act(el.btnStop, '/api/server/stop');
});

el.btnRestart.addEventListener('click', async () => {
  const ok = await confirmAction({
    title: 'Restart the server?',
    body: 'Everyone is disconnected and the join code changes. A backup is taken first.',
    ok: 'Restart'
  });
  if (ok) act(el.btnRestart, '/api/server/restart');
});

el.btnBackup.addEventListener('click', async () => {
  el.btnBackup.disabled = true;
  try {
    const meta = await api('/api/backups', { method: 'POST' });
    notice(`Backed up ${meta.fileCount} files, ${bytes(meta.sizeBytes)}.`);
    loadBackups();
  } catch (err) {
    notice(err.message);
  } finally {
    el.btnBackup.disabled = false;
  }
});

el.btnUpdate.addEventListener('click', async () => {
  const ok = await confirmAction({
    title: 'Update the server?',
    body: 'Downloads the latest build from Steam. Valheim locks versions, so the server must match what your friends are running.',
    ok: 'Update now'
  });
  if (ok) act(el.btnUpdate, '/api/install');
});

async function restore(backup) {
  const ok = await confirmAction({
    title: 'Restore this backup?',
    body: `This replaces the current world with the copy from ${when(backup.createdAt)}. The current world is backed up first, so this is reversible.`,
    ok: 'Restore world'
  });
  if (!ok) return;
  try {
    await api(`/api/backups/${encodeURIComponent(backup.id)}/restore`, { method: 'POST' });
    notice('World restored. The previous world was saved as a pre-restore backup.');
    loadBackups();
  } catch (err) {
    notice(err.message);
  }
}

el.copyCode.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.joinCode.textContent.trim());
    el.copyCode.textContent = 'Copied';
    setTimeout(() => { el.copyCode.textContent = 'Copy join code'; }, 1600);
  } catch {
    notice('Could not copy. Select the code and copy it manually.');
  }
});

el.logFilter.addEventListener('input', renderLog);

/* ---------- settings ---------- */

const NEW_WORLD = ' new';

async function loadWorlds() {
  let data = { worlds: [], current: config?.server?.world ?? '', profiles: {} };
  try {
    data = await api('/api/worlds');
  } catch { /* keep the fallback */ }
  worldProfiles = data.profiles ?? {};

  el.worldSelect.replaceChildren();

  for (const w of data.worlds) {
    const opt = document.createElement('option');
    opt.value = w.name;
    opt.textContent = w.hasSave ? w.name : `${w.name} (backups only)`;
    el.worldSelect.append(opt);
  }

  // The configured world may not exist yet - it will be generated on start.
  if (data.current && !data.worlds.some(w => w.name === data.current)) {
    const opt = document.createElement('option');
    opt.value = data.current;
    opt.textContent = `${data.current} (not created yet)`;
    el.worldSelect.append(opt);
  }

  const create = document.createElement('option');
  create.value = NEW_WORLD;
  create.textContent = 'Create a new world…';
  el.worldSelect.append(create);

  el.worldSelect.value = data.current || NEW_WORLD;
  el.worldNote.textContent = data.worlds.length
    ? `${data.worlds.length} world${data.worlds.length === 1 ? '' : 's'} found on this PC.`
    : 'No worlds found yet. Create one and it generates on first start.';

  syncWorldField();
}

function syncWorldField() {
  const creating = el.worldSelect.value === NEW_WORLD;
  el.newWorldField.hidden = !creating;
  if (creating) el.worldNew.focus();
}

el.worldSelect.addEventListener('change', () => {
  syncWorldField();
  applyWorldProfile(el.worldSelect.value);
});

/*
 * A world is a whole setup, not just a save file: the friends who play on it
 * know it by a particular server name and password. Selecting a world brings
 * its own settings back, so you never hand out a password that belongs to a
 * different world. An unknown world keeps what is on screen, which is what you
 * want when creating one.
 */
function applyWorldProfile(world) {
  const profile = worldProfiles[world];
  if (!profile) return;

  if (profile.name !== undefined) $('f-name').value = profile.name;
  if (profile.password !== undefined) $('f-password').value = profile.password;
  if (profile.port !== undefined) $('f-port').value = profile.port;
  if (profile.saveinterval !== undefined) $('f-saveinterval').value = profile.saveinterval;
  if (profile.crossplay !== undefined) $('f-crossplay').checked = !!profile.crossplay;
  if (profile.public !== undefined) $('f-public').checked = !!profile.public;

  if (profile.preset !== undefined) {
    el.preset.value = (profile.preset || 'normal').toLowerCase();
    renderPresetNote();
  }
  for (const select of el.modifierFields.querySelectorAll('select')) {
    select.value = (profile.modifiers ?? {})[select.dataset.modifier] ?? 'normal';
  }
  for (const input of el.toggleFields.querySelectorAll('input')) {
    input.checked = (profile.setkeys ?? []).includes(input.dataset.toggle);
  }

  notice('Loaded the settings last used for "' + world + '".');
}

function chosenWorld() {
  return el.worldSelect.value === NEW_WORLD
    ? el.worldNew.value.trim()
    : el.worldSelect.value;
}

async function loadGameplay() {
  gameplay = await api('/api/gameplay');

  el.preset.replaceChildren();
  for (const [key, spec] of Object.entries(gameplay.presets)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = spec.label;
    el.preset.append(opt);
  }
  el.preset.addEventListener('change', renderPresetNote);

  el.modifierFields.replaceChildren();
  for (const [key, spec] of Object.entries(gameplay.modifiers)) {
    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    label.setAttribute('for', `m-${key}`);
    label.textContent = spec.label;

    const select = document.createElement('select');
    select.id = `m-${key}`;
    select.dataset.modifier = key;
    for (const value of spec.values) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value === 'normal'
        ? 'Normal'
        : value.replace(/^very/, 'very ').replace(/^much/, 'much ')
               .replace(/^./, c => c.toUpperCase());
      select.append(opt);
    }

    const note = document.createElement('p');
    note.className = 'field__note';
    note.textContent = spec.help;

    field.append(label, select, note);
    el.modifierFields.append(field);
  }

  el.toggleFields.replaceChildren();
  for (const [key, spec] of Object.entries(gameplay.toggles)) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.toggle = key;
    const text = document.createElement('span');
    text.textContent = `${spec.label} — ${spec.help}`;
    label.append(input, text);
    el.toggleFields.append(label);
  }
}

function renderPresetNote() {
  const spec = gameplay?.presets?.[el.preset.value];
  if (!spec) { el.presetNote.textContent = ''; return; }
  el.presetNote.replaceChildren();
  const strong = document.createElement('b');
  strong.textContent = `${spec.label}: `;
  el.presetNote.append(strong, document.createTextNode(spec.summary));
  el.presetNote.append(document.createTextNode(
    ' The preset sets the baseline; anything you change below overrides it.'
  ));
}

function fillSettings(cfg) {
  config = cfg;
  $('f-name').value = cfg.server.name ?? '';
  $('f-password').value = cfg.server.password ?? '';
  $('f-port').value = cfg.server.port ?? 2456;
  $('f-saveinterval').value = cfg.server.saveinterval ?? 1800;
  $('f-crossplay').checked = !!cfg.server.crossplay;
  $('f-public').checked = !!cfg.server.public;

  el.preset.value = (cfg.server.preset || 'normal').toLowerCase();
  renderPresetNote();

  const modifiers = cfg.server.modifiers ?? {};
  for (const select of el.modifierFields.querySelectorAll('select')) {
    select.value = modifiers[select.dataset.modifier] ?? 'normal';
  }

  const setkeys = cfg.server.setkeys ?? [];
  for (const input of el.toggleFields.querySelectorAll('input')) {
    input.checked = setkeys.includes(input.dataset.toggle);
  }
}

el.settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  el.settingsErrors.textContent = '';

  const world = chosenWorld();
  if (!world) {
    el.settingsErrors.textContent = 'Give the new world a name.';
    return;
  }

  const modifiers = {};
  for (const select of el.modifierFields.querySelectorAll('select')) {
    modifiers[select.dataset.modifier] = select.value;
  }
  const setkeys = [...el.toggleFields.querySelectorAll('input')]
    .filter(i => i.checked)
    .map(i => i.dataset.toggle);

  const server = {
    name: $('f-name').value.trim(),
    world,
    password: $('f-password').value,
    port: Number($('f-port').value),
    saveinterval: Number($('f-saveinterval').value),
    crossplay: $('f-crossplay').checked,
    public: $('f-public').checked,
    preset: el.preset.value === 'normal' ? '' : el.preset.value,
    modifiers,
    setkeys
  };

  const changingWorld = world !== config.server.world;
  if (changingWorld) {
    const ok = await confirmAction({
      title: `Switch to world "${world}"?`,
      body: 'The current world is not deleted - it stays on disk and you can switch back. '
        + 'If this world does not exist yet, it is generated on the next start.',
      ok: 'Switch world'
    });
    if (!ok) return;
  }

  try {
    const saved = await api('/api/config', { method: 'PUT', body: JSON.stringify({ server }) });
    fillSettings(saved);
    await loadWorlds();
    notice('Settings saved. They apply the next time the server starts.');
  } catch (err) {
    el.settingsErrors.textContent = err.message;
  }
});



/* ---------- players & access ---------- */

let openPlayer = null;

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + ' h ago';
  return Math.round(hours / 24) + ' d ago';
}

function chip(text, kind) {
  const span = document.createElement('span');
  span.className = 'chip chip--' + kind;
  span.textContent = text;
  return span;
}

async function setAccess(id, list, member) {
  try {
    await api('/api/players/access', {
      method: 'POST',
      body: JSON.stringify({ id, list, member })
    });
    await loadPlayers();
  } catch (err) {
    notice(err.message);
  }
}

async function loadPlayers() {
  let data;
  try {
    data = await api('/api/players');
  } catch {
    return;
  }

  el.knownCount.textContent = data.players.length;
  el.allowListWarning.hidden = !data.allowListActive;
  el.accessRows.replaceChildren();

  for (const p of data.players) {
    const li = document.createElement('li');

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'player';
    row.dataset.online = String(p.online);
    row.setAttribute('aria-expanded', String(openPlayer === p.id));

    const dot = document.createElement('span');
    dot.className = 'player__dot';

    const who = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'player__who';
    // The name comes from a heuristic pairing of two log lines, so an unnamed
    // player is shown as unnamed rather than given a confident guess.
    name.textContent = p.name ?? 'Unnamed player';
    const idLine = document.createElement('span');
    idLine.className = 'player__id';
    idLine.textContent = p.id;
    who.append(name, idLine);

    const roles = document.createElement('span');
    roles.className = 'player__roles';
    if (p.online) roles.append(chip('Online', 'online'));
    if (data.lists.admin.includes(p.id)) roles.append(chip('Admin', 'admin'));
    if (data.lists.banned.includes(p.id)) roles.append(chip('Banned', 'banned'));
    if (data.lists.permitted.includes(p.id)) roles.append(chip('Allowed', 'permitted'));

    row.append(dot, who, roles);
    li.append(row);

    if (openPlayer === p.id) li.append(playerPanel(p, data));

    row.addEventListener('click', () => {
      openPlayer = openPlayer === p.id ? null : p.id;
      loadPlayers();
    });

    el.accessRows.append(li);
  }

  el.accessEmpty.hidden = data.players.length > 0;
}

function fact(label, value) {
  const span = document.createElement('span');
  span.className = 'data';
  span.textContent = value;
  const frag = document.createDocumentFragment();
  frag.append(document.createTextNode(label + ' '), span);
  return frag;
}

function playerPanel(p, data) {
  const panel = document.createElement('div');
  panel.className = 'player__panel';

  const facts = document.createElement('p');
  facts.className = 'player__facts';
  facts.append(fact('First seen', ago(p.firstSeen)));
  facts.append(document.createTextNode('  |  '));
  facts.append(fact('last seen', ago(p.lastSeen)));
  facts.append(document.createTextNode('  |  '));
  facts.append(fact('sessions', String(p.sessions ?? 1)));
  panel.append(facts);

  if (p.name && p.nameConfidence === 'inferred') {
    const caveat = document.createElement('p');
    caveat.className = 'player__facts';
    caveat.textContent =
      'The name is matched to this ID from the order of two separate log lines, '
      + 'so it can be wrong if two people joined in the same moment.';
    panel.append(caveat);
  }

  const actions = document.createElement('div');
  actions.className = 'player__actions';

  for (const [list, spec] of Object.entries(data.definitions)) {
    const member = data.lists[list].includes(p.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = member ? 'btn btn--danger' : 'btn';
    btn.textContent = (member ? 'Remove ' : 'Make ') + spec.label.toLowerCase();
    btn.title = spec.help;
    btn.addEventListener('click', async event => {
      event.stopPropagation();

      if (list === 'permitted' && !member && data.lists.permitted.length === 0) {
        const ok = await confirmAction({
          title: 'Turn on the allowed list?',
          body: 'Adding the first player to the allowed list blocks everyone who is not on '
            + 'it. Add your friends before restarting, or nobody else will get in.',
          ok: 'Turn it on'
        });
        if (!ok) return;
      }

      if (list === 'banned' && !member) {
        const ok = await confirmAction({
          title: 'Ban ' + (p.name ?? p.id) + '?',
          body: 'They will be blocked from joining. Whether someone already connected is '
            + 'dropped immediately is not something the panel can promise - restart the '
            + 'server to be certain.',
          ok: 'Ban player'
        });
        if (!ok) return;
      }

      setAccess(p.id, list, !member);
    });
    actions.append(btn);
  }

  const help = document.createElement('p');
  help.className = 'player__facts';
  help.textContent = 'Access changes are written to Valheim list files. Inventory, skills '
    + 'and position cannot be edited here: Valheim keeps character data on each player own '
    + 'PC, not on the server.';

  panel.append(actions, help);
  return panel;
}

/* ---------- collapsible sections and the console dock ---------- */

/*
 * Layout preferences are per-viewer conveniences, so localStorage is the right
 * home for them - and every access is guarded, because a private window or
 * blocked site data makes these throw rather than return null.
 */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* not essential */ }
  }
};

const DOCK_MIN = 120;

function setSectionOpen(section, open) {
  const toggle = section.querySelector('.board__toggle');
  const body = section.querySelector('.board__body');
  toggle.setAttribute('aria-expanded', String(open));
  body.hidden = !open;
  store.set(`section:${section.dataset.key}`, open ? 'open' : 'closed');
}

for (const section of document.querySelectorAll('.board[data-key]')) {
  const toggle = section.querySelector('.board__toggle');
  setSectionOpen(section, store.get(`section:${section.dataset.key}`, 'open') === 'open');
  toggle.addEventListener('click', () => {
    setSectionOpen(section, toggle.getAttribute('aria-expanded') !== 'true');
  });
}

function syncDockReserve() {
  // Measured, not computed: the grip and head heights are CSS's business, and
  // guessing them is how the footer ended up underneath the dock.
  const dock = el.dock.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--dock-reserve', Math.ceil(dock + 24) + 'px');
}

function applyDockHeight(px) {
  const max = Math.max(DOCK_MIN, window.innerHeight - 200);
  const height = Math.round(Math.min(Math.max(px, DOCK_MIN), max));
  document.documentElement.style.setProperty('--dock-height', height + 'px');
  store.set('dock:height', String(height));
  syncDockReserve();
  return height;
}

function setDockOpen(open) {
  el.dock.dataset.collapsed = String(!open);
  el.dockToggle.setAttribute('aria-expanded', String(open));
  el.dockBody.hidden = !open;
  store.set('dock:open', open ? 'yes' : 'no');
  syncDockReserve();
  if (open && el.followLog.checked) el.console.scrollTop = el.console.scrollHeight;
}

applyDockHeight(Number(store.get('dock:height', '260')));
setDockOpen(store.get('dock:open', 'yes') === 'yes');

el.dockToggle.addEventListener('click', () => {
  setDockOpen(el.dockToggle.getAttribute('aria-expanded') !== 'true');
});

// Drag the grip to resize. Pointer events cover mouse, pen, and touch, and
// capture keeps the drag alive when the cursor outruns the 8px grip.
let dragFrom = null;
el.dockGrip.addEventListener('pointerdown', event => {
  if (el.dock.dataset.collapsed === 'true') return;
  dragFrom = { y: event.clientY, height: el.dockBody.getBoundingClientRect().height };
  el.dockGrip.setPointerCapture(event.pointerId);
  document.body.style.userSelect = 'none';
});
el.dockGrip.addEventListener('pointermove', event => {
  if (!dragFrom) return;
  applyDockHeight(dragFrom.height + (dragFrom.y - event.clientY));
});
const endDrag = () => {
  if (!dragFrom) return;
  dragFrom = null;
  document.body.style.userSelect = '';
};
el.dockGrip.addEventListener('pointerup', endDrag);
el.dockGrip.addEventListener('pointercancel', endDrag);

// The grip is focusable, so it must be operable without a pointer.
el.dockGrip.addEventListener('keydown', event => {
  const step = event.shiftKey ? 80 : 24;
  if (event.key === 'ArrowUp') {
    applyDockHeight(el.dockBody.getBoundingClientRect().height + step);
  } else if (event.key === 'ArrowDown') {
    applyDockHeight(el.dockBody.getBoundingClientRect().height - step);
  } else {
    return;
  }
  event.preventDefault();
});

window.addEventListener('resize', () => {
  if (el.dock.dataset.collapsed !== 'true') {
    applyDockHeight(el.dockBody.getBoundingClientRect().height);
  } else {
    syncDockReserve();
  }
});

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(syncDockReserve).observe(el.dock);
}

/* ---------- live stream ---------- */

function connect() {
  const source = new EventSource('/api/stream');

  source.addEventListener('status', e => renderStatus(JSON.parse(e.data)));
  source.addEventListener('log', e => pushLog(JSON.parse(e.data).line));
  source.addEventListener('backups', () => loadBackups());
  source.addEventListener('players', () => loadPlayers());
  source.addEventListener('diagnostics', e => {
    if (lastState) renderDiagnostics({ ...lastState, running: true, diagnostics: JSON.parse(e.data) });
  });

  source.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    notice(d.text);
  });

  source.addEventListener('install', e => {
    const d = JSON.parse(e.data);
    pushLog(d.percent != null ? `[update ${d.percent}%] ${d.line}` : `[update] ${d.line}`);
    if (d.done) notice('Server updated. Start it when you are ready.');
    if (d.error) notice(d.line, { sticky: true });
  });

  source.addEventListener('events', e => {
    for (const ev of JSON.parse(e.data)) {
      if (ev.type === 'character' && !ev.isDeath) notice(`${ev.name} joined.`);
      if (ev.type === 'joinCode') notice(`Join code is ${ev.code}.`);
    }
  });

  source.onerror = () => {
    source.close();
    setTimeout(connect, 3000);
  };
}

/* ---------- boot ---------- */

(async function boot() {
  try {
    renderStatus(await api('/api/status'));
    await loadGameplay();
    fillSettings(await api('/api/config'));
    await loadWorlds();
    const { lines } = await api('/api/log');
    logLines.push(...lines.slice(-LOG_MAX));
    renderLog();
    await loadBackups();
    await loadPlayers();
  } catch (err) {
    notice(`Could not reach the panel: ${err.message}`, { sticky: true });
  }
  connect();
})();
