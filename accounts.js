/* Names, passwords, and scores. Stored in SQLite by server.py. */

const ARCADE_TOKEN = "melted-arcade-token";
const ARCADE_PLAYER = "melted-arcade-player";
const ARCADE_SEEN = "melted-arcade-seen";
const ARCADE_SLIPS = "melted-arcade-slips";

const ARCADE_GAMES = {
  moon: {
    label: "The Red Moon",
    empty: "Nothing on your name yet. Play, then come back.",
    kept: "Points on your name.",
  },
  shooter: {
    label: "Mini Shooter",
    empty: "Nothing on your name yet. The next wave will not wait.",
    kept: "Points on your name, before the hearts ran out.",
  },
  pong: {
    label: "Ping Pong",
    empty: "No rally on your name yet.",
    kept: "Best rally on your name.",
  },
  guess: {
    label: "Guess the Number",
    empty: "Reed has not been right for you yet.",
    kept: "Most digits Reed got right in one sitting, on your name.",
  },
};

const arcadeState = {
  user: null,
  boards: { moon: [], shooter: [], guess: [], pong: [] },
  offline: false,
};

function arcadeRead(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function arcadeWrite(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

function whole(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function nameKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function nameProblem(value) {
  const display = String(value || "").trim().replace(/\s+/g, " ");
  if (display.length < 2) return "Use at least 2 characters.";
  if (display.length > 16) return "Keep it to 16 characters.";
  if (!/^[a-z0-9][a-z0-9 _-]*$/i.test(display)) {
    return "Letters, numbers, spaces, hyphens, and underscores only.";
  }
  return "";
}

function applyState(data) {
  arcadeState.offline = false;
  arcadeState.user = data.user || null;
  arcadeState.boards = data.boards || arcadeState.boards;
  if (data.token) arcadeWrite(ARCADE_TOKEN, data.token);
  if (arcadeState.user) arcadeWrite(ARCADE_PLAYER, arcadeState.user.key);
}

async function api(path, body) {
  const headers = {};
  const token = arcadeRead(ARCADE_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    arcadeState.offline = true;
    return { error: "The arcade database is not running. Start it with python server.py." };
  }
  let data = {};
  try {
    data = await response.json();
  } catch (err) {
    data = {};
  }
  if (!response.ok) return { error: data.error || "The arcade could not save that." };
  return data;
}

function currentUser() {
  return arcadeState.user;
}

function scoreboard(game) {
  return arcadeState.boards[game] || [];
}

async function findUser(key) {
  const data = await api(`/api/name?name=${encodeURIComponent(key)}`);
  if (data.error) return { error: data.error };
  return data.exists ? { name: data.name, key: nameKey(data.name) } : null;
}

async function createAccount(display, password) {
  const problem = nameProblem(display);
  if (problem) return { error: problem };
  if (password.length < 4) return { error: "Use at least 4 characters in the password." };
  const data = await api("/api/register", { name: display, password });
  if (data.error) return data;
  applyState(data);
  return { user: data.user };
}

async function loginAccount(display, password) {
  const data = await api("/api/login", { name: display, password });
  if (data.error) return data;
  applyState(data);
  return { user: data.user };
}

async function logoutAccount() {
  await api("/api/logout", {});
  try {
    localStorage.removeItem(ARCADE_TOKEN);
    localStorage.removeItem(ARCADE_PLAYER);
  } catch (err) {
    /* Already signed out. */
  }
  arcadeState.user = null;
}

function storedNumber(key) {
  return whole(arcadeRead(key));
}

function storedPong() {
  const stats = { wins: 0, rally: 0 };
  const raw = arcadeRead("ping-pong-stats") || "";
  for (const line of raw.split("\n")) {
    const cut = line.indexOf("=");
    if (cut < 0) continue;
    const key = line.slice(0, cut).trim();
    const value = Number(line.slice(cut + 1).trim());
    if ((key === "wins" || key === "rally") && Number.isFinite(value) && value >= 0) {
      stats[key] = Math.floor(value);
    }
  }
  return stats;
}

function rawMarks() {
  const pong = storedPong();
  return {
    moon: storedNumber("red-moon-best"),
    shooter: storedNumber("mini-shooter-best"),
    guess: storedNumber("guess-the-number-best"),
    pong: pong.rally,
    wins: pong.wins,
  };
}

function loadSeen() {
  try {
    const data = JSON.parse(arcadeRead(ARCADE_SEEN) || "");
    if (!data || typeof data !== "object") return null;
    return {
      moon: whole(data.moon),
      shooter: whole(data.shooter),
      guess: whole(data.guess),
      pong: whole(data.pong),
      wins: whole(data.wins),
    };
  } catch (err) {
    return null;
  }
}

function readSlips() {
  try {
    const data = JSON.parse(arcadeRead(ARCADE_SLIPS) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((slip) => slip && ARCADE_GAMES[slip.game] && nameKey(slip.player));
  } catch (err) {
    return [];
  }
}

function clearSlips() {
  try {
    localStorage.removeItem(ARCADE_SLIPS);
  } catch (err) {
    /* The next visit will try again. */
  }
}

async function claimMarks() {
  const data = await api("/api/state");
  if (data.error) return;
  applyState(data);

  const raw = rawMarks();
  const seen = loadSeen();
  if (!arcadeState.user) {
    if (!seen) arcadeWrite(ARCADE_SEEN, JSON.stringify(raw));
    return;
  }
  if (!seen) {
    arcadeWrite(ARCADE_SEEN, JSON.stringify(raw));
    return;
  }

  const marks = [];
  const slipped = new Set();
  for (const slip of readSlips()) {
    if (nameKey(slip.player) !== arcadeState.user.key) continue;
    slipped.add(slip.game);
    marks.push({
      game: slip.game,
      score: whole(slip.score),
      note: slip.note === "win" ? "win" : "",
    });
  }
  for (const game of ["moon", "shooter", "guess", "pong"]) {
    if (slipped.has(game)) continue;
    if (raw[game] > seen[game]) marks.push({ game, score: raw[game], note: "" });
  }
  const wins = raw.wins > seen.wins && !slipped.has("pong") ? raw.wins - seen.wins : 0;
  if (!marks.length && !wins) return;

  const saved = await api("/api/marks", { marks, wins });
  if (saved.error) return;
  applyState(saved);
  clearSlips();
  arcadeWrite(ARCADE_SEEN, JSON.stringify(raw));
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
