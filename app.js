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

// --- Helper Function for Pre-Click Waits ---
async function performPreClickWaits(pageInstance) {
    if (!pageInstance) {
        console.error("Error in performPreClickWaits: Playwright page is not initialized.");
        throw new Error("Playwright page is not initialized.");
    }
    try {
        console.log("Waiting for network idle before click...");
        await pageInstance.waitForLoadState('networkidle', { timeout: 30000 }); // 30-second timeout
    } catch (e) {
        console.warn(`Warning: Timeout or error during waitForLoadState('networkidle'): ${e.message}. Proceeding with click attempt.`);
    }
    console.log("Waiting for an additional 5 seconds for page rendering...");
    await pageInstance.waitForTimeout(5000); // Changed to 5000ms (5 seconds) as per original requirement
    console.log("Pre-click waits complete.");
}
// ------------------------------------------

// --- Helper function to parse customSelector string ---
function parseCustomSelector(customSelectorString) {
    const attributes = {};
    if (!customSelectorString || typeof customSelectorString !== 'string') {
        return attributes;
    }
    const parts = customSelectorString.split(';').map(p => p.trim()).filter(p => p);

    // The first part is tagName if it doesn't contain '='
    if (parts.length > 0 && !parts[0].includes('=')) {
        attributes.tagFromSelector = parts.shift(); // Use a distinct key to avoid conflict with 'tagName' from body
    }

    parts.forEach(part => {
        const firstEqualSign = part.indexOf('=');
        if (firstEqualSign > 0) { // Ensure there's a key and a value
            const key = part.substring(0, firstEqualSign).trim();
            const value = part.substring(firstEqualSign + 1).trim();
            attributes[key] = value;
        }
    });
    return attributes;
}
// ----------------------------------------------------

// --- Helper function to build Playwright Locator from parsed attributes ---
async function buildPlaywrightLocator(currentPage, parsedAttributes, originalTagNameFromBody) {
    let baseLocator = currentPage;
    let targetLocator;

    const tag = parsedAttributes.tagFromSelector || originalTagNameFromBody || '*';

    // 1. Handle closestId first to set the baseLocator context
    if (parsedAttributes.closestId) {
        baseLocator = currentPage.locator(`#${parsedAttributes.closestId}`);
        if (await baseLocator.count() === 0) {
            throw new Error(`Closest anchor element with ID '${parsedAttributes.closestId}' not found.`);
        }
    }

    // 2. Prioritize strong unique identifiers
    if (parsedAttributes.id) {
        targetLocator = baseLocator.locator(`#${parsedAttributes.id}`);
    } else if (parsedAttributes['data-testid']) {
        targetLocator = baseLocator.locator(`${tag}[data-testid="${parsedAttributes['data-testid']}"]`);
    } else if (parsedAttributes['data-cy']) {
        targetLocator = baseLocator.locator(`${tag}[data-cy="${parsedAttributes['data-cy']}"]`);
    } else if (parsedAttributes['data-qa']) {
        targetLocator = baseLocator.locator(`${tag}[data-qa="${parsedAttributes['data-qa']}"]`);
    } // Add other common data-test-* attributes if needed

    // 3. ARIA attributes
    else if (parsedAttributes.role) {
        const options = {};
        // Accessible name can come from textContent, aria-label, etc.
        if (parsedAttributes.text) options.name = parsedAttributes.text;
        else if (parsedAttributes['aria-label']) options.name = parsedAttributes['aria-label'];
        // If exact is needed, or other properties like level, checked, pressed, use them here.
        targetLocator = baseLocator.getByRole(parsedAttributes.role, options);
    } else if (parsedAttributes['aria-label']) {
        targetLocator = baseLocator.getByLabel(parsedAttributes['aria-label']);
    }

    // 4. Text content (if not used as accessible name for role/label)
    else if (parsedAttributes.text) {
        // Prefer combining tag with text for specificity if possible
        if (tag !== '*') {
            // Try locator(tag).filter({hasText: ...}) first
            const specificLocator = baseLocator.locator(tag).filter({ hasText: parsedAttributes.text });
            if (await specificLocator.count() > 0) {
                targetLocator = specificLocator;
            } else {
                // Fallback to broader getByText if specific tag + text not found
                targetLocator = baseLocator.getByText(parsedAttributes.text);
            }
        } else {
            targetLocator = baseLocator.getByText(parsedAttributes.text);
        }
    }

    // 5. Fallback to constructing a CSS selector from tag, name, and classes
    else if (tag !== '*' || parsedAttributes.name || parsedAttributes.classes) {
        let cssString = tag === '*' && (parsedAttributes.name || parsedAttributes.classes) ? '' : tag; // Avoid starting with '*' if other attrs exist
        if (parsedAttributes.name) {
            cssString += `[name="${parsedAttributes.name}"]`;
        }
        if (parsedAttributes.classes) {
            parsedAttributes.classes.split(',')
                .map(cls => cls.trim())
                .filter(cls => cls)
                .forEach(cls => { cssString += `.${cls}`; });
        }
        if (cssString && cssString !== '*') { // Ensure we have a meaningful CSS string
            targetLocator = baseLocator.locator(cssString);
        } else if (cssString === '*' && baseLocator !== currentPage) { // e.g. closestId used, now find any '*' descendant
            targetLocator = baseLocator.locator('*'); // likely too broad, but follows logic
        }
    }

    if (!targetLocator) {
        // If after all logic, targetLocator is still undefined, it means we couldn't form a strategy.
        // This could happen if customSelector is empty, or only contains 'closestId' with no other target info.
        if (baseLocator !== currentPage && Object.keys(parsedAttributes).filter(k => k !== 'closestId' && k !== 'tagFromSelector').length === 0) {
            throw new Error(`Custom selector provided only a 'closestId' or 'tagFromSelector' without specific target attributes within it.`);
        }
        throw new Error('Could not determine a valid Playwright locator from the provided custom attributes.');
    }

    return targetLocator;
}
// -----------------------------------------------------------------


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
        const response = await page.goto(navigate_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`Navigation finished with status: ${response?.status() ?? 'unknown'}`);
        const title = await page.title();
        console.log(`Page title: ${title}`);
        await page.bringToFront();
        return res.status(200).send({ message: `Successfully navigated to ${navigate_url}`, page_title: title });
    } catch (error) {
        console.error(`Error navigating to ${navigate_url}:`, error);
        return res.status(500).send({ error: 'Failed to navigate', details: error.message });
    }
});

// Endpoint to click by XPath
app.post('/click/xpath', async (req, res) => {
    const { xpath } = req.body;
    if (!page) return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    if (!xpath || typeof xpath !== 'string') return res.status(400).send({ error: 'Missing or invalid xpath in request body' });

    console.log(`Attempting to click element using XPath: ${xpath}`);
    try {
        await performPreClickWaits(page);
        const finalXPath = xpath.startsWith('xpath=') ? xpath : `xpath=${xpath}`;
        const locator = page.locator(finalXPath);
        if (await locator.count() === 0) return res.status(404).send({ error: `Element not found for XPath: ${xpath}` });
        await locator.first().click({ timeout: 15000 });
        console.log(`Successfully clicked element with XPath: ${xpath}`);
        return res.status(200).send({ message: `Successfully clicked element with XPath: ${xpath}` });
    } catch (error) {
        console.error(`Error clicking XPath ${xpath}:`, error);
        if (error.name === 'TimeoutError') return res.status(408).send({ error: 'Timeout: Element not clickable or not found in time', selector_type: 'XPath', selector: xpath, details: error.message });
        return res.status(500).send({ error: 'Failed to click element with XPath', selector_type: 'XPath', selector: xpath, details: error.message });
    }
});

// Endpoint to click by CSS Selector
app.post('/click/css', async (req, res) => {
    const { cssSelector } = req.body;
    if (!page) return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    if (!cssSelector || typeof cssSelector !== 'string') return res.status(400).send({ error: 'Missing or invalid cssSelector in request body' });

    console.log(`Attempting to click element using CSS Selector: ${cssSelector}`);
    try {
        await performPreClickWaits(page);
        const locator = page.locator(cssSelector);
        if (await locator.count() === 0) return res.status(404).send({ error: `Element not found for CSS Selector: ${cssSelector}` });
        await locator.first().click({ timeout: 15000 });
        console.log(`Successfully clicked element with CSS Selector: ${cssSelector}`);
        return res.status(200).send({ message: `Successfully clicked element with CSS Selector: ${cssSelector}` });
    } catch (error) {
        console.error(`Error clicking CSS Selector ${cssSelector}:`, error);
        if (error.name === 'TimeoutError') return res.status(408).send({ error: 'Timeout: Element not clickable or not found in time', selector_type: 'CSS', selector: cssSelector, details: error.message });
        return res.status(500).send({ error: 'Failed to click element with CSS Selector', selector_type: 'CSS', selector: cssSelector, details: error.message });
    }
});

// Endpoint to click by Text Content
app.post('/click/text', async (req, res) => {
    const { textContent, tagName } = req.body;
    if (!page) return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    if (typeof textContent !== 'string') return res.status(400).send({ error: 'Missing or invalid textContent (must be a string) in request body' });
    if (tagName && typeof tagName !== 'string') return res.status(400).send({ error: 'Invalid tagName in request body, must be a string if provided' });

    let selectorDescription = `textContent: "${textContent}"`;
    if (tagName) selectorDescription += `, tagName: "${tagName}"`;
    console.log(`Attempting to click element by ${selectorDescription}`);

    try {
        await performPreClickWaits(page);
        let locator;
        if (tagName) {
            locator = page.locator(tagName, { hasText: textContent });
        } else {
            locator = page.getByText(textContent);
        }
        if (textContent === "" && !tagName) console.warn("Warning: Clicking based on empty textContent without a tagName is broad.");

        if (await locator.count() === 0) {
            if (tagName && textContent === "") {
                const preciseEmptyXPath = `xpath=//${tagName}[normalize-space(.)=""]`;
                locator = page.locator(preciseEmptyXPath);
            }
            if (await locator.count() === 0) return res.status(404).send({ error: `Element not found matching ${selectorDescription}` });
        }
        await locator.first().click({ timeout: 15000 });
        console.log(`Successfully clicked element by ${selectorDescription}`);
        return res.status(200).send({ message: `Successfully clicked element by ${selectorDescription}` });
    } catch (error) {
        console.error(`Error clicking element by ${selectorDescription}:`, error);
        if (error.name === 'TimeoutError') return res.status(408).send({ error: 'Timeout: Element not clickable or not found in time', selector_criteria: selectorDescription, details: error.message });
        return res.status(500).send({ error: 'Failed to click element', selector_criteria: selectorDescription, details: error.message });
    }
});

// --- NEW ENDPOINT for Custom Selector ---
app.post('/click/custom', async (req, res) => {
    // Expecting the full elementData object which includes customSelector and original tagName
    const { customSelector, tagName } = req.body;

    if (!page) {
        return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    }
    if (!customSelector || typeof customSelector !== 'string') {
        return res.status(400).send({ error: 'Missing or invalid customSelector (string) in request body' });
    }
    // tagName from the original element data is a helpful fallback.

    console.log(`Attempting to click element using Custom Selector: "${customSelector}", Original Tag: "${tagName}"`);

    try {
        await performPreClickWaits(page);
        const parsedAttributes = parseCustomSelector(customSelector);
        const locator = await buildPlaywrightLocator(page, parsedAttributes, tagName);

        if (!locator) { // Should be caught by error in buildPlaywrightLocator, but as a safeguard
            return res.status(400).send({ error: 'Failed to construct a Playwright locator from custom selector.', customSelector, parsedAttributes });
        }

        const count = await locator.count();
        if (count === 0) {
            return res.status(404).send({ error: `Element not found for Custom Selector: "${customSelector}"`, parsed_attributes: parsedAttributes });
        }
        // if (count > 1) { // Log if multiple elements are found, Playwright clicks the first by default.
        //     console.warn(`Custom selector "${customSelector}" resolved to ${count} elements. Clicking the first one.`);
        // }
        await locator.first().click({ timeout: 15000 }); // Use .first() to be explicit.

        console.log(`Successfully clicked element with Custom Selector: "${customSelector}"`);
        return res.status(200).send({ message: `Successfully clicked element with Custom Selector: "${customSelector}"` });
    } catch (error) {
        console.error(`Error clicking with Custom Selector "${customSelector}":`, error);
        if (error.name === 'TimeoutError') {
            return res.status(408).send({ error: 'Timeout: Element not clickable or not found in time for custom selector.', customSelector, details: error.message });
        }
        // Errors from buildPlaywrightLocator will also be caught here
        return res.status(500).send({ error: `Failed to click element with Custom Selector.`, customSelector, details: error.message });
    }
});
// --------------------------------------

// Endpoint to enter keyboard key (existing)
app.post('/enter-keyboard', async (req, res) => {
    const { enter_value } = req.body;
    if (!enter_value || typeof enter_value !== 'string') return res.status(400).send({ error: 'Missing or invalid enter_value in request body' });
    if (!page) return res.status(500).send({ error: 'Playwright page is not initialized yet.' });
    console.log(`Typing value: "${enter_value}" using the keyboard.`);
    try {
        await page.keyboard.press(enter_value, { delay: 100 });
        console.log(`Successfully entered value: "${enter_value}"`);
        return res.status(200).send({ message: `Successfully entered value: "${enter_value}"` });
    } catch (error) {
        console.error(`Error typing value "${enter_value}":`, error);
        return res.status(500).send({ error: 'Failed to type value', details: error.message });
    }
});

// app.post('/initialize-playwright', async (req, res) => {
//     try {
//         await initializePlaywright();
//         return res.status(200).send({ message: 'Playwright browser initialized successfully.' });
//     } catch (error) {
//         console.error('Failed to initialize Playwright via API:', error);
//         return res.status(500).send({ error: 'Failed to initialize Playwright', details: error.message });
//     }
// });

// Restart the Playwright browser via API
app.post('/restart-browser', async (req, res) => {
    try {
        if (browser) {
            await browser.close();
            browser = null;
            context = null;
            page = null;
            console.log('Browser closed for restart.');
        }

        await initializePlaywright();
        console.log('Browser restarted.');
        return res.status(200).send({ message: 'Browser restarted successfully.' });
    } catch (error) {
        console.error('Failed to restart browser:', error);
        return res.status(500).send({ error: 'Failed to restart browser', details: error.message });
    }
});


// --- Initialization and Server Start ---
async function initializePlaywright() {
    try {
        console.log("Launching browser...");
        browser = await chromium.launch({ headless: false });
        context = await browser.newContext();
        page = await context.newPage();
        await page.bringToFront();
        console.log("Browser launched with a blank page.");
    } catch (error) {
        console.error("FATAL: Failed to initialize Playwright:", error);
        process.exit(1);
    }
}

async function startServer() {
    await initializePlaywright();
    app.listen(port, () => {
        console.log(`Playwright API server listening on http://localhost:${port}`);
        console.log("Endpoints:");
        console.log(`  POST /set-url         (Body: { "navigate_url": "..." })`);
        console.log(`  POST /click/xpath     (Body: { "xpath": "...", ... })`);
        console.log(`  POST /click/css       (Body: { "cssSelector": "...", ... })`);
        console.log(`  POST /click/text      (Body: { "textContent": "...", "tagName": "optional", ... })`);
        console.log(`  POST /click/custom    (Body: { "customSelector": "...", "tagName": "optional", ... })`); // New endpoint
        console.log(`  POST /enter-keyboard  (Body: { "enter_value": "..." })`);
    });
}

// --- Graceful Shutdown ---
async function shutdown() {
    console.log("\nShutting down server and browser...");
    if (page) try { await page.close(); console.log("Page closed."); } catch (e) { console.error("Error closing page:", e); }
    if (context) try { await context.close(); console.log("Browser context closed."); } catch (e) { console.error("Error closing context:", e); }
    if (browser) try { await browser.close(); console.log("Browser closed."); } catch (e) { console.error("Error closing browser:", e); }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();