/* Names, passwords, and scores for this arcade. Kept in this browser. */

const ARCADE_DB = "melted-arcade";
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

function loadDB() {
  let data = null;
  try {
    data = JSON.parse(arcadeRead(ARCADE_DB) || "");
  } catch (err) {
    data = null;
  }
  if (!data || typeof data !== "object" || !data.users || typeof data.users !== "object") {
    return { users: {} };
  }
  return data;
}

function saveDB(db) {
  return arcadeWrite(ARCADE_DB, JSON.stringify(db));
}

function blankGame() {
  return { best: 0, bestAt: 0, wins: 0, history: [] };
}

function shapeUser(user) {
  user.games = user.games && typeof user.games === "object" ? user.games : {};
  for (const id of Object.keys(ARCADE_GAMES)) {
    const raw = user.games[id] && typeof user.games[id] === "object" ? user.games[id] : {};
    const history = Array.isArray(raw.history) ? raw.history : [];
    user.games[id] = {
      best: whole(raw.best),
      bestAt: whole(raw.bestAt),
      wins: whole(raw.wins),
      history: history
        .filter((row) => row && whole(row.score) > 0)
        .slice(-30)
        .map((row) => ({
          score: whole(row.score),
          at: whole(row.at),
          note: typeof row.note === "string" ? row.note.slice(0, 40) : "",
        })),
    };
  }
  return user;
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

function currentKey() {
  return nameKey(arcadeRead(ARCADE_PLAYER) || "");
}

function currentUser() {
  const key = currentKey();
  if (!key) return null;
  const db = loadDB();
  const user = db.users[key];
  if (!user) return null;
  user.key = key;
  return shapeUser(user);
}

function findUser(key) {
  const db = loadDB();
  const user = db.users[key];
  if (!user) return null;
  user.key = key;
  return shapeUser(user);
}

async function digest(salt, password) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createAccount(display, password) {
  const problem = nameProblem(display);
  if (problem) return { error: problem };
  if (password.length < 4) return { error: "Use at least 4 characters in the password." };
  const key = nameKey(display);
  const db = loadDB();
  if (db.users[key]) return { error: "That name is already in the arcade." };
  const salt = randomSalt();
  const user = shapeUser({
    name: display.trim().replace(/\s+/g, " "),
    salt,
    hash: await digest(salt, password),
    created: Date.now(),
    games: {},
  });
  db.users[key] = user;
  if (!saveDB(db)) return { error: "This browser would not store the account." };
  arcadeWrite(ARCADE_PLAYER, key);
  return { user };
}

async function loginAccount(display, password) {
  const key = nameKey(display);
  const db = loadDB();
  const user = db.users[key];
  if (!user) return { error: "That name is not in the arcade yet." };
  const hash = await digest(user.salt, password);
  if (hash !== user.hash) return { error: "Wrong password." };
  arcadeWrite(ARCADE_PLAYER, key);
  return { user: shapeUser(user) };
}

function logoutAccount() {
  try {
    localStorage.removeItem(ARCADE_PLAYER);
  } catch (err) {
    /* Already signed out. */
  }
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

function addMark(db, player, game, score, note) {
  const key = nameKey(player);
  const user = db.users[key];
  score = whole(score);
  if (!user || score <= 0) return;
  shapeUser(user);
  const row = user.games[game];
  row.history.push({ score, at: Date.now(), note: note || "" });
  if (row.history.length > 30) row.history.splice(0, row.history.length - 30);
  if (score > row.best) {
    row.best = score;
    row.bestAt = Date.now();
  }
  if (note === "win") row.wins += 1;
}

function claimMarks() {
  const raw = rawMarks();
  const seen = loadSeen();
  const slips = readSlips();
  const db = loadDB();
  const slipped = new Set();

  for (const slip of slips) {
    if (!db.users[nameKey(slip.player)]) continue;
    slipped.add(slip.game);
    addMark(db, slip.player, slip.game, slip.score, slip.note === "win" ? "win" : "");
  }

  const player = currentKey();
  if (seen && player && db.users[player]) {
    for (const game of ["moon", "shooter", "guess", "pong"]) {
      if (slipped.has(game)) continue;
      if (raw[game] > seen[game]) addMark(db, player, game, raw[game], "");
    }
    if (raw.wins > seen.wins && !slipped.has("pong")) {
      shapeUser(db.users[player]);
      db.users[player].games.pong.wins += raw.wins - seen.wins;
    }
  }

  if (saveDB(db)) clearSlips();
  arcadeWrite(ARCADE_SEEN, JSON.stringify(raw));
}

function scoreboard(game) {
  const db = loadDB();
  const rows = [];
  for (const [key, user] of Object.entries(db.users)) {
    shapeUser(user);
    const row = user.games[game];
    if (!row || row.best <= 0) continue;
    rows.push({
      key,
      name: user.name || key,
      score: row.best,
      at: row.bestAt,
      wins: row.wins,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.at - b.at || a.name.localeCompare(b.name));
  return rows;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
