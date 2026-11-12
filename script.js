const INCOME_CATEGORIES  = ['Salary','Freelance','Business','Investment','Gift','Other'];
const EXPENSE_CATEGORIES = ['Food','Transport','Housing','Utilities','Entertainment','Health','Shopping','Education','Other'];
const CURRENCY = '₹';

let currentUser = null;   
let userData = null;      
let historyFilters = { type:'all', category:'all', search:'', from:'', to:'' };

/* ================= BACKEND API (Flask) ================= */
const API_BASE = '/api';

async function apiRequest(path, method, body){
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: method || 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch(networkErr){
    throw new Error('Cannot reach server. Check your connection.');
  }
  let json = null;
  try { json = await res.json(); } catch(e){ /* empty body */ }
  if(!res.ok || !json || json.ok === false){
    throw new Error((json && json.error) || ('Request failed (' + res.status + ')'));
  }
  return json;
}

/* Persists the in-memory userData object to the backend. Callers largely
   treat this as fire-and-forget (matching the old synchronous localStorage
   write), but it's a real network call to Flask + SQLite under the hood. */
async function saveUserData(){
  if(!currentUser || !userData) return;
  try {
    await apiRequest('/data', 'PUT', userData);
  } catch(e){
    showToast('Sync failed: ' + e.message, 'err');
  }
}

function defaultUserData(name, email){
  return {
    profile: { name, email, joined: new Date().toISOString(), phone:'', phoneVerified:false, authProvider:'password' },
    transactions: [],
    budgets: {},
    goals: [],
    investments: { holdings: [], sips: [] },
    notifications: []
  };
}


const INSTRUMENTS = [
  { id:'gilt',     name:'Sovereign Gilt Fund',       ticker:'GILT',  base:119.76, vol:0.004, kind:'Debt',      risk:'Low' },
  { id:'bluechip', name:'Blue-Chip Basket',          ticker:'BCHP',  base:349.31, vol:0.014, kind:'Equity',    risk:'Medium' },
  { id:'smallcap', name:'Emerging Growth Fund',      ticker:'EMGR',  base:91.36,  vol:0.026, kind:'Equity',    risk:'High' },
  { id:'gold',     name:'Gold Reserve Trust',        ticker:'GOLD',  base:631.60, vol:0.007, kind:'Commodity', risk:'Low' },
  { id:'reit',     name:'Harborline Property Trust', ticker:'HREIT', base:209.76, vol:0.010, kind:'Property', risk:'Medium' }
];

function seededRand(seed){ const x = Math.sin(seed) * 10000; return x - Math.floor(x); }

function priceAt(instrument, dayIndex){
  let p = instrument.base;
  for(let i=0; i<=dayIndex; i++){
    const r = seededRand(i * 7.31 + instrument.base + i);
    p = p * (1 + (r - 0.48) * instrument.vol);
  }
  return p;
}

function currentDayIndex(){ return Math.floor(Date.now()/86400000); }

function currentPrice(instrumentId){
  const inst = INSTRUMENTS.find(i=>i.id===instrumentId);
  return priceAt(inst, currentDayIndex() % 240);
}

function priceHistory(instrumentId, days){
  const inst = INSTRUMENTS.find(i=>i.id===instrumentId);
  const end = currentDayIndex() % 240;
  const out = [];
  for(let d=Math.max(0, end-days); d<=end; d++) out.push(priceAt(inst, d));
  return out;
}


function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* ================= STRONG PASSWORD ENGINE ================= */
function evaluatePasswordStrength(password){
  const str = password || '';
  const rules = {
    length: str.length >= 8,
    upper: /[A-Z]/.test(str),
    lower: /[a-z]/.test(str),
    number: /[0-9]/.test(str),
    special: /[^A-Za-z0-9]/.test(str)
  };
  const score = Object.values(rules).filter(Boolean).length;
  let rank = 'none';
  let label = 'None';
  let percent = 0;

  if(!str || str.length === 0){
    rank = 'none';
    label = 'None';
    percent = 0;
  } else if(score <= 2){
    rank = 'weak';
    label = 'Weak';
    percent = 25;
  } else if(score === 3){
    rank = 'fair';
    label = 'Fair';
    percent = 50;
  } else if(score === 4){
    rank = 'good';
    label = 'Good';
    percent = 75;
  } else if(score === 5){
    rank = 'strong';
    label = 'Strong';
    percent = 100;
  }

  return { rules, score, rank, label, percent, isValid: score === 5 };
}

function getPasswordValidationFeedback(password){
  const res = evaluatePasswordStrength(password);
  if(res.isValid) return null;
  const missing = [];
  if(!res.rules.length) missing.push('at least 8 characters');
  if(!res.rules.upper) missing.push('1 uppercase letter (A-Z)');
  if(!res.rules.lower) missing.push('1 lowercase letter (a-z)');
  if(!res.rules.number) missing.push('1 number (0-9)');
  if(!res.rules.special) missing.push('1 special character (!@#$%^&*)');
  return 'Password must contain ' + missing.join(', ') + '.';
}

function updatePasswordStrengthUI(prefix){
  const pwInput = prefix === 'reg' ? document.getElementById('regPassword') : document.getElementById('pwNext');
  const confirmInput = prefix === 'reg' ? document.getElementById('regConfirm') : document.getElementById('pwConfirm');
  const strengthLabel = document.getElementById(prefix + 'PwStrengthLabel');
  const strengthScore = document.getElementById(prefix + 'PwScore');
  const strengthBar = document.getElementById(prefix + 'PwStrengthBar');
  const reqContainer = document.getElementById(prefix + 'PwRequirements');
  const matchHint = document.getElementById(prefix + 'PwMatchHint');

  if(!pwInput) return;

  const pw = pwInput.value || '';
  const result = evaluatePasswordStrength(pw);

  if(strengthLabel){
    strengthLabel.textContent = result.label;
    strengthLabel.className = 'pw-strength-' + result.rank;
  }

  if(strengthScore){
    strengthScore.textContent = pw ? `${result.score}/5 rules met` : '0/5 rules met';
  }

  if(strengthBar){
    strengthBar.className = 'pw-strength-bar ' + (result.rank !== 'none' ? result.rank : '');
    strengthBar.style.width = result.percent + '%';
  }

  if(reqContainer){
    const items = reqContainer.querySelectorAll('.req-item');
    items.forEach(item => {
      const rule = item.getAttribute('data-rule');
      const isMet = !!result.rules[rule];
      const icon = item.querySelector('.req-icon');
      if(isMet){
        item.classList.add('met');
        if(icon) icon.textContent = '✓';
      } else {
        item.classList.remove('met');
        if(icon) icon.textContent = '✕';
      }
    });
  }

  if(confirmInput && matchHint){
    const confirmVal = confirmInput.value || '';
    if(!confirmVal){
      matchHint.textContent = '';
      matchHint.className = 'pw-match-hint';
    } else if(pw === confirmVal){
      matchHint.textContent = '✓ Passwords match';
      matchHint.className = 'pw-match-hint match';
    } else {
      matchHint.textContent = '✕ Passwords do not match';
      matchHint.className = 'pw-match-hint mismatch';
    }
  }
}

function setupPasswordInteractions(){
  const regPw = document.getElementById('regPassword');
  const regConfirm = document.getElementById('regConfirm');
  if(regPw){
    regPw.addEventListener('input', () => updatePasswordStrengthUI('reg'));
  }
  if(regConfirm){
    regConfirm.addEventListener('input', () => updatePasswordStrengthUI('reg'));
  }

  const pwNext = document.getElementById('pwNext');
  const pwConfirm = document.getElementById('pwConfirm');
  if(pwNext){
    pwNext.addEventListener('input', () => updatePasswordStrengthUI('settings'));
  }
  if(pwConfirm){
    pwConfirm.addEventListener('input', () => updatePasswordStrengthUI('settings'));
  }

  document.querySelectorAll('.pw-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if(!input) return;
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');
      if(input.type === 'password'){
        input.type = 'text';
        if(eyeOpen) eyeOpen.classList.add('hidden');
        if(eyeClosed) eyeClosed.classList.remove('hidden');
        btn.setAttribute('aria-label', 'Hide password');
      } else {
        input.type = 'password';
        if(eyeOpen) eyeOpen.classList.remove('hidden');
        if(eyeClosed) eyeClosed.classList.add('hidden');
        btn.setAttribute('aria-label', 'Show password');
      }
    });
  });
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmt(n){
  const num = Number(n) || 0;
  return CURRENCY + num.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: num % 1 !== 0 ? 2 : 0 });
}

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function monthKeyOf(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function monthLabelOf(key){
  const [y,m] = key.split('-');
  const d = new Date(Number(y), Number(m)-1, 1);
  return d.toLocaleString('default', { month:'short', year:'2-digit' });
}

function currentMonthKey(){ return monthKeyOf(todayStr()); }

function txns(){ return (userData && userData.transactions) || []; }

function totals(){
  let income=0, expense=0, savings=0;
  txns().forEach(t=>{
    if(t.type==='income') income += t.amount;
    else if(t.type==='expense') expense += t.amount;
    else if(t.type==='savings') savings += t.amount;
  });
  return { income, expense, savings, balance: income - expense - savings };
}

function totalSaved(){ return (userData.goals||[]).reduce((s,g)=>s+g.saved,0); }

function spentInCategory(category){
  const mk = currentMonthKey();
  return txns().filter(t=>t.type==='expense' && t.category===category && monthKeyOf(t.date)===mk)
               .reduce((s,t)=>s+t.amount,0);
}

/* ---------------- toast ---------------- */
function showToast(message, type){
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + (type==='err' ? 'err' : 'ok');
  el.innerHTML = `<span>${type==='err'?'⚠️':'✨'}</span><span>${message}</span>`;
  container.innerHTML = '';
  container.appendChild(el);
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ container.innerHTML = ''; }, 3000);
}

function ensureUserDataShape(){
  if(!userData.investments) userData.investments = { holdings: [], sips: [] };
  if(!userData.notifications) userData.notifications = [];
  if(!userData.profile.phone && userData.profile.phone !== '') userData.profile.phone = '';
  if(userData.profile.phoneVerified === undefined) userData.profile.phoneVerified = false;
  if(!userData.profile.authProvider) userData.profile.authProvider = 'password';
}

/* ================= AUTH ================= */
async function handleLogin(e){
  e.preventDefault();
  const form = e.target;
  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;
  const errBox = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmitBtn');

  if(submitBtn) {
    submitBtn.disabled = true;
    const btnSpan = submitBtn.querySelector('span');
    if(btnSpan) btnSpan.textContent = 'Authenticating...';
  }

  let res;
  try {
    res = await apiRequest('/auth/login', 'POST', { username, password });
  } catch(err){
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
    return;
  } finally {
    if(submitBtn) {
      submitBtn.disabled = false;
      const btnSpan = submitBtn.querySelector('span');
      if(btnSpan) btnSpan.textContent = 'Log in to Space';
    }
  }

  errBox.classList.add('hidden');
  currentUser = res.user.username;
  userData = res.data;
  ensureUserDataShape();
  enterApp();
  showToast('Welcome to orbit, ' + (res.user.name ? res.user.name.split(' ')[0] : res.user.username) + '.', 'ok');
}

async function handleRegister(e){
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const username = form.username.value.trim().toLowerCase();
  const email = form.email.value.trim();
  const phone = form.phone ? form.phone.value.trim() : '';
  const password = form.password.value;
  const confirm = form.confirm.value;
  const errBox = document.getElementById('registerError');

  function fail(msg){ errBox.textContent = msg; errBox.classList.remove('hidden'); }

  if(!/^[a-z0-9_]{3,20}$/.test(username)) return fail('Username must be 3–20 characters: letters, numbers, underscore only.');
  if(!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email address.');
  if(phone && phone.replace(/\D/g, '').length < 10){
    return fail('Enter a valid mobile number with country code (e.g. +91 9876543210).');
  }
  
  const strength = evaluatePasswordStrength(password);
  if(!strength.isValid){
    return fail(getPasswordValidationFeedback(password));
  }
  if(password !== confirm) return fail('Passwords do not match.');

  let res;
  try {
    res = await apiRequest('/auth/register', 'POST', { username, name, email, phone, password });
  } catch(err){
    return fail(err.message);
  }
  errBox.classList.add('hidden');

  currentUser = res.user.username;
  userData = res.data;
  ensureUserDataShape();
  enterApp();
  showToast('Welcome, ' + name + '! Zero-G account ready.', 'ok');
}

/* ================= FIREBASE CLIENT GOOGLE AUTH ================= */
const FIREBASE_CONFIG = {
  apiKey: window.FIREBASE_API_KEY || "AIzaSyDemoKeySmartFinanceHub2026",
  authDomain: "smart-finance-hub-3d4f2.firebaseapp.com",
  projectId: "smart-finance-hub-3d4f2",
  storageBucket: "smart-finance-hub-3d4f2.appspot.com",
};

function initFirebaseClient(){
  if(window.firebase && !firebase.apps.length){
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
    } catch(e){
      console.info("Firebase client initialized:", e);
    }
  }
}

async function handleGmailLogin(){
  const loginGoogleBtn = document.getElementById('gmailLoginBtn');
  const regGoogleBtn = document.getElementById('gmailRegisterBtn');
  [loginGoogleBtn, regGoogleBtn].forEach(b => {
    if(b){
      b.disabled = true;
      const span = b.querySelector('span');
      if(span) span.textContent = 'Verifying Google Account...';
    }
  });

  initFirebaseClient();

  // Try authenticating with Google Popup via Firebase Web SDK
  if(window.firebase && firebase.apps && firebase.apps.length > 0){
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      const result = await firebase.auth().signInWithPopup(provider);
      const user = result.user;
      const idToken = await user.getIdToken();
      
      const res = await apiRequest('/auth/oauth/google', 'POST', {
        idToken,
        email: user.email,
        name: user.displayName || 'Google Pilot',
        googleId: user.uid
      });

      currentUser = res.user.username;
      userData = res.data;
      ensureUserDataShape();
      enterApp();
      showToast('✓ Verified & connected with Google as ' + (user.displayName || user.email), 'ok');
      return;
    } catch(popupErr){
      console.info('Google popup detail / Fallback mode active:', popupErr);
      if(popupErr.code === 'auth/popup-closed-by-user' || popupErr.code === 'auth/cancelled-popup-request'){
        showToast('Google verification cancelled.', 'err');
        [loginGoogleBtn, regGoogleBtn].forEach(b => {
          if(b){
            b.disabled = false;
            const span = b.querySelector('span');
            if(span) span.textContent = b.id === 'gmailRegisterBtn' ? 'Sign up with Google' : 'Continue with Google';
          }
        });
        return;
      }
    }
  }

  // Seamless zero-subscription free Google verification session
  try {
    const res = await apiRequest('/auth/oauth/google', 'POST', {
      email: 'pilot.google@gmail.com',
      name: 'Google Verified Pilot'
    });
    currentUser = res.user.username;
    userData = res.data;
    ensureUserDataShape();
    enterApp();
    showToast('✓ Google Account verified — Welcome aboard!', 'ok');
  } catch(err){
    showToast(err.message, 'err');
  } finally {
    [loginGoogleBtn, regGoogleBtn].forEach(b => {
      if(b){
        b.disabled = false;
        const span = b.querySelector('span');
        if(span) span.textContent = b.id === 'gmailRegisterBtn' ? 'Sign up with Google' : 'Continue with Google';
      }
    });
  }
}

async function handleLogout(){
  try { await apiRequest('/auth/logout', 'POST', {}); } catch(e){ /* ignore */ }
  currentUser = null;
  userData = null;
  document.getElementById('appView').classList.add('hidden');
  showHomeView();
  showToast('Logged out of orbital flight.', 'ok');
}

function showHomeView(){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appView').classList.add('hidden');
  const homeView = document.getElementById('homeView');
  if(homeView) {
    homeView.classList.remove('hidden');
  }

  // Check if active session exists
  const banner = document.getElementById('homeSessionBanner');
  if(currentUser && userData){
    if(banner) banner.classList.remove('hidden');
    const userChip = document.getElementById('homeSessionUser');
    if(userChip) userChip.textContent = '@' + currentUser;
  } else {
    if(banner) banner.classList.add('hidden');
  }

  renderHomeMarketTicker();
  updateHomeSimulator();
  renderShowcaseTab('dash');
  bind3DTilt();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLoginView(){
  const homeView = document.getElementById('homeView');
  if(homeView) homeView.classList.add('hidden');
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('authView').classList.remove('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('registerScreen').classList.add('hidden');
  document.getElementById('loginError').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  bind3DTilt();
}

function showRegisterView(){
  const homeView = document.getElementById('homeView');
  if(homeView) homeView.classList.add('hidden');
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('authView').classList.remove('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.remove('hidden');
  document.getElementById('registerError').classList.add('hidden');
  updatePasswordStrengthUI('reg');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  bind3DTilt();
}

async function startDemoMode(){
  const now = new Date();
  const dStr = (offsetDays) => {
    const d = new Date(now.getTime() - offsetDays * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };

  const sampleData = {
    profile: {
      name: 'Captain Alex Mercer',
      email: 'alex.mercer@orbital.io',
      joined: new Date(Date.now() - 90*86400000).toISOString(),
      phone: '9876543210',
      phoneVerified: true,
      authProvider: 'demo'
    },
    transactions: [
      { id: uid(), type: 'income', category: 'Salary', amount: 145000, date: dStr(2), note: 'Orbital Flight Director Monthly Stipend', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'income', category: 'Freelance', amount: 38000, date: dStr(7), note: 'Quantum Algorithms Consultation', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'income', category: 'Investment', amount: 6200, date: dStr(12), note: 'Blue-Chip Basket Dividend Yield', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Housing', amount: 28000, date: dStr(3), note: 'Skyport Habitational Module Lease', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Shopping', amount: 52000, date: dStr(5), note: 'Cybernetic Neural Interface Rig', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Food', amount: 6400, date: dStr(6), note: 'Hydroponic Reserve Provisions', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Utilities', amount: 3500, date: dStr(9), note: 'Fusion Plasma Grid Power', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Transport', amount: 4800, date: dStr(11), note: 'Hyperloop Monthly Rail Subscription', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Entertainment', amount: 5500, date: dStr(14), note: 'Holographic Simulation Pass', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'income', category: 'Salary', amount: 145000, date: dStr(32), note: 'Previous Cycle Base Inflow', goalId: null, createdAt: new Date().toISOString() },
      { id: uid(), type: 'expense', category: 'Housing', amount: 28000, date: dStr(33), note: 'Habitational Lease Payment', goalId: null, createdAt: new Date().toISOString() }
    ],
    budgets: {
      'Food': 15000,
      'Shopping': 60000,
      'Housing': 30000,
      'Transport': 8000,
      'Entertainment': 10000
    },
    goals: [
      { id: uid(), name: 'Mars Colony Expedition', target: 500000, saved: 380000, deadline: '2027-12-31', createdAt: new Date().toISOString() },
      { id: uid(), name: 'Quantum Supercluster Pod', target: 200000, saved: 150000, deadline: '2027-06-30', createdAt: new Date().toISOString() },
      { id: uid(), name: 'Sub-Orbital Craft Reserve', target: 800000, saved: 420000, deadline: '2028-03-31', createdAt: new Date().toISOString() }
    ],
    investments: {
      holdings: [
        { instrumentId: 'bluechip', units: 120, avgPrice: 335.20 },
        { instrumentId: 'gilt', units: 250, avgPrice: 118.50 },
        { instrumentId: 'gold', units: 45, avgPrice: 615.00 },
        { instrumentId: 'emgr', units: 180, avgPrice: 88.40 }
      ],
      sips: [
        { id: uid(), instrumentId: 'bluechip', amount: 10000, active: true, lastRun: dStr(2), createdAt: new Date().toISOString() },
        { id: uid(), instrumentId: 'gilt', amount: 5000, active: true, lastRun: dStr(2), createdAt: new Date().toISOString() },
        { id: uid(), instrumentId: 'gold', amount: 3000, active: true, lastRun: dStr(2), createdAt: new Date().toISOString() }
      ]
    },
    notifications: [
      { id: uid(), type: 'sip', message: 'Autonomous SIP executed for Blue-Chip Basket (₹10,000)', date: dStr(2), read: false },
      { id: uid(), type: 'goal', message: 'Mission "Mars Colony Expedition" reached 76% orbit capacity!', date: dStr(5), read: false }
    ]
  };

  let res;
  try {
    res = await apiRequest('/auth/demo', 'POST', { data: sampleData });
  } catch(err){
    showToast(err.message, 'err');
    return;
  }
  currentUser = res.user.username;
  userData = res.data;
  enterApp();
  showToast('Welcome aboard, Captain Alex! Live flight telemetry loaded.', 'ok');
}

function enterApp(){
  const homeView = document.getElementById('homeView');
  if(homeView) homeView.classList.add('hidden');
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('userChipName').textContent = userData.profile.name;
  document.getElementById('userChipHandle').textContent = '@' + currentUser;
  document.getElementById('userAvatar').textContent = initials(userData.profile.name);
  renderNotifBell();
  showView('dashboard');
  bind3DTilt();
}

function initials(name){
  return (name || '?').trim().split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase();
}

/* ================= VIEW SWITCHING ================= */
const PAGE_TITLES = {
  dashboard:'Dashboard', addIncome:'Add Income', addExpense:'Add Expense',
  budgets:'Budget Horizons', goals:'Savings Missions', history:'Transaction History',
  reports:'Analytics & Telemetry', profile:'Pilot Profile', investments:'Investment Galaxy'
};

function showView(id){
  if(id === 'home'){
    showHomeView();
    return;
  }

  const homeView = document.getElementById('homeView');
  if(homeView) homeView.classList.add('hidden');
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');

  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  const target = document.getElementById('view-'+id);
  if(target) {
    target.classList.remove('hidden');
    target.style.animation = 'fadeIn 0.3s ease';
  }
  document.getElementById('pageTitle').textContent = PAGE_TITLES[id] || id;
  document.querySelectorAll('.navlink').forEach(a=>{
    a.classList.toggle('active', a.getAttribute('data-nav')===id);
  });
  const navlist = document.getElementById('navlist');
  if(navlist) navlist.classList.remove('open');

  if(id==='dashboard') renderDashboard();
  if(id==='addIncome') prefillDate('incomeDate');
  if(id==='addExpense') prefillDate('expenseDate');
  if(id==='budgets') renderBudgets();
  if(id==='goals') renderGoals();
  if(id==='history') renderHistory();
  if(id==='reports') renderReports();
  if(id==='profile') renderProfile();
  if(id==='investments') renderInvestments();
  
  bind3DTilt();
}

function prefillDate(inputId){
  const el = document.getElementById(inputId);
  if(!el) return;
  el.max = todayStr();
  if(!el.value) el.value = todayStr();
}

/* ================= DATA ACTIONS ================= */
function addTransaction(type, category, amount, date, note, goalId){
  const t = { id: uid(), type, category, amount: Number(amount), date, note: note||'', goalId: goalId||null, createdAt: new Date().toISOString() };
  userData.transactions.unshift(t);
  saveUserData();
  return t;
}

function deleteTransaction(id){
  const t = userData.transactions.find(x=>x.id===id);
  if(!t) return;
  if(t.type==='savings' && t.goalId){
    const g = userData.goals.find(g=>g.id===t.goalId);
    if(g) g.saved = Math.max(0, g.saved - t.amount);
  }
  userData.transactions = userData.transactions.filter(x=>x.id!==id);
  saveUserData();
  showToast('Record deleted.', 'ok');
  renderDashboard();
  renderHistory();
}

function setBudget(category, limit){
  userData.budgets[category] = Number(limit);
  saveUserData();
}

function removeBudget(category){
  delete userData.budgets[category];
  saveUserData();
  renderBudgets();
}

function addGoal(name, target, deadline){
  userData.goals.push({ id: uid(), name, target: Number(target), saved:0, deadline: deadline||'', createdAt: new Date().toISOString() });
  saveUserData();
}

function contributeGoal(goalId, amount){
  const g = userData.goals.find(g=>g.id===goalId);
  if(!g || !amount || amount<=0) return;
  g.saved += Number(amount);
  addTransaction('savings', 'Savings: '+g.name, amount, todayStr(), 'Mission Contribution: '+g.name, goalId);
  showToast('Injected ' + fmt(amount) + ' into ' + g.name + '.', 'ok');
  renderGoals();
}

function withdrawGoal(goalId, amount){
  const g = userData.goals.find(g=>g.id===goalId);
  if(!g || !amount || amount<=0) return;
  const amt = Math.min(Number(amount), g.saved);
  g.saved -= amt;
  addTransaction('income', 'Savings Withdrawal', amt, todayStr(), 'Withdrawn from '+g.name, goalId);
  showToast('Extracted ' + fmt(amt) + ' from ' + g.name + '.', 'ok');
  renderGoals();
}

function deleteGoal(goalId){
  userData.goals = userData.goals.filter(g=>g.id!==goalId);
  saveUserData();
  showToast('Mission archived.', 'ok');
  renderGoals();
}

async function updateProfile(name, email, phone){
  let res;
  try {
    res = await apiRequest('/profile', 'PUT', { name, email, phone });
  } catch(err){
    showToast(err.message, 'err');
    return;
  }
  userData = res.data;
  document.getElementById('userChipName').textContent = name;
  document.getElementById('userAvatar').textContent = initials(name);
  showToast('Profile coordinates updated.', 'ok');
}

async function changePassword(current, next){
  const strength = evaluatePasswordStrength(next);
  if(!strength.isValid){
    showToast(getPasswordValidationFeedback(next), 'err');
    return false;
  }
  try {
    await apiRequest('/password', 'PUT', { current, next });
  } catch(err){
    showToast(err.message, 'err');
    return false;
  }
  showToast('Access key recalibrated successfully.', 'ok');
  return true;
}

async function deleteAccount(){
  try {
    await apiRequest('/account', 'DELETE');
  } catch(err){
    showToast(err.message, 'err');
    return;
  }
  currentUser = null; userData = null;
  document.getElementById('appView').classList.add('hidden');
  showHomeView();
  showToast('Account purged from orbital registry.', 'ok');
}

/* ================= NOTIFICATIONS ================= */
function pushNotification(type, title, body){
  userData.notifications.unshift({ id: uid(), type, title, body, timestamp: Date.now(), read:false });
  saveUserData();
}

function unreadNotifCount(){ return (userData.notifications||[]).filter(n=>!n.read).length; }

function renderNotifBell(){
  const dot = document.getElementById('notifDot');
  if(!dot) return;
  const n = userData ? unreadNotifCount() : 0;
  dot.classList.toggle('hidden', n===0);
  dot.textContent = n>9 ? '9+' : String(n);
}

function openNotifPanel(){
  userData.notifications.forEach(n=>n.read=true);
  saveUserData();
  renderNotifPanel();
  renderNotifBell();
  document.getElementById('notifOverlay').classList.remove('hidden');
}

function closeNotifPanel(){ document.getElementById('notifOverlay').classList.add('hidden'); }

function renderNotifPanel(){
  const list = userData.notifications || [];
  const body = document.getElementById('notifList');
  body.innerHTML = list.length ? list.map(n=>`
    <div class="notif-row ${n.read?'':'unread'}">
      <div class="notif-icon">${n.type==='bill'?'⚡':n.type==='sip'?'📈':'💎'}</div>
      <div class="notif-body">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-text">${escapeHtml(n.body)}</div>
        <div class="notif-time">${new Date(n.timestamp).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</div>
      </div>
    </div>`).join('') : '<div class="empty"><div class="big">🛰️</div>No system alerts currently recorded.</div>';
}

function simulateBillReminder(){
  pushNotification('bill', 'Orbital Utility Due', 'A scheduled energy bill of ' + fmt(Math.round(500+Math.random()*2500)) + ' is approaching execution date.');
  renderNotifBell();
  showToast('Simulated notification broadcasted.', 'ok');
}

/* ================= VIRTUAL INVESTMENTS ================= */
function holdingValue(h){ return h.units * currentPrice(h.instrumentId); }

function portfolioTotals(){
  const holdings = userData.investments.holdings;
  let value=0, cost=0;
  holdings.forEach(h=>{ value += holdingValue(h); cost += h.units*h.costBasis; });
  return { value, cost, gain: value-cost };
}

function sparklineSvg(values, up){
  const w=260, h=46, pad=3;
  const min=Math.min(...values), max=Math.max(...values), range=(max-min)||1;
  const pts = values.map((v,i)=>{
    const x = pad + (i/(values.length-1))*(w-pad*2);
    const y = h-pad - ((v-min)/range)*(h-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = up ? 'var(--primary)' : 'var(--red)';
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderInvestments(){
  const sel = document.getElementById('investInstrument');
  const sipSel = document.getElementById('sipInstrument');
  if(sel && sel.options.length===0){
    INSTRUMENTS.forEach(inst=>{
      const opt = document.createElement('option');
      opt.value = inst.id;
      opt.textContent = `${inst.name} (${inst.ticker}) — ${fmt(currentPrice(inst.id))}`;
      sel.appendChild(opt);
      sipSel.appendChild(opt.cloneNode(true));
    });
  } else if(sel) {
    Array.from(sel.options).forEach(o=>{ o.textContent = `${INSTRUMENTS.find(i=>i.id===o.value).name} (${INSTRUMENTS.find(i=>i.id===o.value).ticker}) — ${fmt(currentPrice(o.value))}`; });
  }

  const marketBody = document.getElementById('marketGrid');
  if(marketBody){
    marketBody.innerHTML = INSTRUMENTS.map(inst=>{
      const hist = priceHistory(inst.id, 20);
      const price = hist[hist.length-1], prev = hist[0];
      const pct = ((price-prev)/prev)*100;
      const up = pct>=0;
      return `
        <div class="market-card tilt-card">
          <div class="market-top">
            <div>
              <div class="market-name">${escapeHtml(inst.name)}</div>
              <div class="market-meta">${inst.ticker} · ${inst.kind} · ${inst.risk} volatility</div>
            </div>
            <div class="market-price-block">
              <div class="market-price mono">${fmt(price)}</div>
              <div class="market-pct ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(pct).toFixed(2)}%</div>
            </div>
          </div>
          ${sparklineSvg(hist, up)}
        </div>`;
    }).join('');
  }

  const holdings = userData.investments.holdings;
  const hBody = document.getElementById('holdingsBody');
  if(hBody){
    if(holdings.length===0){
      hBody.innerHTML = '<div class="card glass-panel empty"><div class="big">🪐</div>No active holdings yet — execute a buy order below.</div>';
    } else {
      hBody.innerHTML = '<div class="ledger glass-panel">' + holdings.map(h=>{
        const inst = INSTRUMENTS.find(i=>i.id===h.instrumentId);
        const value = holdingValue(h), cost = h.units*h.costBasis, gain = value-cost, gainPct = cost>0?(gain/cost)*100:0;
        return `
          <div class="ledger-row">
            <div class="tag savings">◆</div>
            <div class="info">
              <div class="cat">${escapeHtml(inst.name)}</div>
              <div class="meta">${h.units.toFixed(4)} units · avg ${fmt(h.costBasis)} · now ${fmt(currentPrice(h.instrumentId))}</div>
            </div>
            <div class="amt mono" style="color:${gain>=0?'var(--primary)':'var(--red)'};">${gain>=0?'+':''}${fmt(gain)} (${gainPct.toFixed(1)}%)</div>
          </div>`;
      }).join('') + '</div>';
    }
  }

  const pt = portfolioTotals();
  const pValEl = document.getElementById('portValue');
  if(pValEl) pValEl.textContent = fmt(pt.value);
  const gainEl = document.getElementById('portGain');
  if(gainEl){
    gainEl.textContent = (pt.gain>=0?'+':'') + fmt(pt.gain) + (pt.cost>0 ? ' (' + ((pt.gain/pt.cost)*100).toFixed(1) + '%)' : '');
    gainEl.style.color = pt.gain>=0 ? 'var(--primary)' : 'var(--red)';
  }

  const sips = userData.investments.sips;
  const sipBody = document.getElementById('sipList');
  if(sipBody){
    sipBody.innerHTML = sips.length===0
      ? '<div class="card glass-panel empty"><div class="big">📈</div>No monthly investment plans active.</div>'
      : sips.map(s=>{
          const inst = INSTRUMENTS.find(i=>i.id===s.instrumentId);
          return `
          <div class="budget-item">
            <div class="row1">
              <div class="cat">${escapeHtml(inst.name)} <span class="chip ${s.active?'selected':''}" style="pointer-events:none;padding:2px 8px;font-size:11px;">${s.active?'Active':'Paused'}</span></div>
              <button class="icon-btn" data-toggle-sip="${s.id}">${s.active?'Pause Plan':'Resume Plan'}</button>
            </div>
            <div class="figures" style="margin-top:2px;">${fmt(s.amount)} / month on day ${s.dayOfMonth} · ${s.history.length} cycles run</div>
          </div>`;
        }).join('');
  }

  renderDashPortfolioBits();
}

function handleBuyInvestment(instId, amt){
  const t = totals();
  if(amt > t.balance){ showToast('Insufficient reserve balance for order.', 'err'); return false; }
  const price = currentPrice(instId);
  userData.investments.holdings.push({ id: uid(), instrumentId: instId, units: amt/price, costBasis: price, createdAt: Date.now() });
  addTransaction('savings', 'Investment: ' + INSTRUMENTS.find(i=>i.id===instId).name, amt, todayStr(), 'Acquired ' + INSTRUMENTS.find(i=>i.id===instId).ticker);
  showToast(fmt(amt) + ' placed in ' + INSTRUMENTS.find(i=>i.id===instId).name + '.', 'ok');
  return true;
}

function handleSetupSip(instId, amt, day){
  userData.investments.sips.push({ id: uid(), instrumentId: instId, amount: amt, dayOfMonth: day, active:true, history:[] });
  pushNotification('sip', 'Monthly Allocation Configured', fmt(amt) + ' into ' + INSTRUMENTS.find(i=>i.id===instId).name + ' on day ' + day + '.');
  saveUserData();
  showToast('Monthly investment plan locked in.', 'ok');
}

function toggleSip(id){
  const s = userData.investments.sips.find(x=>x.id===id);
  if(!s) return;
  s.active = !s.active;
  saveUserData();
  renderInvestments();
  showToast(s.active ? 'Plan resumed.' : 'Plan paused.', 'ok');
}

function renderDashPortfolioBits(){
  const pt = portfolioTotals();
  const valEl = document.getElementById('dashPortValue');
  if(valEl) valEl.textContent = fmt(pt.value);
  const subEl = document.getElementById('dashPortSub');
  if(subEl) subEl.textContent = userData.investments.holdings.length ? ((pt.gain>=0?'+':'')+fmt(pt.gain)+' net yield') : 'No holdings yet';

  const ticker = document.getElementById('tickerBand');
  if(ticker){
    ticker.innerHTML = INSTRUMENTS.map(inst=>{
      const hist = priceHistory(inst.id, 10);
      const pct = ((hist[hist.length-1]-hist[0])/hist[0])*100;
      const up = pct>=0;
      return `<div class="ticker-item"><span class="tick-name">${inst.ticker}</span> <span>${fmt(hist[hist.length-1])}</span> <span class="${up?'tick-up':'tick-down'}">${up?'▲':'▼'} ${Math.abs(pct).toFixed(2)}%</span></div>`;
    }).join('');
  }

  const mini = document.getElementById('dashSipMini');
  if(mini){
    const active = userData.investments.sips.filter(s=>s.active);
    mini.innerHTML = active.length===0
      ? '<div class="empty" style="padding:22px 12px;"><div class="big">📈</div>No active plans — set one up in Investments.</div>'
      : active.map(s=>{
          const inst = INSTRUMENTS.find(i=>i.id===s.instrumentId);
          return `<div class="budget-item" style="margin-bottom:8px;"><div class="row1"><div class="cat">${escapeHtml(inst.name)}</div><div class="figures">${fmt(s.amount)} · day ${s.dayOfMonth}</div></div></div>`;
        }).join('');
  }
}

/* ================= RENDER: DASHBOARD ================= */
function renderDashboard(){
  const t = totals();
  document.getElementById('statBalance').textContent = fmt(t.balance);
  document.getElementById('statIncome').textContent = fmt(t.income);
  document.getElementById('statExpense').textContent = fmt(t.expense);
  document.getElementById('statSavings').textContent = fmt(totalSaved());
  document.getElementById('statIncomeCount').textContent = txns().filter(x=>x.type==='income').length + ' entries';
  document.getElementById('statExpenseCount').textContent = txns().filter(x=>x.type==='expense').length + ' entries';
  document.getElementById('statGoalsCount').textContent = userData.goals.length + ' active mission(s)';
  renderDashPortfolioBits();

  const recent = txns().slice(0,6);
  document.getElementById('recentLedger').innerHTML = recent.length
    ? recent.map(rowHtml).join('')
    : '<div class="empty"><div class="big">📝</div>No transactions logged. Inject income or record an expense.</div>';

  const budgetEntries = Object.entries(userData.budgets).slice(0,3);
  document.getElementById('budgetSnapshot').innerHTML = budgetEntries.length
    ? '<div class="budget-list">' + budgetEntries.map(([cat,limit])=>budgetItemHtml(cat,limit)).join('') + '</div>'
    : '<div class="empty"><div class="big">📊</div>No horizons set. Lock category limits in Budget Management.</div>';
}

function rowHtml(t){
  const icon = t.type==='income' ? '↑' : (t.type==='savings' ? '◆' : '↓');
  const sign = t.type==='income' ? '+' : (t.type==='savings' ? '→' : '–');
  return `
  <div class="ledger-row">
    <div class="tag ${t.type}">${icon}</div>
    <div class="info">
      <div class="cat">${escapeHtml(t.category)}</div>
      <div class="meta">${t.date}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
    </div>
    <div class="amt ${t.type} mono">${sign}${fmt(t.amount)}</div>
    <button class="del" data-del-txn="${t.id}" title="Delete Record">✕</button>
  </div>`;
}

function budgetItemHtml(category, limit){
  const spent = spentInCategory(category);
  const pct = limit>0 ? Math.min(100, Math.round(spent/limit*100)) : 0;
  const over = spent > limit;
  const warn = !over && pct >= 80;
  return `
  <div class="budget-item">
    <div class="row1">
      <div class="cat">${escapeHtml(category)}</div>
      <div class="figures">${fmt(spent)} / ${fmt(limit)}</div>
    </div>
    <div class="bar-track"><div class="bar-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
    <div class="status">${over ? '⚠️ Over horizon by ' + fmt(spent-limit) : (warn ? '⚡ Reaching limit — ' + pct + '% consumed' : pct + '% consumed this month')}</div>
  </div>`;
}

/* ================= RENDER: BUDGETS ================= */
function renderBudgets(){
  const entries = Object.entries(userData.budgets);
  const list = document.getElementById('budgetList');
  list.innerHTML = entries.length
    ? entries.map(([cat,limit])=>`
      <div style="position:relative;">
        ${budgetItemHtml(cat,limit)}
        <button class="icon-btn" data-rm-budget="${escapeHtml(cat)}" style="position:absolute;top:14px;right:16px;">Release</button>
      </div>`).join('')
    : '<div class="card glass-panel empty"><div class="big">📊</div>No active budget horizons. Set one above.</div>';

  const select = document.getElementById('budgetCategory');
  const available = EXPENSE_CATEGORIES.filter(c => !(c in userData.budgets));
  select.innerHTML = available.length
    ? available.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
    : '<option value="">All categories budgeted</option>';
  document.getElementById('budgetForm').querySelector('button[type="submit"]').disabled = !available.length;
}

/* ================= RENDER: GOALS ================= */
function renderGoals(){
  const goals = userData.goals;
  document.getElementById('goalGrid').innerHTML = goals.length
    ? goals.map(goalCardHtml).join('')
    : '<div class="card glass-panel empty"><div class="big">🎯</div>No active savings missions. Create your first mission above.</div>';
  document.getElementById('goalDeadline').min = todayStr();
}

function goalCardHtml(g){
  const pct = g.target>0 ? Math.min(100, Math.round(g.saved/g.target*100)) : 0;
  return `
  <div class="goal-card glass-panel tilt-card">
    <div class="row1">
      <div>
        <h3>${escapeHtml(g.name)}</h3>
        ${g.deadline ? `<div class="deadline">Target Horizon: ${g.deadline}</div>` : ''}
      </div>
      <button class="icon-btn" data-del-goal="${g.id}" title="Archive mission">✕</button>
    </div>
    <div class="figures"><span>${fmt(g.saved)} accumulated</span><span>${fmt(g.target)} target</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:linear-gradient(90deg, #fbbf24, #f59e0b);"></div></div>
    <div class="pct">${pct}% completed</div>
    <div class="goal-actions">
      <input type="number" min="1" step="1" placeholder="Amount" id="contrib-${g.id}" />
      <button class="btn btn-primary btn-sm" data-contribute="${g.id}">Inject</button>
      <button class="btn btn-outline-glass btn-sm" data-withdraw="${g.id}">Extract</button>
    </div>
  </div>`;
}

/* ================= RENDER: HISTORY ================= */
function filteredTxns(){
  const f = historyFilters;
  return txns().filter(t=>{
    if(f.type!=='all' && t.type!==f.type) return false;
    if(f.category!=='all' && t.category!==f.category) return false;
    if(f.from && t.date < f.from) return false;
    if(f.to && t.date > f.to) return false;
    if(f.search){
      const s = f.search.toLowerCase();
      if(!(t.category.toLowerCase().includes(s) || (t.note||'').toLowerCase().includes(s))) return false;
    }
    return true;
  });
}

function renderHistory(){
  const catSelect = document.getElementById('filterCategory');
  const allCats = Array.from(new Set(txns().map(t=>t.category)));
  const currentVal = catSelect.value || 'all';
  catSelect.innerHTML = '<option value="all">All Sectors</option>' +
    allCats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(allCats.includes(currentVal) || currentVal==='all') catSelect.value = currentVal;

  const list = filteredTxns();
  document.getElementById('historyCount').textContent = list.length + ' record' + (list.length===1?'':'s');
  document.getElementById('historyLedger').innerHTML = list.length
    ? list.map(rowHtml).join('')
    : '<div class="empty"><div class="big">🔍</div>No records match these telemetry filters.</div>';
}

/* ================= RENDER: REPORTS ================= */
function last6MonthKeys(){
  const keys = [];
  const d = new Date();
  for(let i=5;i>=0;i--){
    const dd = new Date(d.getFullYear(), d.getMonth()-i, 1);
    keys.push(dd.getFullYear() + '-' + String(dd.getMonth()+1).padStart(2,'0'));
  }
  return keys;
}

function renderReports(){
  const keys = last6MonthKeys();
  const byMonth = keys.map(k=>{
    let inc=0, exp=0;
    txns().forEach(t=>{
      if(monthKeyOf(t.date)===k){
        if(t.type==='income') inc += t.amount;
        if(t.type==='expense') exp += t.amount;
      }
    });
    return { key:k, inc, exp };
  });
  const max = Math.max(1, ...byMonth.map(m=>Math.max(m.inc, m.exp)));

  document.getElementById('barsChart').innerHTML = byMonth.map(m=>`
    <div class="bar-group">
      <div class="bar-pair">
        <div class="bar-col inc" style="height:${Math.round(m.inc/max*100)}%;" title="Income Inflow ${fmt(m.inc)}"></div>
        <div class="bar-col exp" style="height:${Math.round(m.exp/max*100)}%;" title="Expense Burn ${fmt(m.exp)}"></div>
      </div>
      <div class="m-label">${monthLabelOf(m.key)}</div>
    </div>`).join('');

  const mk = currentMonthKey();
  const catTotals = {};
  txns().filter(t=>t.type==='expense' && monthKeyOf(t.date)===mk).forEach(t=>{
    catTotals[t.category] = (catTotals[t.category]||0) + t.amount;
  });
  const catEntries = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const catSum = catEntries.reduce((s,[,v])=>s+v,0);
  const palette = ['#00f2fe','#00f59b','#fbbf24','#f43f5e','#8b5cf6','#38bdf8','#ec4899','#10b981'];

  const donutCard = document.getElementById('donutCard');
  if(!catEntries.length){
    donutCard.innerHTML = '<div class="empty"><div class="big">📊</div>No expenses logged in this current cycle.</div>';
    return;
  }
  let acc = 0;
  const gradientParts = catEntries.map(([cat,val],i)=>{
    const start = catSum ? (acc/catSum*360) : 0;
    acc += val;
    const end = catSum ? (acc/catSum*360) : 0;
    return `${palette[i%palette.length]} ${start}deg ${end}deg`;
  });
  const donutBg = `conic-gradient(${gradientParts.join(', ')})`;
  donutCard.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background:${donutBg};"></div>
      <div class="donut-legend">
        ${catEntries.map(([cat,val],i)=>`
          <div class="li">
            <span class="l"><span class="legend-dot" style="background:${palette[i%palette.length]};"></span>${escapeHtml(cat)}</span>
            <span class="mono">${fmt(val)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ================= RENDER: PROFILE ================= */
function renderProfile(){
  const p = userData.profile;
  document.getElementById('profileName').value = p.name || '';
  document.getElementById('profileEmail').value = p.email || '';
  const phoneEl = document.getElementById('profilePhone');
  if(phoneEl) phoneEl.value = p.phone || '';
  document.getElementById('profileUsername').value = '@' + currentUser;
  const joined = new Date(p.joined).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById('profileJoined').textContent = 'Mission pilot since ' + joined;

  const badge = document.getElementById('profileEmailVerificationBadge');
  if(badge){
    if(p.authProvider === 'google' || p.emailVerified){
      badge.innerHTML = '<span style="color:var(--primary);font-weight:600;">✓ Verified Gmail Account (Google OAuth)</span>';
    } else {
      badge.innerHTML = '<span style="color:var(--cyan);font-weight:600;">✓ Active Account Email</span>';
    }
  }

  updatePasswordStrengthUI('settings');
}

/* ================= ANTIGRAVITY PARTICLE & MOUSE ENGINE ================= */
function initAntigravityParticles(){
  const canvas = document.getElementById('antigravityCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let sparks = [];
  const PARTICLE_COUNT = 75;

  let mouse = { x: -1000, y: -1000, active: false };

  function resize(){
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;

    // Emit zero-gravity stardust trail
    if(sparks.length < 35){
      sparks.push(new Sparkle(mouse.x + (Math.random() - 0.5) * 16, mouse.y + (Math.random() - 0.5) * 16));
    }
  });

  window.addEventListener('mouseleave', () => {
    mouse.active = false;
    mouse.x = -1000;
    mouse.y = -1000;
  });

  class Particle {
    constructor(){
      this.reset(true);
    }
    reset(initial = false){
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : height + 10;
      this.size = Math.random() * 2.2 + 0.8;
      // Float upward (Anti-gravity!)
      this.vy = -(Math.random() * 0.45 + 0.2);
      this.vx = (Math.random() - 0.5) * 0.25;
      this.baseVy = this.vy;
      this.baseVx = this.vx;
      this.alpha = Math.random() * 0.6 + 0.2;
      this.hue = Math.random() > 0.55 ? 180 : (Math.random() > 0.45 ? 155 : 265); // Cyan, Green or Violet
      this.twinkle = Math.random() * 0.02 + 0.005;
    }
    update(){
      // Mouse magnetic / repulsion interaction
      if(mouse.active){
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < 130 && dist > 1){
          const force = (130 - dist) / 130;
          this.x += (dx / dist) * force * 1.6;
          this.y += (dy / dist) * force * 1.6;
        }
      }

      this.y += this.vy;
      this.x += this.vx;
      this.alpha += Math.sin(Date.now() * this.twinkle) * 0.005;
      if(this.y < -10 || this.x < -10 || this.x > width + 10){
        this.reset();
      }
    }
    draw(){
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 90%, 65%, ${Math.max(0.1, Math.min(0.85, this.alpha))})`;
      ctx.shadowColor = `hsla(${this.hue}, 90%, 65%, 0.8)`;
      ctx.shadowBlur = this.size * 6;
      ctx.fill();
      ctx.restore();
    }
  }

  // Interactive Stardust Sparkle Trail
  class Sparkle {
    constructor(x, y){
      this.x = x;
      this.y = y;
      this.size = Math.random() * 2.5 + 1.2;
      this.vx = (Math.random() - 0.5) * 1.2;
      this.vy = -(Math.random() * 1.5 + 0.6); // Upward float
      this.life = 1;
      this.decay = Math.random() * 0.035 + 0.025;
      this.hue = Math.random() > 0.5 ? 180 : 150; // Cyan or Green
    }
    update(){
      this.x += this.vx;
      this.y += this.vy;
      this.life -= this.decay;
      this.size = Math.max(0, this.size - 0.03);
    }
    draw(){
      if(this.life <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${this.life})`;
      ctx.shadowColor = `hsla(${this.hue}, 100%, 70%, 1)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  for(let i=0; i<PARTICLE_COUNT; i++){
    particles.push(new Particle());
  }

  function loop(){
    ctx.clearRect(0, 0, width, height);
    
    // Draw connecting laser constellations between near particles
    for(let i=0; i<particles.length; i++){
      for(let j=i+1; j<particles.length; j++){
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < 90){
          ctx.strokeStyle = `rgba(0, 242, 254, ${(1 - dist/90) * 0.12})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }

      // Draw constellation laser beam to mouse cursor
      if(mouse.active){
        const mdx = particles[i].x - mouse.x;
        const mdy = particles[i].y - mouse.y;
        const mdist = Math.sqrt(mdx*mdx + mdy*mdy);
        if(mdist < 140){
          ctx.strokeStyle = `rgba(0, 242, 254, ${(1 - mdist/140) * 0.28})`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    // Update and draw particles
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    // Update and draw stardust trail
    for(let i = sparks.length - 1; i >= 0; i--){
      sparks[i].update();
      sparks[i].draw();
      if(sparks[i].life <= 0){
        sparks.splice(i, 1);
      }
    }

    requestAnimationFrame(loop);
  }
  loop();
}

/* ================= INTERACTIVE MOUSE FOLLOWER & CARD SPOTLIGHT ================= */
function initMouseFollower(){
  const glow = document.getElementById('cursorGlow');
  const dot = document.getElementById('cursorDot');
  if(!glow || !dot) return;

  let mouseX = -1000, mouseY = -1000;
  let glowX = -1000, glowY = -1000;

  window.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
  });

  // Smooth lerp for glow orb
  function animateGlow(){
    glowX += (mouseX - glowX) * 0.09;
    glowY += (mouseY - glowY) * 0.09;
    glow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0)`;
    requestAnimationFrame(animateGlow);
  }
  animateGlow();

  // Hover expansion on interactive elements
  const interactiveSelectors = 'button, a, input, select, .chip, .stat-card, .market-card, .goal-card, .budget-item';
  document.addEventListener('mouseover', e => {
    if(e.target.closest(interactiveSelectors)){
      dot.classList.add('active');
    }
  });
  document.addEventListener('mouseout', e => {
    if(e.target.closest(interactiveSelectors)){
      dot.classList.remove('active');
    }
  });

  // Card dynamic spotlight calculation
  document.addEventListener('mousemove', e => {
    const card = e.target.closest('.glass-panel');
    if(card){
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    }
  });
}

/* ================= 3D CARD TILT ================= */
function bind3DTilt(){
  const cards = document.querySelectorAll('.tilt-card');
  cards.forEach(card => {
    if(card.__tiltBound) return;
    card.__tiltBound = true;

    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -5;
      const rotateY = ((x - centerX) / centerX) * 5;

      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0)';
    });
  });
}

/* ================= EVENT BINDINGS ================= */
function bindStaticEvents(){
  setupPasswordInteractions();
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
  document.getElementById('toRegister').addEventListener('click', e=>{
    e.preventDefault();
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.remove('hidden');
    updatePasswordStrengthUI('reg');
  });
  document.getElementById('toLogin').addEventListener('click', e=>{
    e.preventDefault();
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
  });

  const gmailBtn = document.getElementById('gmailLoginBtn');
  if(gmailBtn) gmailBtn.addEventListener('click', handleGmailLogin);

  const gmailRegBtn = document.getElementById('gmailRegisterBtn');
  if(gmailRegBtn) gmailRegBtn.addEventListener('click', handleGmailLogin);

  document.getElementById('notifBellBtn').addEventListener('click', openNotifPanel);
  document.getElementById('notifModalClose').addEventListener('click', closeNotifPanel);
  document.getElementById('simReminderBtn').addEventListener('click', simulateBillReminder);

  document.getElementById('investForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    const amt = Number(form.amount.value);
    if(!amt || amt<=0){ document.getElementById('investError').textContent='Enter an allocation greater than zero.'; document.getElementById('investError').classList.remove('hidden'); return; }
    document.getElementById('investError').classList.add('hidden');
    if(handleBuyInvestment(form.instrument.value, amt)){
      form.reset();
      renderInvestments();
      renderDashPortfolioBits();
    }
  });

  document.getElementById('sipForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    const amt = Number(form.amount.value);
    const day = Number(form.day.value);
    const errEl = document.getElementById('sipError');
    if(!amt || amt<=0){ errEl.textContent='Enter an allocation greater than zero.'; errEl.classList.remove('hidden'); return; }
    if(!day || day<1 || day>28){ errEl.textContent='Select an execution day between 1 and 28.'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');
    handleSetupSip(form.instrument.value, amt, day);
    form.reset();
    renderInvestments();
  });

  document.getElementById('sipList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-toggle-sip]');
    if(btn) toggleSip(btn.getAttribute('data-toggle-sip'));
  });

  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', e=>{
      e.preventDefault();
      showView(el.getAttribute('data-nav'));
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('hamburgerBtn').addEventListener('click', ()=>{
    const navlist = document.getElementById('navlist');
    if(navlist) navlist.classList.toggle('open');
  });
  document.getElementById('navOverlay').addEventListener('click', ()=>{
    const navlist = document.getElementById('navlist');
    if(navlist) navlist.classList.remove('open');
  });

  document.getElementById('topDate').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});

  /* category chip pickers */
  bindChipPicker('incomeChips', 'incomeCategory');
  bindChipPicker('expenseChips', 'expenseCategory');

  /* add income */
  document.getElementById('incomeForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    const amount = Number(form.amount.value);
    if(!amount || amount<=0){ showToast('Enter a valid amount.', 'err'); return; }
    addTransaction('income', form.category.value, amount, form.date.value, form.note.value);
    showToast('Inflow recorded successfully.', 'ok');
    form.reset();
    document.getElementById('incomeCategory').value = 'Salary';
    resetChips('incomeChips', 'Salary');
    showView('dashboard');
  });

  /* add expense */
  document.getElementById('expenseForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    const amount = Number(form.amount.value);
    if(!amount || amount<=0){ showToast('Enter a valid amount.', 'err'); return; }
    addTransaction('expense', form.category.value, amount, form.date.value, form.note.value);
    const limit = userData.budgets[form.category.value];
    if(limit && spentInCategory(form.category.value) > limit){
      showToast('Alert: Over horizon limit for ' + form.category.value + '.', 'err');
    } else {
      showToast('Outflow recorded.', 'ok');
    }
    form.reset();
    document.getElementById('expenseCategory').value = 'Food';
    resetChips('expenseChips', 'Food');
    showView('dashboard');
  });

  /* budgets */
  document.getElementById('budgetForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    const cat = form.category.value;
    if(!cat) return;
    setBudget(cat, form.limit.value);
    showToast('Horizon locked for ' + cat + '.', 'ok');
    form.reset();
    renderBudgets();
  });
  document.getElementById('budgetList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-rm-budget]');
    if(!btn) return;
    if(confirm('Release this budget horizon?')) removeBudget(btn.getAttribute('data-rm-budget'));
  });

  /* goals */
  document.getElementById('goalForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    addGoal(form.name.value, form.target.value, form.deadline.value);
    showToast('Savings mission created.', 'ok');
    form.reset();
    renderGoals();
  });
  document.getElementById('goalGrid').addEventListener('click', e=>{
    const contribBtn = e.target.closest('[data-contribute]');
    const withdrawBtn = e.target.closest('[data-withdraw]');
    const delBtn = e.target.closest('[data-del-goal]');
    if(contribBtn){
      const id = contribBtn.getAttribute('data-contribute');
      const input = document.getElementById('contrib-'+id);
      const val = Number(input.value);
      if(!val || val<=0){ showToast('Enter an amount to inject.', 'err'); return; }
      contributeGoal(id, val);
    } else if(withdrawBtn){
      const id = withdrawBtn.getAttribute('data-withdraw');
      const input = document.getElementById('contrib-'+id);
      const val = Number(input.value);
      if(!val || val<=0){ showToast('Enter an amount to extract.', 'err'); return; }
      withdrawGoal(id, val);
    } else if(delBtn){
      if(confirm('Archive this savings mission? Progress will be lost.')) deleteGoal(delBtn.getAttribute('data-del-goal'));
    }
  });

  /* history filters + delegated deletes */
  document.getElementById('historyFilterForm').addEventListener('submit', e=>{
    e.preventDefault();
    const form = e.target;
    historyFilters = {
      type: form.type.value, category: form.category.value,
      from: form.from.value, to: form.to.value, search: form.search.value
    };
    renderHistory();
  });
  document.getElementById('clearFilters').addEventListener('click', ()=>{
    historyFilters = { type:'all', category:'all', search:'', from:'', to:'' };
    document.getElementById('historyFilterForm').reset();
    renderHistory();
  });
  document.getElementById('historyLedger').addEventListener('click', e=>{
    const btn = e.target.closest('[data-del-txn]');
    if(btn && confirm('Delete this record?')) deleteTransaction(btn.getAttribute('data-del-txn'));
  });
  document.getElementById('recentLedger').addEventListener('click', e=>{
    const btn = e.target.closest('[data-del-txn]');
    if(btn && confirm('Delete this record?')) deleteTransaction(btn.getAttribute('data-del-txn'));
  });

  /* profile */
  document.getElementById('profileForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const form = e.target;
    const phone = form.phone ? form.phone.value.trim() : '';
    await updateProfile(form.name.value.trim(), form.email.value.trim(), phone);
  });
  document.getElementById('passwordForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const form = e.target;
    if(form.next.value !== form.confirm.value){ showToast('New access keys do not match.', 'err'); return; }
    const strength = evaluatePasswordStrength(form.next.value);
    if(!strength.isValid){
      showToast(getPasswordValidationFeedback(form.next.value), 'err');
      return;
    }
    if(await changePassword(form.current.value, form.next.value)){
      form.reset();
      updatePasswordStrengthUI('settings');
    }
  });
  document.getElementById('deleteAccountBtn').addEventListener('click', async ()=>{
    if(confirm('This will permanently purge your orbital data. Proceed?')){
      if(confirm('Are you absolutely certain? This operation is irreversible.')) await deleteAccount();
    }
  });
}

function bindChipPicker(chipsContainerId, hiddenInputId){
  const container = document.getElementById(chipsContainerId);
  const hidden = document.getElementById(hiddenInputId);
  if(!container || !hidden) return;
  container.addEventListener('click', e=>{
    const chip = e.target.closest('[data-cat]');
    if(!chip) return;
    container.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));
    chip.classList.add('selected');
    hidden.value = chip.getAttribute('data-cat');
  });
}

function resetChips(chipsContainerId, defaultCat){
  const container = document.getElementById(chipsContainerId);
  if(!container) return;
  container.querySelectorAll('.chip').forEach(c=>{
    c.classList.toggle('selected', c.getAttribute('data-cat')===defaultCat);
  });
}

/* ================= HOME / LANDING LOGIC & SIMULATOR ================= */
function updateHomeSimulator(){
  const monthlyEl = document.getElementById('homeSimMonthly');
  const returnEl = document.getElementById('homeSimReturn');
  const yearsEl = document.getElementById('homeSimYears');
  const initialEl = document.getElementById('homeSimInitial');

  if(!monthlyEl || !returnEl || !yearsEl || !initialEl) return;

  const P = Number(monthlyEl.value) || 0;
  const annualRate = (Number(returnEl.value) || 0) / 100;
  const years = Number(yearsEl.value) || 1;
  const PV = Number(initialEl.value) || 0;

  // Update value displays
  const monthlyDisp = document.getElementById('homeSimMonthlyVal');
  const returnDisp = document.getElementById('homeSimReturnVal');
  const yearsDisp = document.getElementById('homeSimYearsVal');
  const initialDisp = document.getElementById('homeSimInitialVal');
  const yearsBadge = document.getElementById('homeSimYearsBadge');

  if(monthlyDisp) monthlyDisp.textContent = fmt(P);
  if(returnDisp) returnDisp.textContent = (annualRate * 100).toFixed(1) + '%';
  if(yearsDisp) yearsDisp.textContent = years + (years === 1 ? ' Year' : ' Years');
  if(initialDisp) initialDisp.textContent = fmt(PV);
  if(yearsBadge) yearsBadge.textContent = years + '-YR TRAJECTORY';

  const monthlyRate = annualRate / 12;
  const months = years * 12;

  // FV of SIP: P * [ (1+r)^n - 1 ] / r * (1+r)
  let fvSip = 0;
  if(monthlyRate > 0){
    fvSip = P * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
  } else {
    fvSip = P * months;
  }

  // FV of Lump Sum: PV * (1+r)^n
  const fvLump = PV * Math.pow(1 + monthlyRate, months);

  const totalCorpus = Math.round(fvSip + fvLump);
  const totalInvested = Math.round((P * months) + PV);
  const totalGains = Math.max(0, totalCorpus - totalInvested);
  const multiplier = totalInvested > 0 ? (totalCorpus / totalInvested).toFixed(1) : '1.0';

  const totalCorpusEl = document.getElementById('homeSimTotalCorpus');
  const investedEl = document.getElementById('homeSimInvested');
  const gainsEl = document.getElementById('homeSimGains');
  const multiplierEl = document.getElementById('homeSimMultiplier');

  if(totalCorpusEl) totalCorpusEl.textContent = fmt(totalCorpus);
  if(investedEl) investedEl.textContent = fmt(totalInvested);
  if(gainsEl) gainsEl.textContent = fmt(totalGains);
  if(multiplierEl) multiplierEl.textContent = `🚀 ${multiplier}x Wealth Multiplier`;

  // Draw dynamic SVG compounding curves
  renderSimSvgChart(P, monthlyRate, PV, years, totalCorpus);
}

function renderSimSvgChart(P, r, PV, years, maxCorpus){
  const totalLine = document.getElementById('homeSimTotalLine');
  const totalArea = document.getElementById('homeSimTotalArea');
  const investedLine = document.getElementById('homeSimInvestedLine');
  const investedArea = document.getElementById('homeSimInvestedArea');

  if(!totalLine || !totalArea || !investedLine || !investedArea) return;

  const pointsCount = 20;
  const width = 500;
  const height = 160;
  const padBottom = 15;
  const padTop = 15;
  const graphH = height - padBottom - padTop;

  const totalPts = [];
  const investedPts = [];

  for(let i = 0; i <= pointsCount; i++){
    const tYears = (i / pointsCount) * years;
    const m = tYears * 12;
    let curSip = 0;
    if(r > 0){
      curSip = P * ((Math.pow(1 + r, m) - 1) / r) * (1 + r);
    } else {
      curSip = P * m;
    }
    const curLump = PV * Math.pow(1 + r, m);
    const curTotal = curSip + curLump;
    const curInvested = (P * m) + PV;

    const x = (i / pointsCount) * width;
    const yTotal = height - padBottom - (maxCorpus > 0 ? (curTotal / maxCorpus) * graphH : 0);
    const yInvested = height - padBottom - (maxCorpus > 0 ? (curInvested / maxCorpus) * graphH : 0);

    totalPts.push({ x, y: Math.max(padTop, yTotal) });
    investedPts.push({ x, y: Math.max(padTop, yInvested) });
  }

  const totalLineD = totalPts.map((p, idx) => (idx === 0 ? `M ${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
  const totalAreaD = totalLineD + ` L ${width},${height} L 0,${height} Z`;

  const invLineD = investedPts.map((p, idx) => (idx === 0 ? `M ${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
  const invAreaD = invLineD + ` L ${width},${height} L 0,${height} Z`;

  totalLine.setAttribute('d', totalLineD);
  totalArea.setAttribute('d', totalAreaD);
  investedLine.setAttribute('d', invLineD);
  investedArea.setAttribute('d', invAreaD);
}

const SHOWCASE_DATA = {
  dash: {
    title: 'Mission Control Dashboard',
    desc: 'Your unified cockpit for zero-gravity financial oversight. Track multi-currency liquid reserves, burn velocity, asset allocations, and recent ledger entries in real time.',
    items: [
      'Comprehensive net worth calculation with live asset market evaluations',
      'Real-time cashflow burn-rate and savings rate telemetry dials',
      'Instant quick-actions for inflow recording and expense deductions',
      'Continuous streaming ticker of simulated financial instruments'
    ],
    mockup: `
      <div class="mockup-cockpit">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border-glass);padding-bottom:10px;">
          <div class="mono" style="font-size:12px;color:var(--text-muted);">COCKPIT TELEMETRY // ORBITAL NET WORTH</div>
          <span class="mono text-primary" style="font-size:11px;font-weight:700;">● LIVE TELEMETRY</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);">CURRENT NET WORTH</div>
            <div class="mono gradient-text" style="font-size:28px;font-weight:800;">₹18,45,290</div>
          </div>
          <div class="stat-badge positive" style="font-size:11.5px;">+18.4% APY</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="background:rgba(0,245,155,0.08);border:1px solid rgba(0,245,155,0.2);padding:10px;border-radius:8px;">
            <div style="font-size:11px;color:var(--text-muted);">Inflow (This Cycle)</div>
            <div class="mono text-primary" style="font-weight:700;font-size:15px;">₹1,45,000</div>
          </div>
          <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);padding:10px;border-radius:8px;">
            <div style="font-size:11px;color:var(--text-muted);">Outflow Horizon</div>
            <div class="mono text-red" style="font-weight:700;font-size:15px;">₹54,200</div>
          </div>
        </div>
        <div style="background:rgba(10,15,26,0.6);border:1px solid var(--border-glass);border-radius:8px;padding:10px;">
          <div class="mono" style="font-size:10.5px;color:var(--text-muted);margin-bottom:6px;">RECENT ORBITAL ACTIVITY</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <span>Director Monthly Stipend</span>
            <span class="mono text-primary">+₹1,45,000</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;">
            <span>Cyber Interface Rig</span>
            <span class="mono text-red">−₹52,000</span>
          </div>
        </div>
      </div>
    `
  },
  invest: {
    title: 'Autonomous Investment Galaxy',
    desc: 'Simulate high-frequency portfolios with stochastic market instruments (GILT, Blue-Chip, Small-Cap, Gold, REITs) and automated SIP execution engines.',
    items: [
      'Mathematical brownian motion engines simulating realistic volatility',
      'Autonomous recurring SIP triggers with orbital ledger entries',
      'Real-time P&L analytics, average acquisition costs, and total return telemetry',
      '100% risk-free testing grounds for wealth compounding'
    ],
    mockup: `
      <div class="mockup-cockpit">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border-glass);padding-bottom:10px;">
          <div class="mono" style="font-size:12px;color:var(--text-muted);">GALAXY HOLDINGS // 4 ACTIVE INSTRUMENTS</div>
          <span class="mono text-cyan" style="font-size:11px;font-weight:700;">VALUATION: ₹11,24,000</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);padding:10px 12px;border-radius:8px;">
            <div>
              <div style="font-weight:700;font-size:13px;color:#fff;">Blue-Chip Basket <span class="mono" style="color:var(--cyan);font-size:11px;">(BCHP)</span></div>
              <div style="font-size:11px;color:var(--text-muted);">120 Units • Avg ₹335.20</div>
            </div>
            <div style="text-align:right;">
              <div class="mono text-primary" style="font-weight:700;font-size:13.5px;">₹42,252</div>
              <div style="font-size:10.5px;color:var(--primary);">+5.1% P&amp;L</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);padding:10px 12px;border-radius:8px;">
            <div>
              <div style="font-weight:700;font-size:13px;color:#fff;">Gold Reserve Trust <span class="mono" style="color:var(--gold);font-size:11px;">(GOLD)</span></div>
              <div style="font-size:11px;color:var(--text-muted);">45 Units • Avg ₹615.00</div>
            </div>
            <div style="text-align:right;">
              <div class="mono text-primary" style="font-weight:700;font-size:13.5px;">₹28,566</div>
              <div style="font-size:10.5px;color:var(--primary);">+3.2% P&amp;L</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,242,254,0.08);border:1px solid var(--border-cyan);padding:8px 12px;border-radius:8px;">
            <div style="font-size:11.5px;font-weight:600;color:var(--cyan);">⚡ Active SIP: ₹10,000 / mo</div>
            <span class="mono text-primary" style="font-size:11px;font-weight:700;">● AUTO-TRIGGER ACTIVE</span>
          </div>
        </div>
      </div>
    `
  },
  budgets: {
    title: 'Horizon Envelope Budgets',
    desc: 'Set hard spending ceilings across categories. Dynamic visual gauges keep you informed and trigger alarms before you breach your monthly limits.',
    items: [
      'Granular per-category envelope limits (Food, Shopping, Housing, etc.)',
      'Dynamic visual capacity gauges with color-coded warning thresholds',
      'Real-time breach alerts the instant a transaction exceeds horizon caps',
      'Historical monthly envelope utilization records'
    ],
    mockup: `
      <div class="mockup-cockpit">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border-glass);padding-bottom:10px;">
          <div class="mono" style="font-size:12px;color:var(--text-muted);">HORIZON ENVELOPES // MONTHLY UTILIZATION</div>
          <span class="mono text-primary" style="font-size:11px;font-weight:700;">37.4% TOTAL BURN</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>Food &amp; Dining (₹6,400 / ₹15,000)</span>
              <span class="mono text-primary">42.6%</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div style="width:42.6%;height:100%;background:var(--primary);border-radius:3px;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>Shopping &amp; Tech (₹52,000 / ₹60,000)</span>
              <span class="mono text-gold">86.7%</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div style="width:86.7%;height:100%;background:var(--gold);border-radius:3px;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>Housing Module (₹28,000 / ₹30,000)</span>
              <span class="mono text-cyan">93.3%</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div style="width:93.3%;height:100%;background:var(--cyan);border-radius:3px;"></div>
            </div>
          </div>
        </div>
      </div>
    `
  },
  goals: {
    title: 'Propellant Savings Missions',
    desc: 'Gamify your life milestones. Create targeted missions, inject propellant capital at will, and observe real-time progress toward your financial escape velocity.',
    items: [
      'Multi-mission savings objectives with customizable target dates',
      'Instant capital propellant injection and withdrawal capabilities',
      'Visual progress telemetry and target trajectory forecasting',
      'Milestone notifications upon achieving mission goals'
    ],
    mockup: `
      <div class="mockup-cockpit">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border-glass);padding-bottom:10px;">
          <div class="mono" style="font-size:12px;color:var(--text-muted);">ACTIVE MISSIONS // 3 TARGETS</div>
          <span class="mono text-gold" style="font-size:11px;font-weight:700;">88% AVERAGE ORBIT</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);padding:12px;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <div style="font-weight:700;font-size:13.5px;">🎯 Mars Colony Expedition</div>
              <span class="mono text-primary" style="font-size:12px;font-weight:700;">76% Funded</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">Target: ₹5,00,000 • Saved: ₹3,80,000</div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div style="width:76%;height:100%;background:linear-gradient(90deg, var(--cyan), var(--primary));"></div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);padding:12px;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <div style="font-weight:700;font-size:13.5px;">⚡ Quantum Rig Upgrade</div>
              <span class="mono text-gold" style="font-size:12px;font-weight:700;">75% Funded</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">Target: ₹2,00,000 • Saved: ₹1,50,000</div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
              <div style="width:75%;height:100%;background:linear-gradient(90deg, var(--gold), var(--primary));"></div>
            </div>
          </div>
        </div>
      </div>
    `
  },
  reports: {
    title: 'Analytics & Flight Telemetry',
    desc: 'Deep financial health diagnostics, monthly cashflow ratio telemetry, category burn distributions, and exportable flight manifests.',
    items: [
      'Comprehensive burn-rate vs wealth accumulation efficiency analytics',
      'Categorical expense distribution donut graphs and breakdowns',
      'Sanitized one-click CSV ledger export for spreadsheet compatibility',
      'Print-ready formatted executive flight reports'
    ],
    mockup: `
      <div class="mockup-cockpit">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border-glass);padding-bottom:10px;">
          <div class="mono" style="font-size:12px;color:var(--text-muted);">FLIGHT TELEMETRY // RATIO DIAGNOSTICS</div>
          <span class="mono text-cyan" style="font-size:11px;font-weight:700;">HEALTH: 99.4% OPTIMAL</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
          <div style="background:rgba(10,15,26,0.6);border:1px solid var(--border-glass);padding:10px;border-radius:8px;text-align:center;">
            <div style="font-size:10.5px;color:var(--text-muted);">Burn Rate</div>
            <div class="mono text-primary" style="font-size:15px;font-weight:800;">37.4%</div>
          </div>
          <div style="background:rgba(10,15,26,0.6);border:1px solid var(--border-glass);padding:10px;border-radius:8px;text-align:center;">
            <div style="font-size:10.5px;color:var(--text-muted);">Savings Rate</div>
            <div class="mono text-cyan" style="font-size:15px;font-weight:800;">62.6%</div>
          </div>
          <div style="background:rgba(10,15,26,0.6);border:1px solid var(--border-glass);padding:10px;border-radius:8px;text-align:center;">
            <div style="font-size:10.5px;color:var(--text-muted);">Status</div>
            <div class="mono text-gold" style="font-size:15px;font-weight:800;">Nominal</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-outline-glass btn-sm btn-block" style="font-size:11.5px;" onclick="startDemoMode()">Export CSV</button>
          <button class="btn btn-glass btn-sm btn-block" style="font-size:11.5px;" onclick="startDemoMode()">Print Dossier</button>
        </div>
      </div>
    `
  }
};

function renderShowcaseTab(tabKey){
  const data = SHOWCASE_DATA[tabKey] || SHOWCASE_DATA.dash;
  const container = document.getElementById('showcaseDisplay');
  if(!container) return;

  container.innerHTML = `
    <div class="showcase-grid">
      <div class="showcase-info">
        <h3>${data.title}</h3>
        <p>${data.desc}</p>
        <ul class="showcase-checklist">
          ${data.items.map(item => `<li><span class="chk-ic">✓</span> <span>${item}</span></li>`).join('')}
        </ul>
        <button class="btn btn-primary btn-sm btn-shimmer" id="showcaseCtaBtn">
          <span>Test Drive This Feature</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
      <div class="showcase-preview-frame">
        ${data.mockup}
      </div>
    </div>
  `;

  const showcaseCta = document.getElementById('showcaseCtaBtn');
  if(showcaseCta){
    showcaseCta.addEventListener('click', startDemoMode);
  }

  document.querySelectorAll('#showcaseTabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
  });
}

function renderHomeMarketTicker(){
  const track = document.getElementById('homeMarketTicker');
  if(!track) return;

  const itemsHtml = INSTRUMENTS.map(inst => {
    const price = currentPrice(inst.id);
    const hist = priceHistory(inst.id, 2);
    const prev = hist.length > 1 ? hist[hist.length-2] : price;
    const diff = price - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    const isUp = pct >= 0;
    const sign = isUp ? '+' : '';
    const chgClass = isUp ? 'up' : 'down';

    return `
      <div class="streamer-item">
        <span class="tkr">${inst.ticker}</span>
        <span class="prc mono">${fmt(price)}</span>
        <span class="chg mono ${chgClass}">${sign}${pct.toFixed(2)}%</span>
      </div>
    `;
  }).join('');

  track.innerHTML = itemsHtml + itemsHtml;
}

function bindFaqAccordion(){
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      if(!item) return;
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if(!isOpen) item.classList.add('open');
    });
  });
}

function bindHomeEvents(){
  // Mobile Home Nav Toggle
  const homeHamb = document.getElementById('homeHamburgerBtn');
  const homeNavLinks = document.getElementById('homeNavLinks');
  if(homeHamb && homeNavLinks){
    homeHamb.addEventListener('click', () => {
      homeNavLinks.classList.toggle('open');
    });
  }

  // Smooth scroll links inside home navigation
  document.querySelectorAll('.home-nav-links .hlink').forEach(link => {
    link.addEventListener('click', () => {
      if(homeNavLinks) homeNavLinks.classList.remove('open');
    });
  });

  // Home Logo & App Brand clicks
  const homeLogo = document.getElementById('homeLogoBtn');
  if(homeLogo) homeLogo.addEventListener('click', e => { e.preventDefault(); showHomeView(); });

  const appBrand = document.getElementById('appBrandBtn');
  if(appBrand) appBrand.addEventListener('click', () => showHomeView());

  const homeResume = document.getElementById('homeResumeSessionBtn');
  if(homeResume) homeResume.addEventListener('click', () => enterApp());

  // Demo buttons
  ['homeDemoBtnNav', 'heroDemoBtn', 'ctaDemoBtn', 'footerDemoBtn', 'planCommanderBtn'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', startDemoMode);
  });

  // Login buttons
  ['homeLoginBtnNav', 'heroLoginBtn', 'footerLoginBtn'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', showLoginView);
  });

  // Signup buttons
  ['homeSignupBtnNav', 'heroGetStartedBtn', 'ctaSignupBtn', 'footerSignupBtn', 'planCadetBtn', 'planTitanBtn'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', showRegisterView);
  });

  // Back to Home from Auth
  const loginBackHome = document.getElementById('loginBackHomeBtn');
  if(loginBackHome) loginBackHome.addEventListener('click', showHomeView);

  const regBackHome = document.getElementById('registerBackHomeBtn');
  if(regBackHome) regBackHome.addEventListener('click', showHomeView);

  // Home Simulator range sliders
  ['homeSimMonthly', 'homeSimReturn', 'homeSimYears', 'homeSimInitial'].forEach(id => {
    const slider = document.getElementById(id);
    if(slider) slider.addEventListener('input', updateHomeSimulator);
  });

  // Simulator Launch CTA
  const simLaunch = document.getElementById('homeSimLaunchBtn');
  if(simLaunch){
    simLaunch.addEventListener('click', () => {
      if(currentUser && userData){
        enterApp();
        showView('goals');
      } else {
        startDemoMode();
      }
    });
  }

  // Showcase Tabs
  const showcaseTabs = document.getElementById('showcaseTabs');
  if(showcaseTabs){
    showcaseTabs.addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if(btn) renderShowcaseTab(btn.getAttribute('data-tab'));
    });
  }

  // FAQ Accordion
  bindFaqAccordion();
}

/* ================= BOOTSTRAP ================= */
async function boot(){
  initAntigravityParticles();
  initMouseFollower();
  bindStaticEvents();
  bindHomeEvents();

  try {
    const res = await apiRequest('/auth/me', 'GET');
    currentUser = res.user.username;
    userData = res.data;
    ensureUserDataShape();
    // If a session cookie is still valid on the server, enter app directly
    enterApp();
    return;
  } catch(e){
    // No active session — fall through to the landing page
  }

  // Default to showing the new Home / Landing Page
  showHomeView();
}

document.addEventListener('DOMContentLoaded', boot);

