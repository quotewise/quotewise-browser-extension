# PBI-1: MVP Chrome Extension for Quote Capture

## Overview
Create a Chrome extension that allows admin users to capture quotes from web pages (initially Twitter/X) and add them to the Quotewise database with proper attribution and engagement metrics.

## Problem Statement
Currently, capturing quotes from social media requires either expensive API access or manual copying. A Chrome extension can leverage authenticated browser sessions to capture quotes with full context and engagement metrics, bypassing API costs while maintaining data quality.

## User Stories
- As an admin user, I want to capture a quote from a Twitter/X tweet so that I can add it to Quotewise without manual copying
- As an admin user, I want to search for and select the correct originator so that quotes are properly attributed
- As an admin user, I want the extension to check for duplicates so that I don't create redundant entries
- As an admin user, I want engagement metrics captured automatically so that I can track quote popularity

## Technical Approach

### Extension Architecture
```
quotewise-chrome-extension/
├── manifest.json           # Chrome extension configuration
├── package.json           # Node dependencies and build scripts
├── tsconfig.json          # TypeScript configuration
├── src/                   # TypeScript source files
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── twitter.ts    # Twitter-specific content script
│   │   └── common.ts      # Shared utilities
│   ├── popup/
│   │   ├── popup.ts       # Popup logic
│   │   └── popup.html     # Popup UI (stays HTML)
│   ├── api/
│   │   └── quotewise-api.ts  # API client
│   └── types/
│       ├── chrome.d.ts    # Chrome API type extensions
│       ├── api.d.ts       # Quotewise API types
│       └── index.d.ts     # Shared type definitions
├── dist/                  # Compiled JavaScript output
│   ├── background/
│   ├── content/
│   ├── popup/
│   └── api/
├── public/                # Static assets
│   ├── popup.html         # Popup HTML
│   ├── popup.css          # Popup styles
│   └── icons/             # Extension icons
└── tests/                 # Jest tests
    └── *.test.ts
```

### Data Flow
1. User navigates to individual tweet URL
2. Content script extracts tweet data (text, author, metrics, URL)
3. User clicks extension icon to open popup
4. Popup displays extracted quote with editable text field
5. User searches for originator (API call to quotosaurus.com)
6. User selects attribution confidence level
7. Extension checks for duplicates
8. Quote added via API with appropriate status

### Key Features
- **Tweet Data Extraction**: Full text, author, likes, retweets, date
- **Originator Search**: Real-time search with confidence scoring
- **Duplicate Detection**: Check before submission with similarity feedback
- **Attribution Levels**: Direct, Popularized, Disputed
- **Clean URLs**: Remove tracking parameters, normalize format

## UX/UI Considerations
- Single-click capture from tweet page
- Visual feedback for duplicate detection
- Clear attribution confidence selector
- Minimal UI - focus on quick capture
- Success/error states clearly indicated

## Acceptance Criteria
- [ ] Extension captures full tweet text from individual tweet pages
- [ ] Originator search returns relevant results from API
- [ ] Duplicate checking prevents exact duplicates
- [ ] Near-duplicates create new versions
- [ ] Engagement metrics (likes, retweets) captured and stored
- [ ] Tweet URL cleaned and stored as QuoteSighting
- [ ] Extension requires authentication with quotosaurus.com
- [ ] Added quotes have ADMIN_REVIEWED workflow status
- [ ] Platform code "TX" correctly set for Twitter/X

## Dependencies
- Quotewise API endpoints (PBI-22) must be deployed
- User must be logged into quotosaurus.com
- Admin privileges required for API access

## Open Questions
- Should we capture tweet screenshots for archive purposes?
- How should we handle quote tweets (quotes of quotes)?
- Should thread context be captured in MVP or later?

## Related Tasks
- Task 1-1: Setup Chrome extension project structure
- Task 1-2: Implement Twitter content script
- Task 1-3: Create popup interface
- Task 1-4: Implement API client
- Task 1-5: Add authentication check
- Task 1-6: Implement originator search
- Task 1-7: Add duplicate checking
- Task 1-8: Handle quote submission
- Task 1-9: Add error handling and feedback
- Task 1-10: Create extension icons and branding