// ============================================================
// CreditPulse — Clean Database Layer (Stable Version)
// ============================================================

const DB = (() => {

  let supabase = null;
  let currentUser = null;
  let isOnline = navigator.onLine;

  window.addEventListener('online', () => { isOnline = true; syncOfflineQueue(); });
  window.addEventListener('offline', () => { isOnline = false; });

  // ✅ INIT SUPABASE (FIXED)
  function initSupabase() {
    if (window.supabase) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  }

  // ── Local Storage Keys ──
  const KEYS = {
    customers: 'cp_customers',
    transactions: 'cp_transactions',
    user: 'cp_user',
    queue: 'cp_offline_queue',
    settings: 'cp_settings',
  };

  // ── Local Helpers ──
  const localGet = (key) => JSON.parse(localStorage.getItem(key)) || [];
  const localSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

  const genId = () => 'local_' + Date.now();

  // ── Offline Queue ──
  function enqueue(action) {
    const queue = localGet(KEYS.queue);
    queue.push(action);
    localSet(KEYS.queue, queue);
  }

  async function syncOfflineQueue() {
    if (!supabase || !currentUser) return;

    const queue = localGet(KEYS.queue);
    if (!queue.length) return;

    const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === 'customer') {
          await supabase.from('customers').insert(item.data);
        }
        if (item.type === 'transaction') {
          await supabase.from('transactions').insert(item.data);
        }
      } catch {
        remaining.push(item);
      }
    }

    localSet(KEYS.queue, remaining);
  }

  // ── AUTH ──
  async function signUp(email, password, name) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });

    if (error) throw error;

    return await signIn(email, password);
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('No connection');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) throw error;

    currentUser = data.user;

    localSet(KEYS.user, {
      email,
      id: data.user.id,
      name: data.user.user_metadata?.name
    });

    await loadAllData();

    return data.user;
  }

  function getUser() {
    return currentUser || localGet(KEYS.user);
  }

  // ── LOAD DATA ──
  async function loadAllData() {
    if (!supabase || !currentUser) return;

    try {
      const { data: customers } = await supabase
        .from('customers')
        .select('*')
        .eq('user_id', currentUser.id);

      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', currentUser.id);

      if (customers) localSet(KEYS.customers, customers);
      if (transactions) localSet(KEYS.transactions, transactions);

    } catch {
      // fallback to local
    }
  }

  // ── CUSTOMERS ──
  function getCustomers() {
    return localGet(KEYS.customers);
  }

  async function addCustomer(name, phone, creditLimit) {

    const customer = {
      id: genId(),
      name: name.trim(),
      phone: phone.trim(),
      credit_limit: Number(creditLimit || DEFAULT_CREDIT_LIMIT),
      user_id: currentUser?.id || 'local',
      created_at: new Date().toISOString(),
    };

    const customers = localGet(KEYS.customers);
    customers.unshift(customer);
    localSet(KEYS.customers, customers);

    if (isOnline && supabase && currentUser) {
      try {
        await supabase.from('customers').insert({
          name: customer.name,
          phone: customer.phone,
          credit_limit: customer.credit_limit,
          user_id: currentUser.id
        });
      } catch {
        enqueue({ type: 'customer', data: customer });
      }
    } else {
      enqueue({ type: 'customer', data: customer });
    }

    return customer;
  }

  // ── TRANSACTIONS ──
  function getTransactions(customerId) {
    return localGet(KEYS.transactions)
      .filter(t => t.customer_id === customerId);
  }

  async function addTransaction(customerId, type, amount) {

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
        await supabase.from('transactions').insert({
          customer_id: txn.customer_id,
          type: txn.type,
          amount: txn.amount,
          user_id: currentUser.id
        });
      } catch {
        enqueue({ type: 'transaction', data: txn });
      }
    } else {
      enqueue({ type: 'transaction', data: txn });
    }

    return txn;
  }

  // ── CALCULATIONS ──
  function getCustomerBalance(customerId) {
    return getTransactions(customerId).reduce((sum, t) => {
      return t.type === 'sale' ? sum + t.amount : sum - t.amount;
    }, 0);
  }

  function getDaysOverdue(customerId) {
    const txns = getTransactions(customerId);
    if (!txns.length) return 0;

    const last = txns[0];
    return Math.floor((Date.now() - new Date(last.created_at)) / 86400000);
  }

  function getRiskLevel(customerId) {
    const balance = getCustomerBalance(customerId);
    const days = getDaysOverdue(customerId);

    if (balance <= 0) return 'low';
    if (days > 30) return 'high';
    if (days > 14) return 'medium';
    return 'low';
  }

  // ── INIT ──
  initSupabase();

  return {
    signUp,
    signIn,
    getUser,
    loadAllData,
    getCustomers,
    addCustomer,
    getTransactions,
    addTransaction,
    getCustomerBalance,
    getRiskLevel
  };

})();
