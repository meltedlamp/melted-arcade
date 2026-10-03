"""SQLite store for arcade names, passwords, and scores."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "arcade.db"
HOST = "127.0.0.1"
PORT = 8080
GAMES = ("moon", "shooter", "guess", "pong")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9 _-]*$", re.I)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                salt TEXT NOT NULL,
                hash TEXT NOT NULL,
                created INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS marks (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                game TEXT NOT NULL,
                score INTEGER NOT NULL,
                at INTEGER NOT NULL,
                note TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS game_stats (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                game TEXT NOT NULL,
                wins INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, game)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS marks_user_game ON marks(user_id, game, score);
            """
        )


def name_key(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def name_problem(value: str) -> str:
    display = re.sub(r"\s+", " ", str(value or "").strip())
    if len(display) < 2:
        return "Use at least 2 characters."
    if len(display) > 16:
        return "Keep it to 16 characters."
    if not NAME_RE.match(display):
        return "Letters, numbers, spaces, hyphens, and underscores only."
    return ""


def digest(salt: str, password: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()


def whole(value) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def user_by_token(conn: sqlite3.Connection, token: str):
    if not token:
        return None
    return conn.execute(
        """
        SELECT users.* FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?
        """,
        (token,),
    ).fetchone()


def public_user(conn: sqlite3.Connection, user) -> dict:
    games = {}
    for game in GAMES:
        rows = conn.execute(
            """
            SELECT score, at, note FROM marks
            WHERE user_id = ? AND game = ?
            ORDER BY id DESC
            LIMIT 30
            """,
            (user["id"], game),
        ).fetchall()
        best = conn.execute(
            """
            SELECT score, at FROM marks
            WHERE user_id = ? AND game = ?
            ORDER BY score DESC, at ASC
            LIMIT 1
            """,
            (user["id"], game),
        ).fetchone()
        wins = conn.execute(
            "SELECT wins FROM game_stats WHERE user_id = ? AND game = ?",
            (user["id"], game),
        ).fetchone()
        history = [
            {"score": row["score"], "at": row["at"], "note": row["note"]}
            for row in reversed(rows)
            if row["score"] > 0
        ]
        games[game] = {
            "best": best["score"] if best else 0,
            "bestAt": best["at"] if best else 0,
            "wins": wins["wins"] if wins else 0,
            "history": history,
        }
    return {"key": user["name_key"], "name": user["name"], "games": games}


def scoreboard(conn: sqlite3.Connection, game: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT users.name_key AS key, users.name AS name, marks.score AS score, marks.at AS at,
               COALESCE(game_stats.wins, 0) AS wins
        FROM marks
        JOIN users ON users.id = marks.user_id
        JOIN (
            SELECT user_id, MAX(score) AS score
            FROM marks
            WHERE game = ?
            GROUP BY user_id
        ) best ON best.user_id = marks.user_id AND best.score = marks.score
        LEFT JOIN game_stats ON game_stats.user_id = users.id AND game_stats.game = marks.game
        WHERE marks.game = ?
        ORDER BY marks.score DESC, marks.at ASC, users.name COLLATE NOCASE ASC
        """,
        (game, game),
    ).fetchall()
    seen = set()
    board = []
    for row in rows:
        if row["key"] in seen:
            continue
        seen.add(row["key"])
        board.append(
            {
                "key": row["key"],
                "name": row["name"],
                "score": row["score"],
                "at": row["at"],
                "wins": row["wins"],
            }
        )
    return board


def boards(conn: sqlite3.Connection) -> dict:
    return {game: scoreboard(conn, game) for game in GAMES}


def state(conn: sqlite3.Connection, user) -> dict:
    return {
        "user": public_user(conn, user) if user else None,
        "boards": boards(conn),
    }


def add_marks(conn: sqlite3.Connection, user, marks: list, extra_wins: int) -> None:
    now = int(time.time() * 1000)
    win_notes = 0
    for mark in marks[:40]:
        if not isinstance(mark, dict):
            continue
        game = mark.get("game")
        score = whole(mark.get("score"))
        note = "win" if mark.get("note") == "win" and game == "pong" else ""
        if game not in GAMES or score <= 0 or score > 9_999_999:
            continue
        conn.execute(
            "INSERT INTO marks (user_id, game, score, at, note) VALUES (?, ?, ?, ?, ?)",
            (user["id"], game, score, now, note),
        )
        if note == "win":
            win_notes += 1
        conn.execute(
            """
            DELETE FROM marks
            WHERE id IN (
                SELECT id FROM marks
                WHERE user_id = ? AND game = ?
                ORDER BY id DESC
                LIMIT -1 OFFSET 30
            )
            """,
            (user["id"], game),
        )
    added = win_notes + max(0, min(int(extra_wins or 0), 999))
    if added:
        conn.execute(
            """
            INSERT INTO game_stats (user_id, game, wins) VALUES (?, 'pong', ?)
            ON CONFLICT(user_id, game) DO UPDATE SET wins = wins + excluded.wins
            """,
            (user["id"], added),
        )


class ArcadeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.route("GET")
            return
        target = Path(self.translate_path(self.path)).resolve()
        if not target.is_relative_to(ROOT) or target.suffix == ".db" or target.name == "server.py":
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path.startswith("/api/"):
            self.route("POST")
            return
        self.send_error(404)

    def route(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        token = ""
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header[7:].strip()
        try:
            body = self.read_json() if method == "POST" else {}
        except ValueError:
            self.send_json(400, {"error": "That was not a valid request."})
            return
        with connect() as conn:
            user = user_by_token(conn, token)
            if path == "/api/state" and method == "GET":
                self.send_json(200, state(conn, user))
                return
            if path == "/api/name" and method == "GET":
                query = parse_qs(parsed.query)
                key = name_key((query.get("name") or [""])[0])
                row = conn.execute("SELECT name FROM users WHERE name_key = ?", (key,)).fetchone()
                self.send_json(200, {"name": row["name"] if row else "", "exists": bool(row)})
                return
            if path == "/api/register" and method == "POST":
                self.register(conn, body)
                return
            if path == "/api/login" and method == "POST":
                self.login(conn, body)
                return
            if path == "/api/logout" and method == "POST":
                if token:
                    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                self.send_json(200, {"ok": True})
                return
            if path == "/api/marks" and method == "POST":
                if not user:
                    self.send_json(401, {"error": "Sign in first."})
                    return
                marks = body.get("marks") if isinstance(body.get("marks"), list) else []
                try:
                    extra = int(body.get("wins") or 0)
                except (TypeError, ValueError):
                    extra = 0
                add_marks(conn, user, marks, extra)
                fresh = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                self.send_json(200, state(conn, fresh))
                return
        self.send_json(404, {"error": "Not found."})

    def register(self, conn: sqlite3.Connection, body: dict) -> None:
        display = re.sub(r"\s+", " ", str(body.get("name") or "").strip())
        password = str(body.get("password") or "")
        problem = name_problem(display)
        if problem:
            self.send_json(400, {"error": problem})
            return
        if len(password) < 4:
            self.send_json(400, {"error": "Use at least 4 characters in the password."})
            return
        key = name_key(display)
        if conn.execute("SELECT 1 FROM users WHERE name_key = ?", (key,)).fetchone():
            self.send_json(409, {"error": "That name is already in the arcade."})
            return
        salt = secrets.token_hex(16)
        cur = conn.execute(
            "INSERT INTO users (name_key, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)",
            (key, display, salt, digest(salt, password), int(time.time() * 1000)),
        )
        user = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        token = self.open_session(conn, user["id"])
        payload = state(conn, user)
        payload["token"] = token
        self.send_json(200, payload)

    def login(self, conn: sqlite3.Connection, body: dict) -> None:
        key = name_key(body.get("name") or "")
        password = str(body.get("password") or "")
        user = conn.execute("SELECT * FROM users WHERE name_key = ?", (key,)).fetchone()
        if not user:
            self.send_json(404, {"error": "That name is not in the arcade yet."})
            return
        if not secrets.compare_digest(digest(user["salt"], password), user["hash"]):
            self.send_json(401, {"error": "Wrong password."})
            return
        token = self.open_session(conn, user["id"])
        payload = state(conn, user)
        payload["token"] = token
        self.send_json(200, payload)

    def open_session(self, conn: sqlite3.Connection, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)",
            (token, user_id, int(time.time() * 1000)),
        )
        return token

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > 64_000:
            raise ValueError("bad length")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("not an object")
        return data

    def send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} {fmt % args}")


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), ArcadeHandler)
    print(f"Melted Arcade of DOOM  http://{HOST}:{PORT}")
    print(f"SQLite                  {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
