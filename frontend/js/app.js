// ============================================================
// CreditPulse — Main App Logic
// ============================================================

const App = (() => {

  // ── State ─────────────────────────────────────────────────
  let activeCustomerId = null;
  let currentFilter = 'all';
  let paidAmount = '';
  let goodsAmount = '';

  // ── Screens ───────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  // ── Toast ─────────────────────────────────────────────────
  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type + '-toast' : '');
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  // ── Formatting helpers ────────────────────────────────────
  function fmtRupee(n) {
    return '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function initials(name) {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  // ── Offline banner ────────────────────────────────────────
  function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!navigator.onLine) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }
  window.addEventListener('online',  updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();

  // ── AUTH ──────────────────────────────────────────────────
  document.getElementById('btn-login').addEventListener('click', async () => {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    errEl.classList.add('hidden');
    try {
      await DB.signIn(email, password);
      renderDashboard();
      showScreen('dashboard');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btn-signup').addEventListener('click', async () => {
    const name     = document.getElementById('signup-name').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errEl    = document.getElementById('signup-error');
    errEl.classList.add('hidden');
    if (!name || !email || !password) {
      errEl.textContent = 'Please fill all fields';
      errEl.classList.remove('hidden'); return;
    }
    try {
      await DB.signUp(email, password, name);
      showToast('Account created! Please sign in.', 'success');
      showScreen('login');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('go-signup').addEventListener('click', () => showScreen('signup'));
  document.getElementById('go-login').addEventListener('click',  () => showScreen('login'));
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await DB.signOut();
    showScreen('login');
  });

  // ── DASHBOARD ─────────────────────────────────────────────
  function renderDashboard() {
    // Date
    document.getElementById('dashboard-date').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    const customers = DB.getCustomers();

    // Total outstanding
    const total = customers.reduce((sum, c) => sum + Math.max(0, DB.getCustomerBalance(c.id)), 0);
    document.getElementById('total-outstanding').textContent = fmtRupee(total);

    // Call list
    renderCallBanner();

    // Customer list
    renderCustomerList(customers);

    // Set nav active
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('[data-nav="dashboard"]').forEach(n => n.classList.add('active'));
  }

  function renderCallBanner() {
    const callList = DB.getCallList();
    const banner   = document.getElementById('call-banner');
    const listEl   = document.getElementById('call-list');
    const countEl  = document.getElementById('call-count');

    if (!callList.length) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    countEl.textContent = callList.length;

    const ranks = ['rank-1', 'rank-2', 'rank-3'];
    listEl.innerHTML = callList.map((c, i) => `
      <div class="call-item">
        <div class="call-rank ${ranks[i]}">${i + 1}</div>
        <div class="call-info">
          <div class="call-name">${c.name}</div>
          <div class="call-reason">${fmtRupee(c.balance)} · ${c.days} days overdue</div>
        </div>
        <a class="call-dial-btn" href="tel:${c.phone}">📞 Call</a>
      </div>
    `).join('');
  }

  function renderCustomerList(customers) {
    const listEl    = document.getElementById('customer-list');
    const emptyEl   = document.getElementById('empty-state');
    const searchVal = document.getElementById('search-input').value.toLowerCase();

    let filtered = customers.map(c => ({
      ...c,
      balance: DB.getCustomerBalance(c.id),
      risk: DB.getRiskLevel(c.id),
      days: DB.getDaysOverdue(c.id),
      prediction: DB.getPrediction(c.id),
    }));

    // Search
    if (searchVal) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(searchVal) ||
        c.phone.includes(searchVal)
      );
    }

    // Filter
    if (currentFilter === 'high')   filtered = filtered.filter(c => c.risk === 'high');
    if (currentFilter === 'medium') filtered = filtered.filter(c => c.risk === 'medium');
    if (currentFilter === 'low')    filtered = filtered.filter(c => c.risk === 'low');

    // Sort: highest balance first
    filtered.sort((a, b) => b.balance - a.balance);

    if (!filtered.length) {
      emptyEl.classList.remove('hidden');
      listEl.querySelectorAll('.customer-card').forEach(el => el.remove());
      return;
    }
    emptyEl.classList.add('hidden');

    listEl.querySelectorAll('.customer-card').forEach(el => el.remove());

    filtered.forEach(c => {
      const pct = Math.min(100, Math.round((c.balance / (c.credit_limit || 30000)) * 100));
      const amtCls = c.risk === 'high' ? 'amount-red' : c.risk === 'medium' ? 'amount-amber' : 'amount-green';
      const badgeCls = c.risk === 'high' ? 'badge-red' : c.risk === 'medium' ? 'badge-amber' : 'badge-green';
      const fillCls  = c.risk === 'high' ? 'fill-red' : c.risk === 'medium' ? 'fill-amber' : 'fill-green';
      const riskLabel = c.risk === 'high' ? 'Big Risk' : c.risk === 'medium' ? 'Overdue' : 'Safe';

      const card = document.createElement('div');
      card.className = 'customer-card';
      card.dataset.id = c.id;
      card.innerHTML = `
        <div class="card-top">
          <div>
            <div class="cust-name">${c.name}</div>
            <div class="cust-meta">${c.days > 0 ? c.days + ' days since last payment' : 'No transactions yet'}</div>
          </div>
          <div class="cust-amount ${amtCls}">${fmtRupee(c.balance)}</div>
        </div>
        <div class="card-bottom">
          <span class="risk-badge-sm ${badgeCls}">${riskLabel}</span>
          <span class="predict-pill ${c.prediction.cls}">${c.prediction.icon} ${c.prediction.text}</span>
          <div class="mini-bar"><div class="mini-bar-fill ${fillCls}" style="width:${pct}%"></div></div>
        </div>
      `;
      card.addEventListener('click', () => openProfile(c.id));
      listEl.appendChild(card);
    });
  }

  // Search & Filter
  document.getElementById('search-input').addEventListener('input', () => renderDashboard());
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderDashboard();
    });
  });

  // ── PROFILE ───────────────────────────────────────────────
  function openProfile(customerId) {
    activeCustomerId = customerId;
    const customers = DB.getCustomers();
    const c = customers.find(x => x.id === customerId);
    if (!c) return;

    const balance = DB.getCustomerBalance(customerId);
    const risk    = DB.getRiskLevel(customerId);
    const lastPay = DB.getLastPayment(customerId);
    const pred    = DB.getPrediction(customerId);
    const pct     = Math.min(100, Math.round((balance / (c.credit_limit || 30000)) * 100));

    // Header
    document.getElementById('profile-avatar').textContent = initials(c.name);
    document.getElementById('profile-name').textContent   = c.name;
    const phoneEl = document.getElementById('profile-phone');
    phoneEl.textContent = c.phone;
    phoneEl.href = 'tel:' + c.phone;

    // Risk badge
    const rb = document.getElementById('profile-risk-badge');
    rb.textContent = risk === 'high' ? 'Big Risk' : risk === 'medium' ? 'Overdue' : 'Safe';
    rb.className = 'risk-badge ' + (risk === 'high' ? 'badge-red' : risk === 'medium' ? 'badge-amber' : 'badge-green');

    // Balance
    const balEl = document.getElementById('profile-balance');
    balEl.textContent = fmtRupee(balance);
    balEl.className = 'balance-amount ' + (risk === 'high' ? 'amount-red' : risk === 'medium' ? 'amount-amber' : 'amount-green');
    document.getElementById('profile-meta').textContent =
      lastPay ? 'Last paid: ' + fmtRupee(lastPay.amount) + ' on ' + fmtDate(lastPay.created_at) : 'No payments yet';

    // Credit bar
    document.getElementById('credit-used-label').textContent  = 'Used: ' + fmtRupee(balance);
    document.getElementById('credit-limit-label').textContent = 'Limit: ' + fmtRupee(c.credit_limit || 30000);
    const fill = document.getElementById('credit-bar-fill');
    fill.style.width = pct + '%';
    fill.className = 'credit-bar-fill ' + (pct > 90 ? 'fill-red' : pct > 60 ? 'fill-amber' : 'fill-green');
    const statusEl = document.getElementById('credit-status');
    if (pct >= 100) {
      statusEl.textContent = '🔴 STOP — Credit limit reached. Do not give more goods.';
      statusEl.style.color = 'var(--red-600)';
    } else if (pct > 80) {
      statusEl.textContent = '🟡 Caution — Almost at limit';
      statusEl.style.color = 'var(--amber-600)';
    } else {
      statusEl.textContent = '🟢 OK — Can give more goods';
      statusEl.style.color = 'var(--green-600)';
    }

    // Prediction
    document.getElementById('predict-icon').textContent = pred.icon;
    document.getElementById('predict-text').textContent = pred.text;
    document.getElementById('predict-text').className   = 'predict-text ' + pred.cls;

    // Transactions
    renderTransactions(customerId);

    // WhatsApp button
    document.getElementById('btn-whatsapp').onclick = () => {
      const msg = encodeURIComponent(
        `Hello ${c.name}, this is a reminder that you have an outstanding balance of ${fmtRupee(balance)} with us. Please arrange payment at your earliest convenience. Thank you!`
      );
      window.open('https://wa.me/' + c.phone.replace(/\D/g, '') + '?text=' + msg, '_blank');
    };

    showScreen('profile');
  }

  function renderTransactions(customerId) {
    const txns  = DB.getTransactions(customerId).slice(0, 15);
    const listEl = document.getElementById('txn-list');
    if (!txns.length) {
      listEl.innerHTML = '<div class="txn-empty">No transactions yet</div>';
      return;
    }
    listEl.innerHTML = txns.map(t => `
      <div class="txn-item">
        <div>
          <div class="txn-date">${fmtDate(t.created_at)}</div>
          <div class="txn-desc">${t.type === 'payment' ? '💵 Paid me' : '📦 Gave goods'}</div>
        </div>
        <div class="${t.type === 'payment' ? 'txn-debit' : 'txn-credit'}">
          ${t.type === 'payment' ? '+' : '-'}${fmtRupee(t.amount)}
        </div>
      </div>
    `).join('');
  }

  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    renderDashboard();
    showScreen('dashboard');
  });

  document.getElementById('btn-delete-customer').addEventListener('click', async () => {
    const customers = DB.getCustomers();
    const c = customers.find(x => x.id === activeCustomerId);
    if (!c) return;
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    await DB.deleteCustomer(activeCustomerId);
    showToast(c.name + ' deleted');
    renderDashboard();
    showScreen('dashboard');
  });

  // ── ADD CUSTOMER MODAL ────────────────────────────────────
  document.getElementById('fab-add').addEventListener('click', () => {
    document.getElementById('modal-add-customer').classList.remove('hidden');
    document.getElementById('new-cust-name').value  = '';
    document.getElementById('new-cust-phone').value = '';
    document.getElementById('new-cust-limit').value = '';
    document.getElementById('add-cust-error').classList.add('hidden');
    setTimeout(() => document.getElementById('new-cust-name').focus(), 100);
  });

  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    document.getElementById('modal-add-customer').classList.add('hidden');
  });

  document.getElementById('btn-save-customer').addEventListener('click', async () => {
    const name  = document.getElementById('new-cust-name').value.trim();
    const phone = document.getElementById('new-cust-phone').value.trim();
    const limit = document.getElementById('new-cust-limit').value;
    const errEl = document.getElementById('add-cust-error');
    errEl.classList.add('hidden');

    if (!name)  { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }
    if (!phone) { errEl.textContent = 'Phone is required'; errEl.classList.remove('hidden'); return; }

    try {
      await DB.addCustomer(name, phone, limit);
      document.getElementById('modal-add-customer').classList.add('hidden');
      showToast(name + ' added!', 'success');
      renderDashboard();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  // ── NUMPAD LOGIC ──────────────────────────────────────────
  function buildNumpad(getAmt, setAmt, displayId) {
    return function(key) {
      let cur = getAmt();
      if (key === 'del') {
        cur = cur.slice(0, -1);
      } else if (key === '000') {
        if (cur !== '' && cur !== '0') cur += '000';
      } else {
        if (cur.length >= 7) return;
        if (cur === '0' && key !== '.') cur = key;
        else cur += key;
      }
      setAmt(cur);
      const num = parseInt(cur || '0');
      document.getElementById(displayId).textContent = '₹' + num.toLocaleString('en-IN');
    };
  }

  const handlePaidKey  = buildNumpad(() => paidAmount,  v => paidAmount  = v, 'paid-amount-display');
  const handleGoodsKey = buildNumpad(() => goodsAmount, v => goodsAmount = v, 'goods-amount-display');

  document.querySelectorAll('#modal-paid-me .numpad-key').forEach(k => {
    k.addEventListener('click', () => handlePaidKey(k.dataset.key));
  });
  document.querySelectorAll('#modal-paid-me .qa-chip').forEach(k => {
    k.addEventListener('click', () => {
      paidAmount = k.dataset.amt;
      const num = parseInt(paidAmount);
      document.getElementById('paid-amount-display').textContent = '₹' + num.toLocaleString('en-IN');
    });
  });

  document.querySelectorAll('.goods-numpad .numpad-key').forEach(k => {
    k.addEventListener('click', () => handleGoodsKey(k.dataset.key));
  });
  document.querySelectorAll('.goods-chip').forEach(k => {
    k.addEventListener('click', () => {
      goodsAmount = k.dataset.amt;
      const num = parseInt(goodsAmount);
      document.getElementById('goods-amount-display').textContent = '₹' + num.toLocaleString('en-IN');
    });
  });

  // ── PAID ME MODAL ─────────────────────────────────────────
  document.getElementById('btn-paid-me').addEventListener('click', () => {
    const c = DB.getCustomers().find(x => x.id === activeCustomerId);
    paidAmount = '';
    document.getElementById('paid-amount-display').textContent = '₹0';
    document.getElementById('paid-me-subtitle').textContent = c ? c.name + ' paid you' : '';
    document.getElementById('modal-paid-me').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-paid').addEventListener('click', () => {
    document.getElementById('modal-paid-me').classList.add('hidden');
  });

  document.getElementById('btn-confirm-paid').addEventListener('click', async () => {
    const amt = parseInt(paidAmount || '0');
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return; }
    try {
      await DB.addTransaction(activeCustomerId, 'payment', amt);
      document.getElementById('modal-paid-me').classList.add('hidden');
      paidAmount = '';
      showToast('Payment of ' + fmtRupee(amt) + ' recorded ✓', 'success');
      openProfile(activeCustomerId); // refresh profile
    } catch (e) { showToast(e.message, 'error'); }
  });

  // ── GAVE GOODS MODAL ──────────────────────────────────────
  document.getElementById('btn-gave-goods').addEventListener('click', () => {
    const c = DB.getCustomers().find(x => x.id === activeCustomerId);
    goodsAmount = '';
    document.getElementById('goods-amount-display').textContent = '₹0';
    document.getElementById('gave-goods-subtitle').textContent = c ? 'Gave goods to ' + c.name : '';
    document.getElementById('modal-gave-goods').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-goods').addEventListener('click', () => {
    document.getElementById('modal-gave-goods').classList.add('hidden');
  });

  document.getElementById('btn-confirm-goods').addEventListener('click', async () => {
    const amt = parseInt(goodsAmount || '0');
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return; }

    // Check credit limit
    const balance = DB.getCustomerBalance(activeCustomerId);
    const c = DB.getCustomers().find(x => x.id === activeCustomerId);
    const limit = c?.credit_limit || DEFAULT_CREDIT_LIMIT;
    if (balance + amt > limit) {
      if (!confirm(`⚠️ This will exceed ${c.name}'s credit limit of ${fmtRupee(limit)}. Proceed anyway?`)) return;
    }

    try {
      await DB.addTransaction(activeCustomerId, 'sale', amt);
      document.getElementById('modal-gave-goods').classList.add('hidden');
      goodsAmount = '';
      showToast('Sale of ' + fmtRupee(amt) + ' added ✓', 'success');
      openProfile(activeCustomerId);
    } catch (e) { showToast(e.message, 'error'); }
  });

  // ── REPORT SCREEN ─────────────────────────────────────────
  function renderReport() {
    const customers = DB.getCustomers();
    const allWithData = customers.map(c => ({
      ...c,
      balance: DB.getCustomerBalance(c.id),
      risk: DB.getRiskLevel(c.id),
    }));

    const total    = allWithData.reduce((s, c) => s + Math.max(0, c.balance), 0);
    const high     = allWithData.filter(c => c.risk === 'high').length;
    const safe     = allWithData.filter(c => c.risk === 'low').length;

    document.getElementById('rpt-total').textContent     = fmtRupee(total);
    document.getElementById('rpt-customers').textContent = customers.length;
    document.getElementById('rpt-high').textContent      = high;
    document.getElementById('rpt-safe').textContent      = safe;

    // Top defaulters
    const defaulters = allWithData
      .filter(c => c.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    document.getElementById('rpt-defaulters').innerHTML = defaulters.length
      ? defaulters.map(c => `
          <div class="txn-item" style="padding:12px 16px;cursor:pointer;" onclick="App.openProfileById('${c.id}')">
            <div>
              <div class="txn-desc">${c.name}</div>
              <div class="txn-date">${c.risk === 'high' ? '🔴 Big Risk' : c.risk === 'medium' ? '🟡 Overdue' : '🟢 Safe'}</div>
            </div>
            <div class="txn-credit">${fmtRupee(c.balance)}</div>
          </div>
        `).join('')
      : '<div class="txn-empty">No outstanding balances 🎉</div>';

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('[data-nav="report"]').forEach(n => n.classList.add('active'));
  }

  // ── SETTINGS SCREEN ───────────────────────────────────────
  function renderSettings() {
    const user = DB.getUser();
    document.getElementById('settings-user-name').textContent = user?.name || user?.email || 'My Account';
    const settings = DB.getSettings();
    document.getElementById('default-credit-limit').value = settings.defaultCreditLimit || DEFAULT_CREDIT_LIMIT;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('[data-nav="settings"]').forEach(n => n.classList.add('active'));
  } 

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const limit = parseInt(document.getElementById('default-credit-limit').value || DEFAULT_CREDIT_LIMIT);
    DB.saveSettings({ defaultCreditLimit: limit });
    showToast('Settings saved ✓', 'success');
  });

  // ── BOTTOM NAV ────────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const nav = item.dataset.nav;
      if (nav === 'dashboard') { renderDashboard(); showScreen('dashboard'); }
      if (nav === 'report')    { renderReport();    showScreen('report'); }
      if (nav === 'settings')  { renderSettings();  showScreen('settings'); }
    });
  });

  // ── PUBLIC API (for inline onclick) ──────────────────────
  function openProfileById(id) {
    renderDashboard();
    openProfile(id);
  }

 async function init() {
  showScreen('splash');
  await new Promise(r => setTimeout(r, 1500));

  try {
    const user = await DB.restoreSession();

    if (user) {
      renderDashboard();
      showScreen('dashboard');
    } else {
      showScreen('login');
    }

  } catch (e) {
    console.error('Init failed:', e);

    alert('Something went wrong. Please login again.');

    showScreen('login');
  }
}

return { openProfileById };
})();
