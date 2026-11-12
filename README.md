# Smart Finance Hub — Flask Backend

This is the current frontend (`index.html`, `script.js`, `style.css` — the
version with the full landing page, simulator, and showcase sections) wired
up to a Python/Flask backend, replacing the old `localStorage`-only data
layer with real server-side persistence (SQLite) and session-based
authentication.

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:8000/** — Flask serves `index.html`,
`script.js`, and `style.css` directly, so there's nothing else to run and no
CORS to configure (everything is same-origin). `server.js` (the old Node
static file server) is no longer needed.

A SQLite database file `smartfinance.db` is created automatically in this
folder on first run.

## What changed vs. the pure-frontend version

- **`app.py`** (new) — the Flask backend: REST API + SQLite persistence +
  static file serving.
- **`script.js`** — the `localStorage` helper functions (`getUserRecord`,
  `saveUserData`, `getSession`, etc.) were replaced with `fetch`-based calls
  to the new API (`apiRequest()` helper). All auth flows (login, register,
  Gmail demo, one-click demo mode), profile/password updates,
  account deletion, and session restore-on-load now talk to the server.
  All UI rendering and app logic (dashboard, budgets, goals, investments,
  reports, the landing page/simulator, etc.) is untouched.
- **`index.html`** / **`style.css`** — unchanged.

## Data model

Each user has one JSON "data" blob (transactions, budgets, goals,
investments, notifications, profile) — mirroring the original in-browser
`userData` object exactly, just persisted server-side in the `user_data`
table instead of `localStorage`. Login state is kept in a signed Flask
session cookie instead of an `sfh_session_current` localStorage key.

## API overview

All endpoints are prefixed with `/api` and exchange JSON. Authenticated
endpoints rely on the session cookie set by login/register (sent
automatically by the browser — no token handling needed in the frontend).

| Method | Path                          | Auth | Description                              |
|--------|-------------------------------|------|-------------------------------------------|
| POST   | `/api/auth/register`          | –    | Create account, log in                    |
| POST   | `/api/auth/login`             | –    | Log in with username/password             |
| POST   | `/api/auth/oauth/gmail`       | –    | Simulated Google OAuth login              |
| POST   | `/api/auth/demo`              | –    | One-click demo login (seeds sample data)  |
| POST   | `/api/auth/logout`            | ✔    | Clear session                              |
| GET    | `/api/auth/me`                | ✔    | Current user + data (used on page load)   |
| GET    | `/api/data`                   | ✔    | Fetch the user's data blob                |
| PUT    | `/api/data`                   | ✔    | Replace the user's data blob              |
| PUT    | `/api/profile`                | ✔    | Update name/email                         |
| PUT    | `/api/password`               | ✔    | Change password                           |
| DELETE | `/api/account`                | ✔    | Delete account and all data               |

Passwords are hashed with Werkzeug's `generate_password_hash` /
`check_password_hash` (PBKDF2) rather than a reversible client-side encoding.

## Notes

- This uses Flask's built-in development server (`debug=True`), which is
  fine for local use/demos. For production, run behind a proper WSGI server
  (gunicorn/uwsgi) and set a strong `SFH_SECRET_KEY` environment variable.

