// SOQL Extractor and Analyzer - Content Script
// Detects Salesforce debug log pages and notifies the extension

(function () {
  'use strict';

  // Check if this page looks like a Salesforce debug log
  function isDebugLogPage() {
    const codeBlocks = document.getElementsByClassName('codeBlock');
    if (codeBlocks && codeBlocks.length > 0) return true;

    // Also check page URL patterns
    const url = window.location.href;
    return url.includes('ApexDebugLogDetailEdit') || url.includes('p/setup/layout/ApexDebugLogDetailEdit');
  }

  if (isDebugLogPage()) {
    // Signal background that we're on a debug log page (no-op in MV3 — popup is always available via action)
    // Optionally inject UI enhancements inline
    injectLogFilterUI();
  }

  function injectLogFilterUI() {
    const breadcrumb = document.getElementsByClassName('ptBreadcrumb');
    if (!breadcrumb || breadcrumb.length === 0) return;

    const breadcrumbNode = breadcrumb[0];
    if (document.getElementById('soql-analyzer-options')) return; // already injected

    // Store original log content
    const codeBlocks = document.getElementsByClassName('codeBlock');
    if (!codeBlocks || codeBlocks.length === 0) return;
    const originalLog = codeBlocks[0].innerHTML;

    // Hidden field to store original
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'soql-analyzer-original-log';
    hidden.value = originalLog;
    breadcrumbNode.appendChild(hidden);

    // Options panel
    const panel = document.createElement('div');
    panel.id = 'soql-analyzer-options';
    panel.style.cssText = 'margin:8px 0; padding:8px; background:#e8f4fd; border:1px solid #6678b1; border-radius:4px; font-family:Arial,sans-serif; font-size:12px;';

    const LOG_TYPES = [
      'USER_DEBUG', 'SOQL_EXECUTE_BEGIN', 'SOQL_EXECUTE_END',
      'METHOD_ENTRY', 'METHOD_EXIT', 'SYSTEM_METHOD_ENTRY', 'SYSTEM_METHOD_EXIT',
      'WF_RULE_EVAL_BEGIN', 'WF_RULE_EVAL_END', 'WF_FORMULA',
      'WF_CRITERIA_BEGIN', 'WF_CRITERIA_END', 'WF_RULE_FILTER',
      'WF_SPOOL_ACTION_BEGIN', 'WF_SPOOL_ACTION_END',
      'DML_BEGIN', 'DML_END',
      'VF_DESERIALIZE_VIEWSTATE_BEGIN', 'VF_DESERIALIZE_VIEWSTATE_END'
    ];

    let checkboxesHTML = LOG_TYPES.map(t =>
      `<label style="margin-right:12px; white-space:nowrap;"><input type="checkbox" class="soql-log-filter-cb" data-type="${t}"> ${t}</label>`
    ).join('');

    panel.innerHTML = `
      <label style="font-weight:bold; cursor:pointer;">
        <input type="checkbox" id="soql-filter-toggle"> Filter Log by Type
      </label>
      <div id="soql-filter-options" style="display:none; margin-top:8px; padding:8px; background:#fff; border:1px solid #ccd; border-radius:3px;">
        <div style="margin-bottom:6px; display:flex; flex-wrap:wrap; gap:4px 0;">
          ${checkboxesHTML}
        </div>
        <button id="soql-select-all" style="margin-right:6px; padding:2px 8px;">Select All</button>
        <button id="soql-clear-all" style="padding:2px 8px;">Clear All</button>
      </div>
    `;

    breadcrumbNode.appendChild(panel);

    // Event: toggle filter panel
    document.getElementById('soql-filter-toggle').addEventListener('change', function () {
      const opts = document.getElementById('soql-filter-options');
      if (this.checked) {
        opts.style.display = 'block';
        applyFilter();
      } else {
        opts.style.display = 'none';
        codeBlocks[0].innerHTML = document.getElementById('soql-analyzer-original-log').value;
      }
    });

    // Event: checkbox changes
    panel.querySelectorAll('.soql-log-filter-cb').forEach(cb => {
      cb.addEventListener('change', applyFilter);
    });

    // Select/Clear All
    document.getElementById('soql-select-all').addEventListener('click', () => {
      panel.querySelectorAll('.soql-log-filter-cb').forEach(cb => { cb.checked = true; });
      applyFilter();
    });
    document.getElementById('soql-clear-all').addEventListener('click', () => {
      panel.querySelectorAll('.soql-log-filter-cb').forEach(cb => { cb.checked = false; });
      applyFilter();
    });

    function applyFilter() {
      const checked = Array.from(panel.querySelectorAll('.soql-log-filter-cb:checked')).map(cb => cb.dataset.type);
      const logEl = codeBlocks[0];
      const lines = document.getElementById('soql-analyzer-original-log').value.split('\n');

      if (checked.length === 0) {
        logEl.innerHTML = document.getElementById('soql-analyzer-original-log').value;
        return;
      }

      const filtered = lines.filter(line => checked.some(t => line.includes(t)));
      logEl.innerHTML = filtered.join('\n');
    }
  }
})();
