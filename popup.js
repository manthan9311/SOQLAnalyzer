// Author: Manthan Shah

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let allQueryData  = [];   // { query, count, lines[] }
let allObjectData = [];   // { object, count }
let rawLines      = [];
let sortByCount   = true;
let queryFilter   = '';
let activeSource  = 'page'; // 'page' | 'file'

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar       = document.getElementById('status-message');
const statusEl        = document.getElementById('status-bar');
const resultsEl       = document.getElementById('results');
const noLogEl         = document.getElementById('no-log');
const fileUploadPanel = document.getElementById('file-upload-panel');
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const fileLoadedBar   = document.getElementById('file-loaded-bar');
const fileLoadedName  = document.getElementById('file-loaded-name');

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initToolbar();
  initSourceTabs();
  initFileUpload();

  // Auto-scan live page on load
  scanLivePage();
});

// ─── Source Tab Switching ─────────────────────────────────────────────────────
function initSourceTabs() {
  document.getElementById('src-page-btn').addEventListener('click', () => {
    if (activeSource === 'page') return;
    activeSource = 'page';
    document.getElementById('src-page-btn').classList.add('active');
    document.getElementById('src-file-btn').classList.remove('active');
    fileUploadPanel.classList.add('hidden');
    resetResults();
    scanLivePage();
  });

  document.getElementById('src-file-btn').addEventListener('click', () => {
    if (activeSource === 'file') return;
    activeSource = 'file';
    document.getElementById('src-file-btn').classList.add('active');
    document.getElementById('src-page-btn').classList.remove('active');
    fileUploadPanel.classList.remove('hidden');
    resetResults();
    // If a file was already loaded, re-show its results
    if (fileInput.files && fileInput.files[0]) {
      readFile(fileInput.files[0]);
    } else {
      statusEl.className = 'status-bar status-loading';
      statusBar.textContent = 'Select a .log or .txt file to analyze.';
      noLogEl.classList.add('hidden');
    }
  });
}

// ─── File Upload & Drag-Drop ──────────────────────────────────────────────────
function initFileUpload() {
  // Click on drop zone opens file picker
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  // File picker change
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      readFile(fileInput.files[0]);
    }
  });

  // Drag events
  dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', (e) => { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!isValidFileType(file)) {
      showError('Please drop a .log or .txt file.');
      return;
    }
    readFile(file);
  });

  // Clear button
  document.getElementById('file-clear-btn').addEventListener('click', () => {
    fileInput.value = '';
    fileLoadedBar.classList.add('hidden');
    dropZone.classList.remove('hidden');
    resetResults();
    statusEl.className = 'status-bar status-loading';
    statusBar.textContent = 'Select a .log or .txt file to analyze.';
  });
}

function isValidFileType(file) {
  return file.name.endsWith('.log') || file.name.endsWith('.txt') || file.type === 'text/plain';
}

function readFile(file) {
  if (!isValidFileType(file)) {
    showError(`"${file.name}" is not a supported file type. Use .log or .txt.`);
    return;
  }

  statusEl.className = 'status-bar status-loading';
  statusBar.textContent = `Reading "${file.name}"…`;

  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target.result;
    if (!text || !text.trim()) {
      showError('The file appears to be empty.');
      return;
    }
    if (!text.includes('SOQL_EXECUTE_BEGIN') && !text.includes('SOQL_EXECUTE_END')) {
      showError(`"${file.name}" doesn't look like a Salesforce debug log (no SOQL events found).`);
      return;
    }

    // Show loaded file indicator
    dropZone.classList.add('hidden');
    fileLoadedBar.classList.remove('hidden');
    fileLoadedName.textContent = `📄 ${file.name} (${formatBytes(file.size)})`;

    processLog(text, `file: ${file.name}`);
  };

  reader.onerror = () => {
    showError(`Could not read "${file.name}". Make sure the file is accessible.`);
  };

  reader.readAsText(file);
}

// ─── Live Page Scan ───────────────────────────────────────────────────────────
function scanLivePage() {
  statusEl.className = 'status-bar status-loading';
  statusBar.textContent = 'Scanning page for debug log…';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) {
      showError('Could not access the active tab.');
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId: tabs[0].id }, func: extractLogFromPage },
      (results) => {
        if (chrome.runtime.lastError) {
          showError('Cannot access this page. Open a Salesforce debug log, or use Local File mode.');
          return;
        }
        if (!results || !results[0] || !results[0].result) {
          showNoLog();
          return;
        }
        processLog(results[0].result, 'live page');
      }
    );
  });
}

// ─── Injected into the page to extract log text ───────────────────────────────
function extractLogFromPage() {
  const codeBlocks = document.getElementsByClassName('codeBlock');
  if (codeBlocks && codeBlocks.length > 0) {
    return codeBlocks[0].innerText || codeBlocks[0].textContent;
  }
  const pres = document.querySelectorAll('pre');
  for (const pre of pres) {
    const text = pre.innerText || pre.textContent;
    if (text && text.includes('SOQL_EXECUTE_BEGIN')) return text;
  }
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.value && ta.value.includes('SOQL_EXECUTE_BEGIN')) return ta.value;
  }
  return null;
}

// ─── Core Analysis ────────────────────────────────────────────────────────────
function processLog(logText, source) {
  if (!logText || !logText.trim()) { showNoLog(); return; }

  rawLines = logText.split('\n');

  const queryCountMap  = new Map();
  const queryLinesMap  = new Map();
  const objectCountMap = new Map();

  rawLines.forEach((line, idx) => {
    if (!line.includes('SOQL_EXECUTE_BEGIN')) return;

    const parts = line.split('|');
    const query = extractQuery(parts);
    if (!query) return;

    queryCountMap.set(query, (queryCountMap.get(query) || 0) + 1);
    if (!queryLinesMap.has(query)) queryLinesMap.set(query, []);
    queryLinesMap.get(query).push(idx + 1);

    const objName = extractObjectName(query);
    if (objName) {
      objectCountMap.set(objName, (objectCountMap.get(objName) || 0) + 1);
    }
  });

  allQueryData = [...queryCountMap.entries()]
    .map(([query, count]) => ({ query, count, lines: queryLinesMap.get(query) || [] }))
    .sort((a, b) => b.count - a.count);

  allObjectData = [...objectCountMap.entries()]
    .map(([object, count]) => ({ object, count }))
    .sort((a, b) => b.count - a.count);

  const uniqueQueries  = allQueryData.length;
  const totalExec      = allQueryData.reduce((s, r) => s + r.count, 0);
  const objectsQueried = allObjectData.length;

  document.getElementById('total-unique-queries').textContent = uniqueQueries;
  document.getElementById('total-executions').textContent     = totalExec;
  document.getElementById('total-objects').textContent        = objectsQueried;
  document.getElementById('limit-usage').textContent          = `${totalExec}/100`;

  const limitCard     = document.getElementById('limit-card');
  const limitValueEl  = document.getElementById('limit-usage');
  if (totalExec >= 100) {
    limitCard.style.cssText  = 'background:#f8d7da; border-color:#f5c6cb;';
    limitValueEl.style.color = '#d93025';
  } else if (totalExec >= 80) {
    limitCard.style.cssText  = 'background:#fff3cd; border-color:#ffc107;';
    limitValueEl.style.color = '#e37400';
  } else {
    limitCard.style.cssText  = 'background:#d4edda; border-color:#c3e6cb;';
    limitValueEl.style.color = '#1e8e3e';
  }

  statusEl.className = 'status-bar status-ok';
  statusBar.textContent = uniqueQueries === 0
    ? `✓ Log parsed (${source}) — no SOQL queries found.`
    : `✓ Found ${uniqueQueries} unique quer${uniqueQueries === 1 ? 'y' : 'ies'} · ${totalExec} execution${totalExec === 1 ? '' : 's'} · source: ${source}`;

  renderQueryList();
  renderObjectList();
  renderRawLog();

  noLogEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
}

// ─── Extract query text from log line parts ───────────────────────────────────
function extractQuery(parts) {
  if (parts.length < 5) return null;
  for (let i = 4; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.match(/^(SELECT|FROM|WHERE|UPDATE|INSERT|DELETE|UPSERT)/i)) {
      return parts.slice(i).join('|').trim();
    }
  }
  for (let i = parts.length - 1; i >= 4; i--) {
    const p = parts[i].trim();
    if (p.length > 0) return p;
  }
  return null;
}

// ─── Extract object name from SOQL ───────────────────────────────────────────
function extractObjectName(query) {
  const match = query.match(/\bFROM\s+([A-Za-z0-9_]+)/i);
  return match ? match[1] : null;
}

// ─── Render Queries Tab ───────────────────────────────────────────────────────
function renderQueryList() {
  const container = document.getElementById('query-list');
  const filter = queryFilter.toLowerCase();

  let data = [...allQueryData];
  if (!sortByCount) data.sort((a, b) => a.query.localeCompare(b.query));

  const filtered = filter ? data.filter(r => r.query.toLowerCase().includes(filter)) : data;

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa0a6;">No queries match your search.</div>';
    return;
  }

  container.innerHTML = filtered.map(({ query, count, lines }) => {
    const countClass   = count >= 10 ? 'high-count' : count >= 5 ? 'mid-count' : '';
    const displayQuery = filter ? highlight(escapeHTML(query), filter) : escapeHTML(query);
    const lineInfo     = lines.length > 0
      ? `<span style="font-size:9px;color:#9aa0a6;display:block;margin-top:2px;">Line${lines.length > 1 ? 's' : ''}: ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? '…' : ''}</span>`
      : '';
    return `
      <div class="data-row ${countClass}">
        <div class="data-query">${displayQuery}${lineInfo}</div>
        <div class="data-count">
          <span class="count-badge">${count}</span>
          <span class="count-label">exec${count !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');
}

// ─── Render Objects Tab ───────────────────────────────────────────────────────
function renderObjectList() {
  const container = document.getElementById('object-list');

  if (allObjectData.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa0a6;">No object data found.</div>';
    return;
  }

  const maxCount = allObjectData[0].count;

  container.innerHTML = allObjectData.map(({ object, count }) => {
    const barWidth = Math.round((count / maxCount) * 100);
    return `
      <div class="obj-row">
        <div class="obj-name">${escapeHTML(object)}</div>
        <div class="obj-bar-wrap"><div class="obj-bar" style="width:${barWidth}%"></div></div>
        <div class="obj-count">${count}</div>
      </div>`;
  }).join('');
}

// ─── Render Raw Log Tab ───────────────────────────────────────────────────────
function renderRawLog(filter = '', soqlOnly = true) {
  const el = document.getElementById('raw-log-view');
  let lines = rawLines;

  if (soqlOnly) {
    lines = lines.filter(l => l.includes('SOQL_EXECUTE_BEGIN') || l.includes('SOQL_EXECUTE_END'));
  }
  if (filter) {
    lines = lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
  }

  el.innerHTML = lines.map(line => {
    const safe = escapeHTML(line);
    if (line.includes('SOQL_EXECUTE')) return `<span class="hl-soql">${safe}</span>`;
    if (line.includes('USER_DEBUG'))   return `<span class="hl-debug">${safe}</span>`;
    if (line.includes('DML_'))         return `<span class="hl-dml">${safe}</span>`;
    if (line.includes('METHOD_'))      return `<span class="hl-method">${safe}</span>`;
    return safe;
  }).join('\n') || '<span style="color:#9aa0a6">No matching log lines.</span>';
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
  });
}

// ─── Toolbar wiring ───────────────────────────────────────────────────────────
function initToolbar() {
  document.getElementById('query-search').addEventListener('input', function () {
    queryFilter = this.value;
    renderQueryList();
  });

  document.getElementById('sort-by-count').addEventListener('click', function () {
    sortByCount = !sortByCount;
    this.textContent = sortByCount ? 'Sort: Count ↓' : 'Sort: A-Z';
    renderQueryList();
  });

  document.getElementById('raw-search').addEventListener('input', function () {
    renderRawLog(this.value, document.getElementById('soql-only-toggle').checked);
  });

  document.getElementById('soql-only-toggle').addEventListener('change', function () {
    renderRawLog(document.getElementById('raw-search').value, this.checked);
  });
}

// ─── State helpers ────────────────────────────────────────────────────────────
function resetResults() {
  allQueryData  = [];
  allObjectData = [];
  rawLines      = [];
  queryFilter   = '';
  resultsEl.classList.add('hidden');
  noLogEl.classList.add('hidden');
}

function showError(msg) {
  statusEl.className = 'status-bar status-error';
  statusBar.textContent = '⚠ ' + msg;
  noLogEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
}

function showNoLog() {
  statusEl.className = 'status-bar status-error';
  statusBar.textContent = 'No Salesforce debug log detected on this page.';
  noLogEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(html, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

