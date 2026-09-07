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
    names: new Map(),          // player name -> last seen timestamp
    sockets: new Set(),        // connection ids currently open
    heartbeatCount: null,      // count as last reported by the server
    heartbeatSeq: -1,          // when that count arrived
    socketsSeq: -1,            // when socket bookkeeping last changed
    joinCode: null,
    publicAddress: null,
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
          if (!event.isDeath && g.name) state.names.set(g.name, Date.now());
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
        case 'sessionNew':
        case 'heartbeat': {
          if (g.code) state.joinCode = g.code;
          if (g.players !== undefined) {
            state.heartbeatCount = Number(g.players);
            state.heartbeatSeq = ++seq;
            if (state.heartbeatCount === 0) {
              state.sockets.clear();
              state.names.clear();
            }
          }
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
    if (state.heartbeatCount === null) {
      return { count: state.sockets.size, source: 'connections' };
    }
    if (state.socketsSeq > state.heartbeatSeq) {
      return { count: state.sockets.size, source: 'connections' };
    }
    return { count: state.heartbeatCount, source: 'session' };
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
    state.names.clear();
    state.sockets.clear();
    state.heartbeatCount = null;
    state.heartbeatSeq = -1;
    state.socketsSeq = -1;
    state.joinCode = null;
    state.publicAddress = null;
    seq = 0;
  }

  function snapshot() {
    const { count, source } = playerCount();
    return {
      players: [...state.names.keys()],
      playerCount: count,
      playerCountSource: source,
      openSockets: state.sockets.size,
      joinCode: state.joinCode,
      publicAddress: state.publicAddress,
      lastSaveAt: state.lastSaveAt
    };
  }

  return { feed, snapshot, resetSession };
}
