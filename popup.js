// SOQL Extractor and Analyzer - Popup Script (MV3)
// Author: Rajiv Bhatt (original), updated for MV3

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let allQueryData  = [];   // { query, count, lines[] }
let allObjectData = [];   // { object, count }
let rawLines      = [];
let sortByCount   = true;
let queryFilter   = '';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar    = document.getElementById('status-message');
const statusEl     = document.getElementById('status-bar');
const resultsEl    = document.getElementById('results');
const noLogEl      = document.getElementById('no-log');

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initToolbar();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) {
      showError('Could not access the active tab.');
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId: tabs[0].id }, func: extractLogFromPage },
      (results) => {
        if (chrome.runtime.lastError) {
          showError('Cannot access this page. Open a Salesforce debug log.');
          return;
        }
        if (!results || !results[0] || !results[0].result) {
          showNoLog();
          return;
        }
        processLog(results[0].result);
      }
    );
  });
});

// ─── Injected into the page to extract log text ───────────────────────────────
function extractLogFromPage() {
  // Try classic Salesforce (LEX + Classic)
  const codeBlocks = document.getElementsByClassName('codeBlock');
  if (codeBlocks && codeBlocks.length > 0) {
    return codeBlocks[0].innerText || codeBlocks[0].textContent;
  }
  // Try pre tags that might contain the log
  const pres = document.querySelectorAll('pre');
  for (const pre of pres) {
    const text = pre.innerText || pre.textContent;
    if (text && text.includes('SOQL_EXECUTE_BEGIN')) return text;
  }
  // Try any div/textarea that has the log
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.value && ta.value.includes('SOQL_EXECUTE_BEGIN')) return ta.value;
  }
  return null;
}

// ─── Core Analysis ────────────────────────────────────────────────────────────
function processLog(logText) {
  if (!logText || !logText.trim()) { showNoLog(); return; }

  rawLines = logText.split('\n');

  const queryCountMap  = new Map();  // query string → count
  const queryLinesMap  = new Map();  // query string → [line numbers]
  const objectCountMap = new Map();  // object name → count

  let soqlTotal = 0;

  rawLines.forEach((line, idx) => {
    if (!line.includes('SOQL_EXECUTE_BEGIN')) return;

    const parts = line.split('|');
    // Format: timestamp|SOQL_EXECUTE_BEGIN|...|...|<query>
    // The query is usually the last meaningful segment
    const query = extractQuery(parts);
    if (!query) return;

    soqlTotal++;

    // Count query occurrences
    queryCountMap.set(query, (queryCountMap.get(query) || 0) + 1);
    if (!queryLinesMap.has(query)) queryLinesMap.set(query, []);
    queryLinesMap.get(query).push(idx + 1);

    // Extract object name from query
    const objName = extractObjectName(query);
    if (objName) {
      objectCountMap.set(objName, (objectCountMap.get(objName) || 0) + 1);
    }
  });

  // Build sorted arrays
  allQueryData = [...queryCountMap.entries()]
    .map(([query, count]) => ({ query, count, lines: queryLinesMap.get(query) || [] }))
    .sort((a, b) => b.count - a.count);

  allObjectData = [...objectCountMap.entries()]
    .map(([object, count]) => ({ object, count }))
    .sort((a, b) => b.count - a.count);

  const uniqueQueries  = allQueryData.length;
  const totalExec      = allQueryData.reduce((s, r) => s + r.count, 0);
  const objectsQueried = allObjectData.length;

  // Update summary cards
  document.getElementById('total-unique-queries').textContent = uniqueQueries;
  document.getElementById('total-executions').textContent     = totalExec;
  document.getElementById('total-objects').textContent        = objectsQueried;
  document.getElementById('limit-usage').textContent         = `${totalExec}/100`;

  const limitCard = document.getElementById('limit-card');
  if (totalExec >= 100) {
    limitCard.style.background = '#f8d7da';
    limitCard.style.borderColor = '#f5c6cb';
    document.getElementById('limit-usage').style.color = '#d93025';
  } else if (totalExec >= 80) {
    limitCard.style.background = '#fff3cd';
  } else {
    limitCard.style.background = '#d4edda';
    limitCard.style.borderColor = '#c3e6cb';
    document.getElementById('limit-usage').style.color = '#1e8e3e';
  }

  // Status bar
  statusEl.className = 'status-bar status-ok';
  statusBar.textContent = uniqueQueries === 0
    ? '✓ Log parsed — no SOQL queries found.'
    : `✓ Found ${uniqueQueries} unique quer${uniqueQueries === 1 ? 'y' : 'ies'} across ${totalExec} execution${totalExec === 1 ? '' : 's'}`;

  renderQueryList();
  renderObjectList();
  renderRawLog();

  noLogEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
}

// ─── Extract query text from log line parts ───────────────────────────────────
function extractQuery(parts) {
  if (parts.length < 5) return null;
  // The query is at index 4 in classic SF format, sometimes index 5+
  // Try from index 4 onwards, pick the first part that looks like a SOQL query
  for (let i = 4; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.match(/^(SELECT|FROM|WHERE|UPDATE|INSERT|DELETE|UPSERT)/i)) {
      // Possibly fragmented — join remaining parts
      return parts.slice(i).join('|').trim();
    }
  }
  // Fallback: last non-empty segment
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
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#9aa0a6;">No queries match your search.</div>';
    return;
  }

  const maxCount = filtered[0].count;

  container.innerHTML = filtered.map(({ query, count, lines }) => {
    const countClass = count >= 10 ? 'high-count' : count >= 5 ? 'mid-count' : '';
    const displayQuery = filter ? highlight(escapeHTML(query), filter) : escapeHTML(query);
    const lineInfo = lines.length > 0
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
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#9aa0a6;">No object data found.</div>';
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
    lines = lines.filter(l =>
      l.includes('SOQL_EXECUTE_BEGIN') || l.includes('SOQL_EXECUTE_END')
    );
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
    const soqlOnly = document.getElementById('soql-only-toggle').checked;
    renderRawLog(this.value, soqlOnly);
  });

  document.getElementById('soql-only-toggle').addEventListener('change', function () {
    const rawFilter = document.getElementById('raw-search').value;
    renderRawLog(rawFilter, this.checked);
  });
}

// ─── State helpers ────────────────────────────────────────────────────────────
function showError(msg) {
  statusEl.className = 'status-bar status-error';
  statusBar.textContent = '⚠ ' + msg;
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
