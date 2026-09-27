# Scripts agent notes

Start and stop the Docker stack from any directory.

- `start.sh` (Mac/Linux), `start.ps1` / `start.bat` (Windows): check that the root `.env` exists and sets a non-empty `OPENROUTER_API_KEY`, then run `docker compose up --build -d`, then wait up to 30 seconds for `http://localhost:8000/api/health`, printing recent logs if it does not come up.
- `stop.sh`, `stop.ps1`, `stop.bat`: run `docker compose down --remove-orphans`. The `kanban-data` volume, and with it the board, is kept.

All scripts exit non-zero if Docker is not available. The PowerShell scripts check `$LASTEXITCODE` because native command failures do not throw in Windows PowerShell.
