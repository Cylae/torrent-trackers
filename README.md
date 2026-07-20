# Torrent Trackers Status Dashboard

A vanilla HTML, CSS, and JavaScript dashboard for tracking the uptime and status of various torrent trackers.

## Features

- **Real-time Status:** Displays current status, uptime percentages over 24 hours, 7 days, and 30 days.
- **Visual Timelines:** 24-hour timeline graphs with color-coded periods for easy visualization of downtime incidents.
- **Detailed History:** Tooltips displaying start time, end time, and errors for previous incidents.
- **Dark Mode:** Supports OS-level preferred color scheme and includes a manual toggle button that saves user preference to `localStorage`.
- **Auto-Refresh Indicator:** Visually displays the time remaining until the next data fetch (every 30 seconds).
- **Incident Prioritization:** Automatically sorts trackers experiencing issues (`down` or `degraded`) to the top of the view.
- **CountAPI Integration:** Displays unique and total visitor hits for the current month and globally.

## Architecture

This project is entirely static and requires no build tools, package managers, or server-side execution. It uses modern Vanilla JS, CSS3, and HTML5.

### Core Files:
- `index.html`: The markup structure, meta tags (OpenGraph/Twitter cards), and initial layout.
- `styles.css`: All styling, including responsive layouts using CSS Grid/Flexbox and CSS custom properties (variables) for theme management.
- `app.js`: The application logic responsible for fetching data, DOM manipulation, formatting, building UI components programmatically, toggling themes, and managing the refresh countdown.
- `status.json`: The data source containing historical and real-time status data for various targets, sub-targets, and external providers.

## Deployment

To deploy this dashboard, simply serve the directory containing the HTML, CSS, JS, and JSON files using any static file server (e.g., Nginx, Apache, GitHub Pages, Vercel, or a simple python HTTP server).

```bash
# Example using Python 3
python3 -m http.server 8000
```
Navigate to `http://localhost:8000` to view the dashboard.

## `status.json` Schema Structure

The application consumes data from a `status.json` file. Here is an overview of the expected structure:

- `updated_at` (string, ISO-8601): When the JSON was last generated.
- `overall_status` (string): Current total status (e.g., "up", "down", "degraded").
- `retention_days` (number): Number of days history is kept.
- `targets` (array): Array of objects representing the tracked services.
  - `key` (string): Unique identifier.
  - `label` (string): Display name.
  - `status` (string): Current status ("up", "down", "unknown").
  - `down_since` (string|null): Timestamp if currently down.
  - `current_downtime_seconds` (number|null): Duration in seconds if down.
  - `last_error` (string|null): Message for the error if down.
- `incidents` (array): Array of historical incidents for the targets.
- `external_status` (array): Array of data from external sources (e.g., Uptime Kuma) related to the tracked targets.
