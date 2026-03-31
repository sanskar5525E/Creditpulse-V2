// ============================================================
// CreditPulse — Database Layer (Supabase + Offline Fallback)
// All data operations go through this file
// ============================================================

const DB = (() => {

  // ── Supabase client (loaded from CDN in index.html) ──────
  let supabase = null;
  let currentUser = null;
  let isOnline = navigator.onLine;

  window.addEventListener('online',  () => { isOnline = true;  syncOfflineQueue(); });
  window.addEventListener('offline', () => { isOnline = false; });

  function initSupabase() {
    // Supabase JS v2 loaded via CDN
    if (window.supabase) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  }

  // ── Local Storage Keys ────────────────────────────────────
  const KEYS = {
    customers: 'cp_customers',
    transactions: 'cp_transactions',
    user: 'cp_user',
    queue: 'cp_offline_queue',
    settings: 'cp_settings',
  };

  // ── Local helpers ─────────────────────────────────────────
  function localGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }
  function localSet(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function genId() {
    return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // ── Offline queue ─────────────────────────────────────────
  function enqueue(action) {
    const queue = localGet(KEYS.queue);
    queue.push({ ...action, queued_at: new Date().toISOString() });
    localSet(KEYS.queue, queue);
  }

  async function syncOfflineQueue() {
    if (!supabase || !currentUser) return;
    const queue = localGet(KEYS.queue);
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      try {
        if (item.type === 'insert_customer') {
          const { id, ...data } = item.data;
          await supabase.from('customers').insert({ ...data, user_id: currentUser.id });
        } else if (item.type === 'insert_transaction') {
          const { id, ...data } = item.data;
          await supabase.from('transactions').insert({ ...data, user_id: currentUser.id });
        } else if (item.type === 'delete_customer') {
          await supabase.from('customers').delete().eq('id', item.id).eq('user_id', currentUser.id);
        }
      } catch {
        remaining.push(item);
      }
    }
    localSet(KEYS.queue, remaining);
  }

  // ── AUTH ──────────────────────────────────────────────────
  async function signUp(email, password, name) {
    if (!supabase) throw new Error('Not connected to server');
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } }
    });
    if (error) throw error;
    currentUser = data.user;
    localSet(KEYS.user, { email, name, id: data.user?.id });
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) {
      // Offline demo mode
      const saved = localGet(KEYS.user);
      if (saved && saved.email === email) { currentUser = saved; return saved; }
      throw new Error('No internet connection');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    localSet(KEYS.user, { email, id: data.user.id, name: data.user.user_metadata?.name });
    await loadAllData();
    return data;
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    localStorage.clear();
  }

  function getUser() {
    if (currentUser) return currentUser;
    return localGet(KEYS.user) || null;
  }

  async function restoreSession() {
    initSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      currentUser = data.session.user;
      await loadAllData();
      return currentUser;
    }
    return null;
  }

  // ── Load all data from Supabase → local cache ─────────────
  async function loadAllData() {
    if (!supabase || !currentUser) return;
    try {
      const [custRes, txnRes] = await Promise.all([
        supabase.from('customers').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        supabase.from('transactions').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
      ]);
      if (custRes.data)  localSet(KEYS.customers, custRes.data);
      if (txnRes.data)   localSet(KEYS.transactions, txnRes.data);
    } catch { /* use cached */ }
  }

  // ── CUSTOMERS ─────────────────────────────────────────────
  function getCustomers() {
    return localGet(KEYS.customers);
  }

  async function addCustomer(name, phone, creditLimit) {
    const settings = getSettings();
    const limit = creditLimit || settings.defaultCreditLimit || DEFAULT_CREDIT_LIMIT;
    const customer = {
      id: genId(),
      name: name.trim(),
      phone: phone.trim(),
      credit_limit: Number(limit),
      user_id: currentUser?.id || 'local',
      created_at: new Date().toISOString(),
    };

    // Save locally first
    const customers = localGet(KEYS.customers);
    customers.unshift(customer);
    localSet(KEYS.customers, customers);

    // Sync to Supabase
    if (isOnline && supabase && currentUser) {
      try {
        const { data, error } = await supabase.from('customers').insert({
          name: customer.name, phone: customer.phone,
          credit_limit: customer.credit_limit, user_id: currentUser.id,
        }).select().single();
        if (!error && data) {
          // Replace local id with real id
          const updated = localGet(KEYS.customers).map(c => c.id === customer.id ? data : c);
          localSet(KEYS.customers, updated);
        }
      } catch { enqueue({ type: 'insert_customer', data: customer }); }
    } else {
      enqueue({ type: 'insert_customer', data: customer });
    }
    return customer;
  }

  async function deleteCustomer(customerId) {
    const customers = localGet(KEYS.customers).filter(c => c.id !== customerId);
    localSet(KEYS.customers, customers);
    const txns = localGet(KEYS.transactions).filter(t => t.customer_id !== customerId);
    localSet(KEYS.transactions, txns);

    if (isOnline && supabase && currentUser) {
      try {
        await supabase.from('customers').delete().eq('id', customerId).eq('user_id', currentUser.id);
        await supabase.from('transactions').delete().eq('customer_id', customerId).eq('user_id', currentUser.id);
      } catch { enqueue({ type: 'delete_customer', id: customerId }); }
    } else {
      enqueue({ type: 'delete_customer', id: customerId });
    }
  }

  // ── TRANSACTIONS ──────────────────────────────────────────
  function getTransactions(customerId) {
    return localGet(KEYS.transactions)
      .filter(t => t.customer_id === customerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async function addTransaction(customerId, type, amount) {
    // type: 'payment' (customer paid) | 'sale' (gave goods)
    const txn = {
      id: genId(),
      customer_id: customerId,
      type,
      amount: Number(amount),
      user_id: currentUser?.id || 'local',
      created_at: new Date().toISOString(),
    };

    const txns = localGet(KEYS.transactions);
    txns.unshift(txn);
    localSet(KEYS.transactions, txns);

    if (isOnline && supabase && currentUser) {
      try {
        const { data, error } = await supabase.from('transactions').insert({
          customer_id: txn.customer_id, type: txn.type,
          amount: txn.amount, user_id: currentUser.id,
        }).select().single();
        if (!error && data) {
          const updated = localGet(KEYS.transactions).map(t => t.id === txn.id ? data : t);
          localSet(KEYS.transactions, updated);
        }
      } catch { enqueue({ type: 'insert_transaction', data: txn }); }
    } else {
      enqueue({ type: 'insert_transaction', data: txn });
    }
    return txn;
  }

  // ── COMPUTED: balance & risk ──────────────────────────────
  function getCustomerBalance(customerId) {
    const txns = getTransactions(customerId);
    return txns.reduce((sum, t) => {
      return t.type === 'sale' ? sum + t.amount : sum - t.amount;
    }, 0);
  }

  function getLastPayment(customerId) {
    const payments = getTransactions(customerId).filter(t => t.type === 'payment');
    return payments.length ? payments[0] : null;
  }

  function getDaysOverdue(customerId) {
    const last = getLastPayment(customerId);
    if (!last) {
      // Check oldest sale
      const txns = getTransactions(customerId);
      const sales = txns.filter(t => t.type === 'sale');
      if (!sales.length) return 0;
      const oldest = sales[sales.length - 1];
      return Math.floor((Date.now() - new Date(oldest.created_at)) / 86400000);
    }
    return Math.floor((Date.now() - new Date(last.created_at)) / 86400000);
  }

  // Risk: 'high' | 'medium' | 'low'
  function getRiskLevel(customerId) {
    const balance = getCustomerBalance(customerId);
    const days = getDaysOverdue(customerId);
    const customer = getCustomers().find(c => c.id === customerId);
    const limit = customer?.credit_limit || DEFAULT_CREDIT_LIMIT;
    const pct = balance / limit;

    if (balance <= 0) return 'low';
    if (days > 30 || pct > 0.9) return 'high';
    if (days > 14 || pct > 0.6) return 'medium';
    return 'low';
  }

  // Prediction text
  function getPrediction(customerId) {
    const txns = getTransactions(customerId);
    const payments = txns.filter(t => t.type === 'payment');
    const days = getDaysOverdue(customerId);
    const risk = getRiskLevel(customerId);

    if (risk === 'high') return { icon: '⚠️', text: 'Will not pay on time — Call now', cls: 'predict-default' };
    if (risk === 'medium') return { icon: '🕐', text: 'Likely to pay late', cls: 'predict-late' };
    if (payments.length >= 2) return { icon: '✅', text: 'Usually pays on time', cls: 'predict-ok' };
    return { icon: '✅', text: 'Looking safe', cls: 'predict-ok' };
  }

  // ── CALL LIST (who to call today) ────────────────────────
  function getCallList() {
    const customers = getCustomers();
    return customers
      .map(c => {
        const balance = getCustomerBalance(c.id);
        const days = getDaysOverdue(c.id);
        const risk = getRiskLevel(c.id);
        return { ...c, balance, days, risk };
      })
      .filter(c => c.balance > 0 && (c.risk === 'high' || c.days > 7))
      .sort((a, b) => {
        const scoreA = a.days * 1000 + a.balance;
        const scoreB = b.days * 1000 + b.balance;
        return scoreB - scoreA;
      })
      .slice(0, 3);
  }

  // ── SETTINGS ─────────────────────────────────────────────
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(KEYS.settings)) || {}; }
    catch { return {}; }
  }
  function saveSettings(obj) {
    localStorage.setItem(KEYS.settings, JSON.stringify({ ...getSettings(), ...obj }));
  }

  // ── Init ──────────────────────────────────────────────────
  initSupabase();

  return {
    signUp, signIn, signOut, getUser, restoreSession,
    getCustomers, addCustomer, deleteCustomer,
    getTransactions, addTransaction,
    getCustomerBalance, getLastPayment, getDaysOverdue,
    getRiskLevel, getPrediction, getCallList,
    getSettings, saveSettings,
    loadAllData,
  };
})();
async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name } }
  });
  if (error) throw error;
  
  // Auto sign in immediately after signup (works when email confirm is OFF)
  const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
    email, password
  });
  if (loginError) throw loginError;
  
  currentUser = loginData.user;
  localSet(KEYS.user, { email, name, id: loginData.user.id });
  return loginData;
}
