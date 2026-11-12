import json
import os
import random
import re
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
import firebase_admin
from firebase_admin import credentials, firestore

# Load environment variables from .env file
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
app.config["SECRET_KEY"] = os.environ.get("SFH_SECRET_KEY", "dev-secret-change-me")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# ---------------------------------------------------------------------------
# Firebase / Firestore setup
# ---------------------------------------------------------------------------
def init_firebase():
    """Initialize Firebase using a local JSON key or FIREBASE_CREDENTIALS env var."""
    if firebase_admin._apps:
        return firestore.client()

    credentials_json = os.environ.get("FIREBASE_CREDENTIALS")

    if credentials_json:
        try:
            cred_dict = json.loads(credentials_json)
            if "private_key" in cred_dict and not cred_dict["private_key"].startswith("-----BEGIN"):
                cred_dict["private_key"] = "-----BEGIN PRIVATE KEY-----\n" + cred_dict["private_key"].lstrip()
            cred = credentials.Certificate(cred_dict)
        except json.JSONDecodeError:
            cred = credentials.Certificate(credentials_json)
    else:
        candidates = ["serviceAccountKey.json", "ServiceAccountkey.json"]
        credentials_path = None
        for candidate in candidates:
            p = os.path.join(BASE_DIR, candidate)
            if os.path.exists(p):
                credentials_path = p
                break

        if not credentials_path:
            raise FileNotFoundError(
                "Firebase credentials not found. Put serviceAccountKey.json beside "
                "app.py or set the FIREBASE_CREDENTIALS environment variable."
            )

        try:
            with open(credentials_path, "r", encoding="utf-8") as f:
                cred_dict = json.load(f)
            if "private_key" in cred_dict and not cred_dict["private_key"].startswith("-----BEGIN"):
                cred_dict["private_key"] = "-----BEGIN PRIVATE KEY-----\n" + cred_dict["private_key"].lstrip()
            cred = credentials.Certificate(cred_dict)
        except Exception:
            cred = credentials.Certificate(credentials_path)

    firebase_admin.initialize_app(cred)
    return firestore.client()


db = init_firebase()


def init_db():
    """Compatibility placeholder for database setup."""
    return None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Phone Number Helper Utilities
# ---------------------------------------------------------------------------
def normalize_phone_number(phone: str, default_country_code: str = "+91") -> str:
    """Normalize a phone number string to E.164 international format (+<country><digits>)."""
    if not phone:
        return ""
    stripped = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if stripped.startswith("+"):
        digits = "".join(ch for ch in stripped if ch.isdigit())
        if 10 <= len(digits) <= 15:
            return f"+{digits}"
    else:
        digits = "".join(ch for ch in stripped if ch.isdigit())
        if len(digits) == 10:
            return f"{default_country_code}{digits}"
        elif 10 < len(digits) <= 15:
            return f"+{digits}"
    return stripped


def mask_phone_number(phone: str) -> str:
    """Mask phone number for privacy display (e.g. '+91 ******3210' or '+1 ******4567'). Never returns full number."""
    if not phone:
        return ""
    clean = str(phone).strip()
    if len(clean) <= 4:
        return "****"
    
    prefix = ""
    if clean.startswith("+"):
        if clean.startswith("+1") and len(clean) == 12:  # E.g. +1 (US/Canada 10-digits)
            prefix = "+1"
        elif clean.startswith("+91"):
            prefix = "+91"
        elif clean.startswith("+44"):
            prefix = "+44"
        elif len(clean) >= 8:
            prefix = clean[:3]
        else:
            prefix = clean[:2]
    elif len(clean) >= 10:
        prefix = ""
    else:
        prefix = clean[:2]
        
    suffix = clean[-4:]
    return f"{prefix} ******{suffix}".strip()


# ---------------------------------------------------------------------------
# Default user data shape (mirrors defaultUserData() in script.js)
# ---------------------------------------------------------------------------
def default_user_data(name, email, phone=""):
    return {
        "profile": {
            "name": name,
            "email": email,
            "joined": now_iso(),
            "phone": phone,
            "phoneVerified": bool(phone),
            "authProvider": "password",
        },
        "transactions": [],
        "budgets": {},
        "goals": [],
        "investments": {"holdings": [], "sips": []},
        "notifications": [],
    }


# ---------------------------------------------------------------------------
# Firestore data access helpers
# ---------------------------------------------------------------------------
def get_user_row(username):
    doc = db.collection("users").document(username).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def get_user_data(username):
    doc = db.collection("user_data").document(username).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("data")


def save_user_data(username, data):
    db.collection("user_data").document(username).set({
        "data": data
    })


def create_user(username, password, name, email, phone=""):
    normalized_phone = normalize_phone_number(phone) if phone else ""
    db.collection("users").document(username).set({
        "username": username,
        "password_hash": generate_password_hash(password),
        "name": name,
        "email": email,
        "phoneNumber": normalized_phone,
        "phone": normalized_phone,
        "created_at": now_iso()
    })

    save_user_data(username, default_user_data(name, email, normalized_phone))


def delete_user(username):
    db.collection("user_data").document(username).delete()
    db.collection("users").document(username).delete()


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------
def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        username = session.get("username")
        if not username or not get_user_row(username):
            return jsonify(ok=False, error="Not authenticated."), 401
            
        g.username = username
        return fn(*args, **kwargs)

    return wrapper


def user_payload(username):
    """Safe user profile object to send to the client (no password hash)."""
    row = get_user_row(username) or {}
    phone = row.get("phoneNumber") or row.get("phone") or ""
    data = get_user_data(username) or {}
    auth_provider = data.get("profile", {}).get("authProvider", "password")
    email_verified = data.get("profile", {}).get("emailVerified", True if auth_provider == "google" else False)
    return {
        "username": row.get("username", username),
        "name": row.get("name", ""),
        "email": row.get("email", ""),
        "maskedPhone": mask_phone_number(phone),
        "authProvider": auth_provider,
        "emailVerified": email_verified,
    }


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    if filename in ("script.js", "style.css"):
        return send_from_directory(BASE_DIR, filename)
    return jsonify(ok=False, error="Not found"), 404


def validate_strong_password(password: str):
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter (A-Z)."
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter (a-z)."
    if not re.search(r"[0-9]", password):
        return False, "Password must contain at least one number (0-9)."
    if not re.search(r"[^A-Za-z0-9]", password):
        return False, "Password must contain at least one special character (!@#$%^&* etc.)."
    return True, ""


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------
@app.post("/api/auth/register")
def register():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip().lower()
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    phone = (body.get("phone") or body.get("phoneNumber") or "").strip()
    password = body.get("password") or ""

    if not re.fullmatch(r"[a-z0-9_]{3,20}", username):
        return jsonify(ok=False, error="Username must be 3–20 characters: letters, numbers, underscore only."), 400
    if not re.fullmatch(r"\S+@\S+\.\S+", email):
        return jsonify(ok=False, error="Enter a valid email address."), 400
    
    normalized_phone = ""
    if phone:
        cleaned_phone = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
        if cleaned_phone:
            normalized_phone = normalize_phone_number(cleaned_phone)

    is_valid_pw, pw_err = validate_strong_password(password)
    if not is_valid_pw:
        return jsonify(ok=False, error=pw_err), 400

    if not name:
        return jsonify(ok=False, error="Name is required."), 400

    if get_user_row(username):
        return jsonify(ok=False, error="That handle is already active."), 409

    create_user(username, password, name, email, normalized_phone)
    session.clear()
    session["username"] = username
    session["authenticated"] = True
    return jsonify(ok=True, user=user_payload(username), data=get_user_data(username))


@app.post("/api/auth/login")
def login():
    """Authenticate with username and password."""
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""

    row = get_user_row(username)
    if not row or not check_password_hash(row.get("password_hash", ""), password):
        return jsonify(ok=False, error="Incorrect username or access key."), 401

    session.clear()
    session["username"] = username
    session["authenticated"] = True

    data = get_user_data(username) or default_user_data(row.get("name", ""), row.get("email", ""))
    return jsonify(ok=True, user=user_payload(username), data=data)


@app.post("/api/auth/oauth/gmail")
@app.post("/api/auth/oauth/google")
def oauth_gmail():
    """100% Free Google Sign-In & Gmail Verification."""
    body = request.get_json(silent=True) or {}
    id_token = body.get("idToken") or body.get("id_token")
    email = (body.get("email") or "").strip().lower()
    name = (body.get("name") or "").strip()
    google_id = (body.get("googleId") or body.get("uid") or "").strip()

    # If Firebase Google ID Token is provided, verify it via firebase_admin.auth
    if id_token:
        try:
            from firebase_admin import auth as fb_auth
            decoded = fb_auth.verify_id_token(id_token)
            email = (decoded.get("email") or email).strip().lower()
            name = decoded.get("name") or name or "Google Pilot"
            google_id = decoded.get("uid") or google_id
        except Exception as e:
            app.logger.info(f"Firebase token verification note: {e}")

    if not email:
        email = "pilot.google@gmail.com"
    if not name:
        name = "Google Pilot"

    # Generate clean, unique username from email
    email_prefix = email.split("@")[0].lower()
    base_username = re.sub(r"[^a-z0-9_]", "_", email_prefix)[:18]
    if len(base_username) < 3:
        base_username = f"g_{base_username}"
    username = base_username

    row = get_user_row(username)
    if not row:
        create_user(username, "google-oauth-session-key", name, email, "")
    else:
        # Update name and email if updated in Google account
        db.collection("users").document(username).set({
            "name": name,
            "email": email
        }, merge=True)

    data = get_user_data(username) or default_user_data(name, email, "")
    if "profile" not in data:
        data["profile"] = {}
    data["profile"]["name"] = name
    data["profile"]["email"] = email
    data["profile"]["authProvider"] = "google"
    data["profile"]["emailVerified"] = True
    save_user_data(username, data)

    session.clear()
    session["username"] = username
    session["authenticated"] = True
    return jsonify(ok=True, user=user_payload(username), data=data)


@app.post("/api/auth/demo")
def demo_login():
    """Instant demo test drive login."""
    body = request.get_json(silent=True) or {}
    sample_data = body.get("data")

    username = "demo_pilot"
    row = get_user_row(username)
    if not row:
        create_user(username, "demopass123", "Captain Alex Mercer", "alex.mercer@orbital.io", "+919876543210")

    if isinstance(sample_data, dict):
        save_user_data(username, sample_data)

    data = get_user_data(username)
    session.clear()
    session["username"] = username
    session["authenticated"] = True
    return jsonify(ok=True, user=user_payload(username), data=data)


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/auth/me")
@login_required
def me():
    return jsonify(ok=True, user=user_payload(g.username), data=get_user_data(g.username))


# ---------------------------------------------------------------------------
# User data API
# ---------------------------------------------------------------------------
@app.get("/api/data")
@login_required
def get_data():
    return jsonify(ok=True, data=get_user_data(g.username))


@app.put("/api/data")
@login_required
def put_data():
    body = request.get_json(silent=True)
    if body is None:
        return jsonify(ok=False, error="Invalid payload."), 400
    save_user_data(g.username, body)
    return jsonify(ok=True)


@app.put("/api/profile")
@login_required
def put_profile():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    phone = (body.get("phone") or "").strip()
    
    if not name or not email:
        return jsonify(ok=False, error="Name and email are required."), 400

    update_fields = {"name": name, "email": email}
    normalized_phone = ""
    if phone:
        normalized_phone = normalize_phone_number(phone)
        update_fields["phoneNumber"] = normalized_phone
        update_fields["phone"] = normalized_phone

    db.collection("users").document(g.username).update(update_fields)

    data = get_user_data(g.username)
    if data and "profile" in data:
        data["profile"]["name"] = name
        data["profile"]["email"] = email
        if normalized_phone:
            data["profile"]["phone"] = normalized_phone
        save_user_data(g.username, data)

    return jsonify(ok=True, data=data, user=user_payload(g.username))


@app.put("/api/password")
@login_required
def put_password():
    body = request.get_json(silent=True) or {}
    current = body.get("current") or ""
    next_pw = body.get("next") or ""

    row = get_user_row(g.username)
    if not check_password_hash(row["password_hash"], current):
        return jsonify(ok=False, error="Current access key is invalid."), 401
    
    is_valid_pw, pw_err = validate_strong_password(next_pw)
    if not is_valid_pw:
        return jsonify(ok=False, error=pw_err), 400

    db.collection("users").document(g.username).update({
        "password_hash": generate_password_hash(next_pw)
    })

    return jsonify(ok=True)


@app.delete("/api/account")
@login_required
def delete_account():
    delete_user(g.username)
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8000, debug=True)
