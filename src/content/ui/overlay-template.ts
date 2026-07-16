// Static Shadow-DOM markup + styles for the capture overlay bar, extracted from
// overlay-bar.ts to keep that orchestrator legible. The only dynamic value is the
// platform label; everything else is a constant template.
export function buildOverlayMarkup(platformLabel: string): string {
    return `
      <style>
        :host { all: initial; }
        .container {
          pointer-events: auto;
          transform: translateY(0);
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .container[aria-hidden="true"] {
          transform: translateY(-100%);
          opacity: 0.6;
        }
        .bar, .capture-row {
          box-sizing: border-box;
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 8px 12px;
          background: #0f172a;
          color: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          line-height: 18px;
        }
        .bar {
          border-bottom: 1px solid rgba(255,255,255,0.08);
          min-height: 44px;
        }
        .capture-row {
          background: #1e293b;
          border-bottom: 1px solid rgba(255,255,255,0.12);
          display: none;
          padding: 0;
        }
        .capture-row.expanded {
          display: block;
        }
        .capture-row-content {
          display: flex;
          flex-direction: column;
        }
        .quote-preview-row, .originator-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 8px 12px;
        }
        .quote-preview-row {
          background: rgba(15,23,42,0.26);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .quote-preview {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .quote-text {
          flex: 1 1 auto;
          min-width: 0;
          max-height: calc(1.45em * 5);
          padding: 7px 10px;
          border-left: 3px solid #60a5fa;
          border-radius: 6px;
          background: rgba(15,23,42,0.56);
          color: #f8fafc;
          font-size: 14px;
          font-style: normal;
          font-weight: 500;
          line-height: 20px;
          overflow-y: auto;
          overflow-x: hidden;
          overflow-wrap: anywhere;
          white-space: pre-line;
        }
        .quote-text-muted {
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 400;
        }
        .clear-selection {
          background: rgba(239,68,68,0.2);
          color: #f87171;
          border: none;
          border-radius: 4px;
          padding: 2px 6px;
          cursor: pointer;
          font-size: 11px;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .clear-selection:hover {
          background: rgba(239,68,68,0.3);
        }
        .section {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .left { flex: 0 0 auto; }
        .center {
          flex: 1 1 auto;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }
        .right {
          flex: 0 0 auto;
          gap: 6px;
          align-self: flex-start;
          margin-left: auto;
        }
        .originator-row .section.right {
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
          width: min(240px, 34vw);
          min-width: 190px;
        }
        .originator-row .section.right button {
          width: 100%;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
          color: #e2e8f0;
          font-weight: 600;
          white-space: nowrap;
        }
        .badge.protected { background: rgba(234,179,8,0.15); color: #facc15; }
        .badge.success { background: rgba(34,197,94,0.2); color: #4ade80; }
        .badge.warning { background: rgba(251,146,60,0.2); color: #fb923c; }
        .badge.error { background: rgba(239,68,68,0.2); color: #f87171; }
        .badge.info { background: rgba(59,130,246,0.2); color: #60a5fa; }
        .badge.label {
          background: transparent;
          padding: 0;
          color: #94a3b8;
          font-weight: 600;
        }
        .duplicate-badge.has-passages {
          display: flex;
          flex-wrap: wrap;
          max-width: min(520px, 48vw);
          border-radius: 8px;
          white-space: normal;
        }
        .passages-panel {
          flex: 1 0 100%;
          min-width: 0;
          color: #dbeafe;
          font-size: 11px;
          font-weight: 400;
          line-height: 15px;
        }
        .passages-heading {
          margin-top: 2px;
          font-weight: 700;
        }
        .passages-list {
          display: grid;
          gap: 2px;
          margin: 4px 0 0;
          padding-left: 18px;
        }
        .passages-list li,
        .passages-list a {
          overflow-wrap: anywhere;
        }
        .passages-list a {
          color: #bfdbfe;
        }
        .passages-more {
          margin-top: 3px;
          color: #bfdbfe;
          font-weight: 600;
        }
        .text {
          min-width: 0;
          white-space: pre-line;
          max-height: calc(1.35em * 8);
          overflow-y: auto;
          overflow-x: hidden;
        }
        .source-text {
          color: #cbd5e1;
          font-size: 12px;
          line-height: 17px;
          overflow-wrap: anywhere;
        }
        button {
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
          cursor: pointer;
          font-size: 12px;
          line-height: 16px;
        }
        button:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
        button:focus-visible {
          outline: 2px solid #93c5fd;
          outline-offset: 2px;
        }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: #2563eb; color: #fff; }
        button.primary:hover:not(:disabled) { background: #1d4ed8; }
        button.success { background: #16a34a; color: #fff; }
        button.success:hover:not(:disabled) { background: #15803d; }
        button.warning { background: #ea580c; color: #fff; }
        button.warning:hover:not(:disabled) { background: #c2410c; }
        .toggle {
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
        }
        /* The ⚙ glyph's ink sits below its line-box center, so it reads low even when flex-centered;
           nudge the glyph (not the button/circle) up ~1px for optical centering. */
        .toggle .gear-glyph {
          display: block;
          line-height: 1;
          transform: translateY(-1px);
        }
        #account-menu-btn {
          padding: 0;
          font-size: 23px;
          line-height: 1;
        }
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .capture-progress {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 5px;
          color: #cbd5e1;
          font-size: 12px;
          line-height: 16px;
          white-space: normal;
        }
        .capture-progress.error {
          display: inline-flex;
          flex-direction: row;
          flex-wrap: wrap;
          color: #fecaca;
        }
        .progress-track {
          position: relative;
          width: 100%;
          height: 3px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255,255,255,0.16);
        }
        .progress-copy {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .progress-text {
          color: #e2e8f0;
          font-weight: 600;
        }
        .progress-secondary {
          color: #94a3b8;
          font-size: 11px;
          line-height: 15px;
        }
        .progress-bar {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 38%;
          border-radius: 999px;
          background: #93c5fd;
          animation: progress-slide 0.9s ease-in-out infinite;
        }
        .progress-retry {
          padding: 3px 7px;
          font-size: 11px;
        }
        @media (prefers-reduced-motion: reduce) {
          .container {
            transition: none;
          }
          .spinner {
            animation: none;
          }
          .progress-bar {
            animation: none;
            width: 100%;
            opacity: 0.65;
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes progress-slide {
          from { transform: translateX(-120%); }
          to { transform: translateX(260%); }
        }
        .originator-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .originator-name {
          font-weight: 500;
          color: #e2e8f0;
        }
        .originator-handle {
          color: #94a3b8;
          font-size: 12px;
        }
        .cache-indicator {
          color: #64748b;
          font-size: 11px;
          font-style: italic;
        }
        a.create-link {
          color: #fb923c;
          text-decoration: none;
        }
        a.create-link:hover {
          text-decoration: underline;
        }
        .status-text {
          color: #94a3b8;
          font-size: 12px;
        }
        .first-run-notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          background: rgba(37,99,235,0.15);
          color: #dbeafe;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .notice-dismiss {
          flex: 0 0 auto;
        }
        .check-now {
          margin-left: 8px;
        }
        .account-menu-wrap {
          position: relative;
        }
        .account-menu {
          position: absolute;
          top: 34px;
          right: 0;
          min-width: 190px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 6px;
          background: #111827;
          box-shadow: 0 12px 24px rgba(0,0,0,0.24);
          z-index: 1;
        }
        .account-menu[hidden] {
          display: none;
        }
        .account-menu .menu-status {
          padding: 6px 8px 4px;
          color: #94a3b8;
          font-size: 12px;
          line-height: 16px;
        }
        .account-menu button,
        .account-menu .menu-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
          padding: 7px 8px;
          border-radius: 4px;
          color: #e2e8f0;
          background: transparent;
          text-align: left;
        }
        .account-menu button:hover,
        .account-menu .menu-row:hover {
          background: rgba(255,255,255,0.10);
        }
        .similar-diff {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
          color: #dbeafe;
        }
        .similar-diff-text {
          min-width: 0;
        }
        .diff-token.added {
          text-decoration: underline;
          text-decoration-thickness: 2px;
        }
        .diff-token.removed {
          text-decoration: line-through;
          opacity: 0.86;
        }
            .similar-diff a {
              color: #93c5fd;
              white-space: nowrap;
            }
            .duplicate-badge a:focus-visible,
            .similar-diff a:focus-visible {
              outline: 2px solid #93c5fd;
              outline-offset: 2px;
            }
        .sighting-hint {
          color: #facc15;
          font-size: 12px;
        }
        .similar-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .similar-decision {
          font-size: 11px;
          padding: 3px 7px;
        }
        .collection-picker-slot {
          padding: 0 12px 8px 12px;
        }
        .collection-picker {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: #dbeafe;
          font-size: 12px;
          line-height: 16px;
        }
        .collection-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .collection-picker-label {
          font-weight: 650;
        }
        .collection-picker-list {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          max-height: 96px;
          overflow-y: auto;
        }
        .collection-picker-option {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 24px;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255,255,255,0.08);
        }
        .collection-picker-option input {
          margin: 0;
          accent-color: #2563eb;
        }
        .collection-picker-option span {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .collection-summary {
          order: 2;
          color: #94a3b8;
          font-size: 11px;
          line-height: 15px;
        }
        .collection-summary[hidden] {
          display: none;
        }
        .collection-picker-empty,
        .collection-picker-status,
        .collection-picker-already {
          color: #bfdbfe;
        }
        @media (prefers-contrast: more) {
          .diff-token.added,
          .diff-token.removed {
            outline: 1px solid currentColor;
            outline-offset: 1px;
          }
        }
      </style>
      <div class="container" aria-hidden="false">
        <div class="bar">
          <div class="section left">
            <div class="badge label" id="source-badge">Source</div>
            <div class="badge" id="platform-badge">${platformLabel}</div>
            <div class="badge protected" id="protected-badge" style="display:none;">Protected</div>
          </div>
          <div class="section center">
            <div class="text source-text" id="tweet-preview">Collecting source data…</div>
          </div>
          <div class="section right">
            <div class="account-menu-wrap" id="account-menu-wrap"></div>
            <button id="refresh-btn" aria-label="Refresh capture and collections" title="Refresh capture and collections">Refresh</button>
            <button class="toggle" id="close-btn" aria-label="Close capture tray (Esc)" title="Close (Esc)">×</button>
          </div>
        </div>
        <div class="capture-row" id="capture-row">
          <div class="capture-row-content">
            <div id="first-run-notice-container"></div>
            <div class="quote-preview-row">
              <div class="section left">
                <div class="badge label">Quote</div>
              </div>
              <div class="section center">
                <div class="quote-preview" id="quote-preview"></div>
              </div>
            </div>
            <div class="originator-row">
              <div class="section left">
                <div class="badge label">Originator</div>
              </div>
              <div class="section center">
                <div class="originator-info" id="originator-info">
                  <span class="status-text">Looking up originator...</span>
                </div>
              </div>
              <div class="section right">
                <div class="progress-indicator" id="progress-indicator"></div>
                <!-- Action button inserted dynamically by updateActionButton() -->
                <div id="collection-summary" class="collection-summary" aria-live="polite" hidden></div>
              </div>
            </div>
            <div class="collection-picker-slot" id="collection-picker-slot" hidden></div>
          </div>
        </div>
      </div>
    `;
}
