/* Best marks saved by the four games in this browser. Same site, so the keys are here. */

function storedNumber(key) {
  try {
    const value = Number(localStorage.getItem(key));
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  } catch (err) {
    return 0;
  }
}

function storedPong() {
  const stats = { wins: 0, rally: 0 };
  let raw = "";
  try {
    raw = localStorage.getItem("ping-pong-stats") || "";
  } catch (err) {
    return stats;
  }
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

function showRecord(game) {
  const score = document.getElementById("score");
  const note = document.getElementById("score-note");
  if (!score || !note) return;

  if (game === "pong") {
    const stats = storedPong();
    score.textContent = String(stats.rally);
    note.textContent = stats.rally || stats.wins
      ? `Best rally in this browser. Wins against ACE: ${stats.wins}.`
      : "No rally in this browser yet. ACE is fine with that.";
    return;
  }

  const keys = {
    moon: "red-moon-best",
    shooter: "mini-shooter-best",
    guess: "guess-the-number-best",
  };
  const lines = {
    moon: ["Points in this browser.", "No score in this browser yet. The Moon can wait."],
    shooter: ["Points before the hearts ran out.", "No score in this browser yet. The next wave will not wait."],
    guess: ["Most digits Reed got right in one sitting.", "Reed has not been right in this browser yet."],
  };
  const value = storedNumber(keys[game]);
  const [kept, empty] = lines[game];
  score.textContent = String(value);
  note.textContent = value ? kept : empty;
}

showRecord(document.body.dataset.game);
