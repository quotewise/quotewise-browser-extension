# Quotewise Chrome Extension

A Chrome extension for capturing quotes from web sources and adding them to the Quotewise database.

## Overview

This extension allows authenticated Quotewise admin users to capture quotes directly from web pages (initially Twitter/X) with full context, engagement metrics, and proper attribution - all without expensive API costs.

## Features (MVP)

- **Quote Capture**: Extract quotes from individual Twitter/X tweets
- **Originator Search**: Find and select the correct quote author
- **Duplicate Detection**: Check for existing quotes before submission
- **Engagement Metrics**: Capture likes, retweets, and other platform metrics
- **Attribution Levels**: Specify confidence in attribution (Direct, Popularized, Disputed)

## Project Structure

```
quotewise-chrome-extension/
├── docs/delivery/          # PBI documentation and tasks
├── manifest.json           # Chrome extension configuration
├── background/             # Service worker scripts
├── content/               # Content scripts for web pages
├── popup/                 # Extension popup interface
├── api/                   # Quotewise API client
└── icons/                 # Extension icons
```

## Development Setup

1. Clone this repository
2. Open Chrome/Brave and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory
5. The extension icon should appear in your toolbar

## Authentication

The extension requires:
1. An active session on quotosaurus.com
2. Admin privileges for quote creation

## API Integration

This extension works with the Quotewise API endpoints defined in PBI-22 of the main Quotewise project:
- Originator search
- Quote addition with duplicate handling
- Duplicate checking

## Platform Support

### Current (MVP)
- Twitter/X (platform code: TX)

### Planned
- Instagram (IG)
- LinkedIn (LI)
- Reddit (RD)
- Generic web pages

## Contributing

See the [Product Backlog](./docs/delivery/backlog.md) for planned features and improvements.

## Development Guidelines

- Follow the PBI process defined in docs/delivery/
- Test on both Chrome and Brave browsers
- Ensure all API calls handle errors gracefully
- Maintain user privacy - only capture necessary data

## Security Considerations

- No storage of user credentials
- All API calls use existing session authentication
- Minimal permissions requested
- Data transmitted only to quotosaurus.com

## License

[License details to be determined]