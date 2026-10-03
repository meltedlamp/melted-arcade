/* Fills the signed-in name, each player's marks, and the scoreboard. */

function renderWho() {
  const slot = document.getElementById("who");
  if (!slot) return;
  const user = currentUser();
  if (arcadeState.offline) {
    slot.textContent = "Database offline";
    return;
  }
  if (!user) {
    slot.innerHTML = '<a href="account.html">Sign in</a>';
    return;
  }
  slot.innerHTML = `<a href="account.html">${escapeHTML(user.name)}</a>`;
}

function renderHolders() {
  for (const slot of document.querySelectorAll("[data-holder]")) {
    const rows = scoreboard(slot.dataset.holder);
    slot.textContent = rows.length ? `${rows[0].name} holds ${rows[0].score}` : "";
  }
}

function historyLine(game, row) {
  if (game === "pong" && row.note === "win") return `Rally ${row.score}, and a win`;
  if (game === "pong") return `Rally ${row.score}`;
  return String(row.score);
}

function renderGame(game) {
  const score = document.getElementById("score");
  const note = document.getElementById("score-note");
  const history = document.getElementById("history");
  const board = document.getElementById("board");
  if (!score || !note || !history || !board) return;

  const copy = ARCADE_GAMES[game];
  const user = currentUser();
  const mine = user ? user.games[game] : null;

  if (!user) {
    score.textContent = "–";
    note.innerHTML = 'Sign in first. Then a run comes back on your name. <a href="account.html">Sign in</a>';
  } else if (!mine || mine.best <= 0) {
    score.textContent = "0";
    note.textContent = copy.empty;
  } else {
    score.textContent = String(mine.best);
    note.textContent = game === "pong" && mine.wins
      ? `${copy.kept} Wins against ACE: ${mine.wins}.`
      : copy.kept;
  }

  const past = mine ? mine.history.slice().reverse() : [];
  if (!user) {
    history.innerHTML = '<li class="quiet">Sign in to keep a history.</li>';
  } else if (!past.length) {
    history.innerHTML = '<li class="quiet">No scores on this name yet.</li>';
  } else {
    history.innerHTML = past.slice(0, 8).map((row) => (
      `<li><span>${escapeHTML(historyLine(game, row))}</span></li>`
    )).join("");
  }

  const rows = scoreboard(game);
  if (!rows.length) {
    board.innerHTML = '<li class="quiet">No one has a score yet.</li>';
    return;
  }
  const shown = rows.slice(0, 10);
  const me = user && rows.findIndex((row) => row.key === user.key);
  if (user && me >= 10) shown.push(rows[me]);
  board.innerHTML = shown.map((row) => {
    const rank = rows.findIndex((item) => item.key === row.key) + 1;
    const mineClass = user && row.key === user.key ? " mine" : "";
    const wins = game === "pong" && row.wins ? `<span class="wins">${row.wins} wins</span>` : "";
    return `<li class="${mineClass.trim()}">
      <span class="rank">${rank}</span>
      <span class="who-name">${escapeHTML(row.name)}${wins}</span>
      <span class="pts">${row.score}</span>
    </li>`;
  }).join("");
}

function bootAccount() {
  const nameForm = document.getElementById("name-form");
  const passForm = document.getElementById("pass-form");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const confirm = document.getElementById("confirm");
  const confirmLabel = document.getElementById("confirm-label");
  const passNote = document.getElementById("pass-note");
  const passSubmit = document.getElementById("pass-submit");
  const title = document.getElementById("account-title");
  const error = document.getElementById("form-error");
  const session = document.getElementById("session");
  const logout = document.getElementById("logout");
  let mode = "create";

  function showError(message) {
    error.textContent = message || "";
  }

  function showSession() {
    const user = currentUser();
    if (!user) {
      session.hidden = true;
      return;
    }
    session.hidden = false;
    session.querySelector("strong").textContent = user.name;
  }

  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const problem = nameProblem(username.value);
    if (problem) {
      showError(problem);
      return;
    }
    const key = nameKey(username.value);
    const existing = await findUser(key);
    if (existing && existing.error) {
      showError(existing.error);
      return;
    }
    mode = existing ? "login" : "create";
    nameForm.hidden = true;
    passForm.hidden = false;
    password.value = "";
    confirm.value = "";
    if (existing) {
      title.textContent = "That name is taken.";
      passNote.textContent = `${existing.name} is already in the arcade. Enter the password.`;
      passSubmit.textContent = "Log in";
      confirmLabel.hidden = true;
      password.autocomplete = "current-password";
    } else {
      title.textContent = "New name.";
      passNote.textContent = "Pick a password so the next person cannot wear it.";
      passSubmit.textContent = "Create account";
      confirmLabel.hidden = false;
      password.autocomplete = "new-password";
    }
    password.focus();
  });

  document.getElementById("back-name").addEventListener("click", () => {
    passForm.hidden = true;
    nameForm.hidden = false;
    title.textContent = "Type a name.";
    showError("");
    username.focus();
  });

  passForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    passSubmit.disabled = true;
    try {
      let result;
      if (mode === "create") {
        if (password.value !== confirm.value) {
          showError("Those passwords do not match.");
          return;
        }
        result = await createAccount(username.value, password.value);
      } else {
        result = await loginAccount(username.value, password.value);
      }
      if (result.error) {
        showError(result.error);
        return;
      }
      window.location.href = "./";
    } catch (err) {
      showError("The account could not be saved.");
    } finally {
      passSubmit.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    await logoutAccount();
    showSession();
    showError("");
  });

  showSession();
}

async function startArcade() {
  await claimMarks();
  renderWho();
  renderHolders();
  if (document.body.dataset.page === "account") bootAccount();
  else if (document.body.dataset.game) renderGame(document.body.dataset.game);
}

startArcade();
