const { chromium } = require('playwright');
const express = require('express');
const app = express();
const port = 3000; // You can change this port if needed

// --- Global Playwright Variables ---
let browser = null;
let context = null;
let page = null;
// ------------------------------------

// --- Middleware ---
// To parse JSON request bodies
app.use(express.json());
// -----------------

// --- API Endpoints ---

// Endpoint to set the URL
app.post('/set-url', async (req, res) => {
    const { navigate_url } = req.body;

    if (!navigate_url || typeof navigate_url !== 'string') {
        return res.status(400).send({ error: 'Missing or invalid navigate_url in request body' });
    }

    if (!page) {
        return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    }

    console.log(`Navigating to: ${navigate_url}`);
    try {
        // Wait for navigation to complete
        const response = await page.goto(navigate_url, { waitUntil: 'domcontentloaded' }); // 'load' or 'domcontentloaded' or 'networkidle'
        console.log(`Navigation finished with status: ${response?.status() ?? 'unknown'}`);
        const title = await page.title();
        console.log(title); // Outputs: Playwright
        return res.status(200).send({ message: `Successfully navigated to ${navigate_url}` , page_title : title});
    } catch (error) {
        console.error(`Error navigating to ${navigate_url}:`, error);
        return res.status(500).send({ error: 'Failed to navigate', details: error.message });
    }
});

// Endpoint to perform a click
app.post('/click', async (req, res) => {
    const { event } = req.body;

    if (!event) {
        return res.status(400).send({ error: 'Missing event data in request body' });
    }

    // Prioritize CSS selector, fall back to XPath
    const cssSelector = event.cssSelector;
    const xpathSelector = event.xpath;
    const textContent = event.textContent; // Optional: for logging

    let selectorToUse = null;
    let selectorType = null;

    if (cssSelector && typeof cssSelector === 'string') {
        selectorToUse = cssSelector;
        selectorType = 'CSS';
    } else if (xpathSelector && typeof xpathSelector === 'string') {
        // Playwright's XPath needs to start with 'xpath='
        selectorToUse = `xpath=${xpathSelector}`;
        selectorType = 'XPath';
    }

    if (!selectorToUse) {
        return res.status(400).send({ error: 'No valid cssSelector or xpath provided in the event data' });
    }

    if (!page) {
        return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    }

    console.log(`Attempting to click element using ${selectorType}: ${selectorToUse}`);
    if(textContent) {
        console.log(`(Element text content hint: ${textContent})`);
    }

    try {
        // Wait for the selector to be available and click it
        // Potential navigation is handled automatically by Playwright's click
        await page.click(selectorToUse, { timeout: 15000 }); // Add a reasonable timeout
        console.log(`Successfully clicked element: ${selectorToUse}`);
        // It's hard to know for sure if navigation occurred without more complex checks,
        // but the click promise resolves after the action initiates it.
        // Subsequent requests will operate on the potentially new page state.
        return res.status(200).send({ message: `Successfully clicked element using ${selectorType}` });
    } catch (error) {
        console.error(`Error clicking element ${selectorToUse}:`, error);
        // Check for common errors
        if (error.message.includes('timeout')) {
            return res.status(404).send({ error: 'Element not found or not visible/interactable within timeout', selector: selectorToUse, details: error.message });
        }
        if (error.message.includes('selector error')) {
            return res.status(400).send({ error: 'Invalid selector syntax', selector: selectorToUse, details: error.message });
        }
        return res.status(500).send({ error: 'Failed to click element', selector: selectorToUse, details: error.message });
    }
});

// Endpoint to enter keyboard key
app.post('/enter-keyboard', async (req, res) => {
    const { enter_value } = req.body;

    // Validate the input
    if (!enter_value || typeof enter_value !== 'string') {
        return res.status(400).send({ error: 'Missing or invalid enter_value in request body' });
    }

    if (!page) {
        return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    }

    console.log(`Typing value: "${enter_value}" using the keyboard.`);

    try {
        // Type the given value using the keyboard
        await page.keyboard.press(enter_value, { delay: 100 }); // Adjust delay if needed
        console.log(`Successfully entered value: "${enter_value}"`);
        return res.status(200).send({ message: `Successfully entered value: "${enter_value}"` });
    } catch (error) {
        console.error(`Error typing value "${enter_value}":`, error);
        return res.status(500).send({ error: 'Failed to type value', details: error.message });
    }
});

// --- Initialization and Server Start ---

async function initializePlaywright() {
    try {
        console.log("Launching browser...");
        browser = await chromium.launch({ headless: false }); // Launch visible browser
        context = await browser.newContext();
        page = await context.newPage();
        console.log("Browser launched with a blank page.");
        // You could navigate to an initial page here if needed, like about:blank
        // await page.goto('about:blank');
    } catch (error) {
        console.error("FATAL: Failed to initialize Playwright:", error);
        process.exit(1); // Exit if browser fails to launch
    }
}

async function startServer() {
    await initializePlaywright();

    app.listen(port, () => {
        console.log(`Playwright API server listening on http://localhost:${port}`);
        console.log("Endpoints:");
        console.log(`  POST /set-url   (Body: { "navigate_url": "..." , "page_title": "..."})`);
        console.log(`  POST /click     (Body: { "event": { "cssSelector": "...", "xpath": "..." } })`);
    });
}

// --- Graceful Shutdown ---
async function shutdown() {
    console.log("\nShutting down server and browser...");
    if (browser) {
        try {
            await browser.close();
            console.log("Browser closed.");
        } catch (error) {
            console.error("Error closing browser:", error);
        }
    }
    process.exit(0);
}

process.on('SIGINT', shutdown); // Handle Ctrl+C
process.on('SIGTERM', shutdown); // Handle kill commands

// --- Start the application ---
startServer();
// ---------------------------