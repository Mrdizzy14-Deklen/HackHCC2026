# Shared across both Dockerfiles (build context = repo root)

# Version control
.git
.gitignore
.gitattributes

# Local Python
__pycache__/
*.py[cod]
*.so
.Python
build/
dist/
*.egg-info/
.eggs/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage

# Virtual envs
.venv/
venv/
env/
ENV/

# Secrets — never bake into image
.env
.env.*
!.env.example
webapp/.env
webapp/.env.*
!webapp/.env.local.example

# Editors / OS
.vscode/
.idea/
.cursor/
*.swp
*~
.DS_Store
Thumbs.db

# HackHCC runtime artifacts (mount a volume instead)
sessions/
exports/
output/
models/
.active_session
assets/soundfonts/*.sf2

# Node — webapp Dockerfile re-installs from package-lock
webapp/node_modules
webapp/.next
webapp/out

# Godot project is desktop-only — never needs to ship in either image
hack-hcc-2026/

# Sample media is dev-only (loaded into Mongo via webapp/scripts/load-media.mjs)
media/

# NOTE: composer-app/static/* and composer-app/rigged_hand/* (3D models +
# textures) ARE needed at runtime — FastAPI serves them via /static so the
# browser scene can load. Don't exclude them.

# Misc
*.log
tempCodeRunnerFile.py
docs/
