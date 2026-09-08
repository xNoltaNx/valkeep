/**
 * Turns Valheim server log lines into events.
 *
 * Every pattern lives in config.json so a 1.0 log-format change is a config
 * edit rather than a code change. Nothing in here may throw on bad input:
 * this module runs against text written by a game we do not control.
 */

function compile(patterns) {
  const compiled = [];
  for (const [type, source] of Object.entries(patterns ?? {})) {
    try {
      compiled.push({ type, re: new RegExp(source) });
    } catch {
      // A malformed pattern must never take the parser down. Hand-edited
      // patterns on patch day land here, and the rest must keep working.
    }
  }
  return compiled;
}

export function createParser(patterns) {
  const compiled = compile(patterns);

  // A monotonic counter, not a timestamp: two events can land in the same
  // millisecond, and Date.now() ties would make the ordering below wrong.
  let seq = 0;

  const state = {
    characters: new Map(),     // character name -> last seen timestamp
    zdoOwners: new Map(),      // character zdo id -> character name
    reaped: new Set(),         // zdo owners already treated as gone
    names: new Map(),          // platform id -> character name, when known
    sockets: new Set(),        // connection ids currently open
    heartbeatCount: null,      // count as last reported by the server
    heartbeatSeq: -1,          // when that count arrived
    socketsSeq: -1,            // when socket bookkeeping last changed
    joinCode: null,
    publicAddress: null,
    stats: null,               // the periodic Connections/ZDOS/sent/recv line
    lastSaveAt: null
  };

  function feed(line) {
    const events = [];

    for (const { type, re } of compiled) {
      let m;
      try {
        m = re.exec(line);
      } catch {
        continue;
      }
      if (!m) continue;

      const g = m.groups ?? {};
      const event = { type, raw: line, ...g };

      switch (type) {
        case 'character': {
          // ZDOID fires on death as well as spawn. A zdo of 0 is a death, so
          // this line is a name source and never a join event.
          event.isDeath = g.zdo === '0';
          if (!event.isDeath && g.name) {
            state.characters.set(g.name, Date.now());
            // The zdo id is the only thing tying a leave back to a person.
            if (g.zdo) {
              state.zdoOwners.set(g.zdo, g.name);
              state.reaped.delete(g.zdo);
            }
          }
          break;
        }
        case 'connected': {
          if (g.id) {
            state.sockets.add(g.id);
            state.socketsSeq = ++seq;
          }
          break;
        }
        case 'disconnected': {
          if (g.id) {
            state.sockets.delete(g.id);
            state.socketsSeq = ++seq;
          }
          break;
        }
        case 'joinCode': {
          if (g.code) state.joinCode = g.code;
          break;
        }
        case 'abandonedZdo': {
          /*
           * Crossplay never prints "Closing socket", so before this the only
           * disconnect signal was the player count reaching zero. That is fine
           * for the last person to leave and wrong for everyone else: with two
           * players, one leaving took the count 2 -> 1 and nobody was marked
           * offline, leaving a ghost in the list.
           *
           * When a player disconnects the server reaps their zdos, and the
           * owner id is the same id their character spawned with. That is a
           * per-player leave. The reap prints once per object, so it is
           * deduplicated to the first line for an owner.
           */
          const owner = g.owner;
          if (owner && state.zdoOwners.has(owner) && !state.reaped.has(owner)) {
            state.reaped.add(owner);
            const name = state.zdoOwners.get(owner);
            state.characters.delete(name);
            state.socketsSeq = ++seq;
            event.name = name;
            event.left = true;
          }
          break;
        }
        case 'platformId': {
          // The one line that states a player's Platform User ID - the id the
          // admin and ban lists are keyed on.
          if (g.id) state.names.set(g.id, state.names.get(g.id) ?? null);
          break;
        }
        case 'nowPlayers':
        case 'heartbeat': {
          if (g.code) state.joinCode = g.code;
          if (g.players !== undefined) {
            state.heartbeatCount = Number(g.players);
            state.heartbeatSeq = ++seq;
            if (state.heartbeatCount === 0) {
              state.sockets.clear();
              state.characters.clear();
              state.zdoOwners.clear();
              state.reaped.clear();
              state.names.clear();
            }
          }
          break;
        }
        case 'serverStats': {
          /*
           * The server's own periodic statistics. Seen roughly ten minutes
           * after start; the exact interval is not confirmed, so this is
           * treated as occasional rather than as a heartbeat. ZDOS is the
           * count of world objects, which is the closest thing Valheim gives
           * to "how heavy is this world".
           */
          state.stats = {
            connections: Number(g.connections),
            zdos: Number(g.zdos),
            sent: Number(g.sent),
            recv: Number(g.recv),
            at: Date.now()
          };
          break;
        }
        case 'publicAddress': {
          if (g.address) state.publicAddress = g.address;
          break;
        }
        case 'worldSaved': {
          state.lastSaveAt = Date.now();
          break;
        }
        default:
          break;
      }

      events.push(event);
    }

    return events;
  }

  /**
   * The probe showed the session line is not a periodic heartbeat - it fires
   * on session state change. So neither source is authoritative on its own:
   * prefer whichever was updated most recently, and say which one it was so
   * the UI can be honest about confidence.
   */
  function playerCount() {
    const named = state.characters.size;

    let base;
    if (state.heartbeatCount === null || state.socketsSeq > state.heartbeatSeq) {
      base = { count: state.sockets.size, source: 'connections' };
    } else {
      base = { count: state.heartbeatCount, source: 'session' };
    }

    // Never report fewer players than we can actually name. Showing "0" next
    // to a list of people who are plainly on the server is worse than either
    // number alone.
    if (named > base.count) return { count: named, source: 'characters' };
    return base;
  }

  /**
   * Forgets everything that belongs to one server session.
   *
   * A join code, a player list and a public address are facts about the server
   * that is running now. Carrying them past a stop means the panel offers a
   * code that no longer works - which is worse than offering none, because it
   * is a code the host would actually send to friends.
   */
  function resetSession() {
    state.characters.clear();
    state.zdoOwners.clear();
    state.reaped.clear();
    state.names.clear();
    state.sockets.clear();
    state.heartbeatCount = null;
    state.heartbeatSeq = -1;
    state.socketsSeq = -1;
    state.joinCode = null;
    state.publicAddress = null;
    state.stats = null;
    seq = 0;
  }

  function snapshot() {
    const { count, source } = playerCount();
    return {
      players: [...state.characters.keys()],
      playerCount: count,
      playerCountSource: source,
      openSockets: state.sockets.size,
      joinCode: state.joinCode,
      publicAddress: state.publicAddress,
      stats: state.stats,
      lastSaveAt: state.lastSaveAt
    };
  }

  return { feed, snapshot, resetSession };
}
