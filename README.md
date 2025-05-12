# Cingoz Playwright Browser Controller

This application is a simple API server that uses [Playwright](https://playwright.dev/) and [Express](https://expressjs.com/) to control a browser instance. It allows you to programmatically navigate to a URL, perform click operations using CSS or XPath selectors, click elements based on their text content, and send keyboard events.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
    - [Set URL](#set-url)
    - [Click Element](#click-element)
    - [Click by Text](#click-by-text)
    - [Enter Keyboard Key](#enter-keyboard-key)
- [Graceful Shutdown](#graceful-shutdown)
- [Customization](#customization)

## Features

- Launches a Chromium browser instance using Playwright.
- Provides multiple API endpoints to:
    - Navigate to a given URL.
    - Click elements using CSS selectors or XPath.
    - Click elements based on exact or partial text matches.
    - Send keyboard events to emulate key presses.
- Uses Express middleware to parse JSON request bodies.
- Implements error handling with informative messages.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your_username/your_repository.git
   cd your_repository
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configuration (Optional):**

    - Modify the port in `app.js` if necessary.
    - Adjust any Playwright options such as headless mode or timeouts as needed.

## Usage

Start the server using nodemon or node:

```bash
npm start
```

When the server starts, it will launch a Chromium browser instance and listen on the configured port (default is `3000`). You can then interact with the API endpoints using tools like curl or Postman.


## Customization

- **Port Configuration:** Adjust the `port` variable in `app.js` to run the server on a different port.
- **Headless Mode:** Change the `headless` option in the `chromium.launch()` function to run the browser in headless mode if only server-side operations are needed.
- **Timeouts and Delay:** Modify timeout settings and keyboard delay values as required for your testing or automation needs.

---

