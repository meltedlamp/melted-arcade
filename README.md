# Melted Arcade of DOOM

A front page for four games. Pressing a game opens its page here first: the best mark saved for that name, and a short word on the levels. Play anyway opens that game's own site.

Names, password hashes, and the scoreboards are stored in SQLite (`arcade.db`). Start the arcade with `python server.py`, then open http://127.0.0.1:8080.

| Game | Page here | The game |
| --- | --- | --- |
| The Red Moon | red-moon.html | https://meltedlamp.github.io/red-moon/ |
| Mini Shooter | mini-shooter.html | https://meltedlamp.github.io/mini-shooter/ |
| Ping Pong | ping-pong.html | https://meltedlamp.github.io/ping-pong/ |
| Guess the Number | guess.html | https://meltedlamp.github.io/guess-the-number/ |

The four games stay in their own repositories. A run still lands in this browser first (`red-moon-best`, `mini-shooter-best`, `ping-pong-stats`, `guess-the-number-best`). Signing in copies the new mark into SQLite, which is what the scoreboards read.
