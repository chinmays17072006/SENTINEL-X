#!/usr/bin/env sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"
node --check public/app.js
node --check public/operations.js
node --check public/traceability.js
python3 -m unittest discover -s tests -p 'test_*.py' -v
