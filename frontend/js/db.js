// ============================================================
// CreditPulse — Database Layer (Production-Grade Version)
// Fixes: restoreSession, state visibility, timeout, signOut,
//        silent failures, error logging
// ============================================================

const DB = (() => {

  // ── App State (visible to UI) ─────────────────────────────
  const STATE = {
    status: 'idle',
    error: null,
    isOnline: navigator.onLine,
  };

  function setState(status, error = null) {
    STATE.status = status;
    STATE.error  = error;

    const banner = document.getElementById('offline-banner');
    if (banner) {
      if (status === 'offline' || !STATE.isOnline) {
        banner.classList.remove('hidden');
        banner.textContent = '📵 Offline — data saved locally';
      } else if (status === 'error') {
        banner.classList.remove('hidden');
        banner.textContent = '⚠️ ' + (error || 'Connection error');
        setTimeout(() => banner.classList.add('hidden'), 4000);
      } else {
        banner.classList.add('hidden');
      }
    }
    console.log('[CreditPulse] State:', status, error || '');
  }

  window.addEventListener('online',  () => { STATE.isOnline = true;  setState('ready');   syncOfflineQueue(); });
  window.addEventListener('offline', () => { STATE.isOnline = false; setState('offline'); });

  let supabase    = null;
  let currentUser = null;

  function initSupabase() {
    if (supabase) return;

    if (!window.supabase) {
      console.error('[CreditPulse] Supabase SDK not loaded — check script tag in index.html');
      return;
    }
    if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
      console.error('[CreditPulse] SUPABASE_URL not set in config.js');
      return;
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('YOUR_ANON')) {
      console.error('[CreditPulse] SUPABASE_ANON_KEY not set in config.js');
      return;
    }

    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'cp-auth-token',
          storage: window.localStorage,
        }
      });
      console.log('[CreditPulse] Supabase initialized');
    } catch (e) {
      console.error('[CreditPulse] Supabase createClient failed:', e);
      supabase = null;
    }
  }

  const KEYS = {
    customers:    'cp_customers',
    transactions: 'cp_transactions',
    user:         'cp_user',
    queue:        'cp_offline_queue',
    settings:     'cp_settings',
  };

  function localGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (e) { console.error('[CreditPulse] localGet failed:', key, e); return []; }
  }

  function localSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.error('[CreditPulse] localSet failed — storage full?', e); }
  }

  function genId() {
    return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  function enqueue(action) {
    try {
      const queue = localGet(KEYS.queue);
      queue.push({ ...action, queued_at: new Date().toISOString() });
      localSet(KEYS.queue, queue);
    } catch (e) { console.error('[CreditPulse] enqueue failed:', e); }
  }

  async function syncOfflineQueue() {
    if (!supabase || !currentUser) return;
    const queue = localGet(KEYS.queue);
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        if (item.type === 'customer')    await supabase.from('customers').insert(item.data);
        if (item.type === 'transaction') await supabase.from('transactions').insert(item.data);
      } catch (e) {
        console.error('[CreditPulse] sync failed for:', item.type, e);
        remaining.push(item);
      }
    }
    localSet(KEYS.queue, remaining);
  }

  // ── RESTORE SESSION ───────────────────────────────────────
  async function restoreSession() {
    setState('loading');
    try {
      initSupabase();

      if (!supabase) {
        console.error('[CreditPulse] Supabase not initialized — going to login');
        setState('error', 'Could not connect to server');
        return null;
      }

      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[CreditPulse] getSession error:', error.message);
        setState('error', error.message);
        return null;
      }

      if (data?.session?.user) {
        currentUser = data.session.user;

        try {
          await Promise.race([
            loadAllData(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Data load timeout after 5s')), 5000)
            )
          ]);
        } catch (e) {
          console.warn('[CreditPulse] loadAllData timed out — using cached data:', e.message);
        }

        setState('ready');
        return currentUser;
      }

      setState('idle');
      return null;

    } catch (e) {
      console.error('[CreditPulse] restoreSession failed:', e);
      if (!navigator.onLine) {
        console.warn('[CreditPulse] Offline — using local data');
        setState('offline');
      } else {
        setState('error', 'Session error — please login again');
      }
      return null;
    }
  }

  // ── AUTH ──────────────────────────────────────────────────
  async function signUp(email, password, name) {
    if (!supabase) throw new Error('Not connected to server');
    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { name } }
    });
    if (error) throw error;
    return await signIn(email, password);
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('No connection to server');
    setState('loading');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setState('error', error.message); throw error; }
    currentUser = data.user;
    localSet(KEYS.user, { email, id: data.user.id, name: data.user.user_metadata?.name });
    try {
      await Promise.race([
        loadAllData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
    } catch (e) { console.warn('[CreditPulse] loadAllData timeout on login:', e.message); }
    setState('ready');
    return data.user;
  }

  async function signOut() {
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (e) { console.error('[CreditPulse] signOut error:', e); }
    currentUser = null;
    // Surgical removal — settings are kept intentionally
    localStorage.removeItem(KEYS.customers);
    localStorage.removeItem(KEYS.transactions);
    localStorage.removeItem(KEYS.user);
    localStorage.removeItem(KEYS.queue);
    setState('idle');
  }

  function getUser() {
    if (currentUser) return currentUser;
    try { return JSON.parse(localStorage.getItem(KEYS.user)) || null; }
    catch { return null; }
  }

  async function loadAllData() {
    if (!supabase || !currentUser) return;
    const [custRes, txnRes] = await Promise.all([
      supabase.from('customers').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
      supabase.from('transactions').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
    ]);
    if (custRes.error) console.error('[CreditPulse] load customers error:', custRes.error.message);
    if (txnRes.error)  console.error('[CreditPulse] load transactions error:', txnRes.error.message);
    if (custRes.data)  localSet(KEYS.customers, custRes.data);
    if (txnRes.data)   localSet(KEYS.transactions, txnRes.data);
  }

  // ── CUSTOMERS ─────────────────────────────────────────────
  function getCustomers() { return localGet(KEYS.customers); }

  async function addCustomer(name, phone, creditLimit) {
    const settings = getSettings();
    const limit = Number(creditLimit) || settings.defaultCreditLimit || DEFAULT_CREDIT_LIMIT;
    const customer = {
      id: genId(), name: name.trim(), phone: phone.trim(),
      credit_limit: limit, user_id: currentUser?.id || 'local',
      created_at: new Date().toISOString(),
    };
    const customers = localGet(KEYS.customers);
    customers.unshift(customer);
    localSet(KEYS.customers, customers);

    if (STATE.isOnline && supabase && currentUser) {
      try {
        const { data, error } = await supabase.from('customers')
          .insert({ name: customer.name, phone: customer.phone, credit_limit: customer.credit_limit, user_id: currentUser.id })
          .select().single();
        if (error) { console.error('[CreditPulse] addCustomer error:', error.message); enqueue({ type: 'customer', data: customer }); }
        else if (data) { localSet(KEYS.customers, localGet(KEYS.customers).map(c => c.id === customer.id ? data : c)); }
      } catch (e) { console.error('[CreditPulse] addCustomer network error:', e); enqueue({ type: 'customer', data: customer }); }
    } else {
      enqueue({ type: 'customer', data: customer });
    }
    return customer;
  }

  async function deleteCustomer(customerId) {
    localSet(KEYS.customers,    localGet(KEYS.customers).filter(c => c.id !== customerId));
    localSet(KEYS.transactions, localGet(KEYS.transactions).filter(t => t.customer_id !== customerId));
    if (STATE.isOnline && supabase && currentUser) {
      try {
        await supabase.from('transactions').delete().eq('customer_id', customerId).eq('user_id', currentUser.id);
        await supabase.from('customers').delete().eq('id', customerId).eq('user_id', currentUser.id);
      } catch (e) { console.error('[CreditPulse] deleteCustomer failed:', e); }
    }
  }

  // ── TRANSACTIONS ──────────────────────────────────────────
  function getTransactions(customerId) {
    return localGet(KEYS.transactions)
      .filter(t => t.customer_id === customerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async function addTransaction(customerId, type, amount) {
    const txn = {
      id: genId(), customer_id: customerId, type,
      amount: Number(amount), user_id: currentUser?.id || 'local',
      created_at: new Date().toISOString(),
    };
    const txns = localGet(KEYS.transactions);
    txns.unshift(txn);
    localSet(KEYS.transactions, txns);

    if (STATE.isOnline && supabase && currentUser) {
      try {
        const { data, error } = await supabase.from('transactions')
          .insert({ customer_id: txn.customer_id, type: txn.type, amount: txn.amount, user_id: currentUser.id })
          .select().single();
        if (error) { console.error('[CreditPulse] addTransaction error:', error.message); enqueue({ type: 'transaction', data: txn }); }
        else if (data) { localSet(KEYS.transactions, localGet(KEYS.transactions).map(t => t.id === txn.id ? data : t)); }
      } catch (e) { console.error('[CreditPulse] addTransaction network error:', e); enqueue({ type: 'transaction', data: txn }); }
    } else {
      enqueue({ type: 'transaction', data: txn });
    }
    return txn;
  }

  // ── CALCULATIONS ──────────────────────────────────────────
  function getCustomerBalance(customerId) {
    return getTransactions(customerId).reduce((sum, t) =>
      t.type === 'sale' ? sum + t.amount : sum - t.amount, 0);
  }

  function getLastPayment(customerId) {
    const pays = getTransactions(customerId).filter(t => t.type === 'payment');
    return pays.length ? pays[0] : null;
  }

  function getDaysOverdue(customerId) {
    const txns = getTransactions(customerId);
    if (!txns.length) return 0;
    const pays = txns.filter(t => t.type === 'payment');
    const ref  = pays.length ? pays[0] : txns[txns.length - 1];
    return Math.floor((Date.now() - new Date(ref.created_at)) / 86400000);
  }

  function getRiskLevel(customerId) {
    const balance = getCustomerBalance(customerId);
    const days    = getDaysOverdue(customerId);
    const c       = getCustomers().find(x => x.id === customerId);
    const pct     = balance / (c?.credit_limit || DEFAULT_CREDIT_LIMIT);
    if (balance <= 0)            return 'low';
    if (days > 30 || pct > 0.9) return 'high';
    if (days > 14 || pct > 0.6) return 'medium';
    return 'low';
  }

  function getPrediction(customerId) {
    const risk = getRiskLevel(customerId);
    const pays = getTransactions(customerId).filter(t => t.type === 'payment');
    if (risk === 'high')      return { icon: '⚠️', text: 'Will not pay on time — Call now', cls: 'predict-default' };
    if (risk === 'medium')    return { icon: '🕐', text: 'Likely to pay late',               cls: 'predict-late'    };
    if (pays.length >= 2)     return { icon: '✅', text: 'Usually pays on time',             cls: 'predict-ok'      };
    return                           { icon: '✅', text: 'Looking safe',                     cls: 'predict-ok'      };
  }

  function getCallList() {
    return getCustomers()
      .map(c => ({ ...c, balance: getCustomerBalance(c.id), days: getDaysOverdue(c.id), risk: getRiskLevel(c.id) }))
      .filter(c => c.balance > 0 && (c.risk === 'high' || c.days > 7))
      .sort((a, b) => (b.days * 1000 + b.balance) - (a.days * 1000 + a.balance))
      .slice(0, 3);
  }

  // ── SETTINGS ─────────────────────────────────────────────
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(KEYS.settings)) || {}; }
    catch (e) { console.error('[CreditPulse] getSettings error:', e); return {}; }
  }

  function saveSettings(obj) {
    try { localStorage.setItem(KEYS.settings, JSON.stringify({ ...getSettings(), ...obj })); }
    catch (e) { console.error('[CreditPulse] saveSettings error:', e); }
  }

  // ── INIT ─────────────────────────────────────────────────
  initSupabase();

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    signUp, signIn, signOut, getUser, restoreSession,
    loadAllData,
    getCustomers, addCustomer, deleteCustomer,
    getTransactions, addTransaction,
    getCustomerBalance, getLastPayment, getDaysOverdue,
    getRiskLevel, getPrediction, getCallList,
    getSettings, saveSettings,
    getState: () => STATE,
  };

})();
