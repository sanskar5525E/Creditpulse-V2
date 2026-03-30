// ============================================================
// CreditPulse — Excel / CSV Import Module
// Uses SheetJS (loaded from CDN) to parse Excel files
// ============================================================

const Importer = (() => {

  let parsedRows = []; // { name, phone, credit_limit, balance, valid, error }

  // ── Open / close modal ────────────────────────────────────
  function open() {
    reset();
    document.getElementById('modal-import').classList.remove('hidden');
  }
  function close() {
    document.getElementById('modal-import').classList.add('hidden');
    reset();
  }
  function reset() {
    parsedRows = [];
    document.getElementById('import-dropzone').classList.remove('hidden');
    document.getElementById('import-preview').classList.add('hidden');
    document.getElementById('import-progress').classList.add('hidden');
    document.getElementById('btn-confirm-import').classList.add('hidden');
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-tbody').innerHTML = '';
  }

  // ── Dropzone click ────────────────────────────────────────
  document.getElementById('import-dropzone').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });

  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    readFile(file);
  });

  // ── File reading ──────────────────────────────────────────
  function readFile(file) {
    const reader = new FileReader();
    const isCsv = file.name.endsWith('.csv');

    reader.onload = (e) => {
      try {
        let rows = [];
        if (isCsv) {
          rows = parseCsv(e.target.result);
        } else {
          // SheetJS for xlsx
          const data = new Uint8Array(e.target.result);
          const wb   = XLSX.read(data, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]]; // First sheet
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          rows = parseSheetRows(json);
        }
        parsedRows = rows;
        renderPreview(rows);
      } catch (err) {
        showToast('Could not read file: ' + err.message, 'error');
      }
    };

    if (isCsv) reader.readAsText(file);
    else        reader.readAsArrayBuffer(file);
  }

  // ── Parse Excel rows ──────────────────────────────────────
  function parseSheetRows(allRows) {
    // Find header row (look for "name" and "phone" in any row)
    let headerIdx = -1;
    let nameCol = -1, phoneCol = -1, limitCol = -1, balanceCol = -1;

    for (let i = 0; i < Math.min(allRows.length, 10); i++) {
      const row = allRows[i].map(c => String(c).toLowerCase().trim());
      const ni = row.findIndex(c => c.includes('name'));
      const pi = row.findIndex(c => c.includes('phone') || c.includes('mobile'));
      if (ni !== -1 && pi !== -1) {
        headerIdx = i;
        nameCol    = ni;
        phoneCol   = pi;
        limitCol   = row.findIndex(c => c.includes('limit') || c.includes('credit'));
        balanceCol = row.findIndex(c => c.includes('balance') || c.includes('owe') || c.includes('due'));
        break;
      }
    }

    // Fallback: assume first row is header
    if (headerIdx === -1) {
      headerIdx = 0;
      nameCol = 0; phoneCol = 1; limitCol = 2; balanceCol = 3;
    }

    const dataRows = allRows.slice(headerIdx + 1);
    return dataRows
      .filter(row => row.some(c => c !== ''))
      .map(row => validateRow({
        name:         String(row[nameCol]    || '').trim(),
        phone:        String(row[phoneCol]   || '').trim().replace(/\s+/g, ''),
        credit_limit: parseFloat(row[limitCol]   || 0) || 30000,
        balance:      parseFloat(row[balanceCol] || 0) || 0,
      }));
  }

  // ── Parse CSV ─────────────────────────────────────────────
  function parseCsv(text) {
    const lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    return parseSheetRows(lines);
  }

  // ── Validate a single row ─────────────────────────────────
  function validateRow(row) {
    const errors = [];
    if (!row.name || row.name.length < 2)          errors.push('Name missing');
    if (!row.phone || row.phone.length < 7)         errors.push('Phone invalid');
    if (isNaN(row.credit_limit) || row.credit_limit < 0) errors.push('Limit invalid');
    return {
      ...row,
      phone: row.phone.replace(/\D/g, ''), // digits only
      valid: errors.length === 0,
      error: errors.join(', '),
    };
  }

  // ── Render preview table ──────────────────────────────────
  function renderPreview(rows) {
    document.getElementById('import-dropzone').classList.add('hidden');
    document.getElementById('import-preview').classList.remove('hidden');

    const valid   = rows.filter(r => r.valid).length;
    const invalid = rows.filter(r => !r.valid).length;

    document.getElementById('import-count').textContent = valid + ' customers ready to import';

    const errEl = document.getElementById('import-errors');
    if (invalid > 0) {
      errEl.textContent = invalid + ' rows have errors (shown in red)';
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }

    const tbody = document.getElementById('import-tbody');
    tbody.innerHTML = rows.map((r, i) => `
      <tr class="${r.valid ? '' : 'import-row-error'}">
        <td>${r.name || '—'}</td>
        <td>${r.phone || '—'}</td>
        <td>₹${Math.round(r.credit_limit).toLocaleString('en-IN')}</td>
        <td>${r.balance > 0 ? '₹' + Math.round(r.balance).toLocaleString('en-IN') : '—'}</td>
        <td>${r.valid ? '✅' : '<span class="import-err-icon" title="' + r.error + '">⚠️</span>'}</td>
      </tr>
    `).join('');

    if (valid > 0) {
      document.getElementById('btn-confirm-import').classList.remove('hidden');
      document.getElementById('btn-confirm-import').textContent = 'Import ' + valid + ' Customers';
    }
  }

  // ── Do import ─────────────────────────────────────────────
  document.getElementById('btn-confirm-import').addEventListener('click', async () => {
    const validRows = parsedRows.filter(r => r.valid);
    if (!validRows.length) return;

    document.getElementById('import-preview').classList.add('hidden');
    document.getElementById('btn-confirm-import').classList.add('hidden');
    document.getElementById('btn-cancel-import').classList.add('hidden');
    document.getElementById('import-progress').classList.remove('hidden');

    const bar      = document.getElementById('import-bar');
    const labelEl  = document.getElementById('import-progress-label');
    let done = 0;

    for (const row of validRows) {
      try {
        await DB.addCustomer(row.name, row.phone, row.credit_limit);

        // If they have an existing balance, add it as a credit sale
        if (row.balance > 0) {
          const customers = DB.getCustomers();
          const added = customers.find(c => c.phone === row.phone || c.name === row.name);
          if (added) await DB.addTransaction(added.id, 'sale', row.balance);
        }
      } catch { /* skip duplicates */ }

      done++;
      const pct = Math.round((done / validRows.length) * 100);
      bar.style.width = pct + '%';
      labelEl.textContent = `Importing ${done} of ${validRows.length}...`;
      await new Promise(r => setTimeout(r, 80)); // small delay so bar animates
    }

    labelEl.textContent = '✅ All done! ' + done + ' customers imported.';
    setTimeout(() => {
      close();
      if (typeof renderDashboard === 'function') renderDashboard();
      else location.reload();
      showToast(done + ' customers imported successfully!', 'success');
    }, 1200);
  });

  document.getElementById('btn-cancel-import').addEventListener('click', close);

  return { open, close };
})();
