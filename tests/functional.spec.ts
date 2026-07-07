import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Define helper to setup console and network error tracking
function setupErrorTrackers(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkErrors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on('pageerror', exception => {
    pageErrors.push(`[Page Error] ${exception.message}\nStack: ${exception.stack}`);
  });

  page.on('requestfailed', request => {
    networkErrors.push(`[Network Error] ${request.url()} failed: ${request.failure()?.errorText}`);
  });

  page.on('response', response => {
    if (!response.ok()) {
      networkErrors.push(`[HTTP Error] ${response.url()} status: ${response.status()} ${response.statusText()}`);
    }
  });

  return {
    getErrors: () => ({
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      networkErrors: [...networkErrors],
      hasErrors: consoleErrors.length > 0 || pageErrors.length > 0 || networkErrors.length > 0
    }),
    clear: () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;
      networkErrors.length = 0;
    }
  };
}

// Helper to expand advanced options if collapsed
async function ensureOptionsExpanded(page: Page) {
  const optionsBody = page.locator('#optionsBody');
  const isCollapsed = await optionsBody.evaluate(el => el.classList.contains('collapsed'));
  if (isCollapsed) {
    await page.click('#optionsToggle');
    await expect(optionsBody).not.toHaveClass(/collapsed/);
  }
}

// Helper to take screenshots
async function takeScreenshot(page: Page, testName: string, suffix: string) {
  const dir = path.join(__dirname, '../test-screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${testName}_${suffix}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot saved: ${filePath}`);
}

test.describe('Prompt Optimizer Live Web App Tests', () => {
  const LIVE_URL = 'https://promptoptimizer.optiqo.dev/';

  test.beforeEach(async ({ page }) => {
    // Clear localStorage/sessionStorage to have a clean state for each test
    await page.goto(LIVE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => sessionStorage.clear());
  });

  // --- CASE A: Character-limit boundary ---
  test('Case A - Character-limit boundary', async ({ page }) => {
    const tracker = setupErrorTrackers(page);
    await page.goto(LIVE_URL);
    await page.waitForLoadState('networkidle');

    // Create a 50,000+ character string (mix of unbroken and normal)
    const unbrokenPart = 'A'.repeat(15000);
    const normalPart = ' This is normal text. '.repeat(1600);
    const largeInput = unbrokenPart + normalPart; // ~50k characters

    // 1. Paste/fill the text
    const rawPrompt = page.locator('#rawPrompt');
    await rawPrompt.fill(largeInput);

    // 2. Check if client enforces 5000 limit
    const filledValue = await rawPrompt.inputValue();
    console.log(`Case A: Raw prompt length after normal fill: ${filledValue.length}`);
    expect(filledValue.length).toBeLessThanOrEqual(5000);

    // Check if charCount UI shows 5000/5000
    const charCountText = await page.locator('#charCount').innerText();
    console.log(`Case A: Char count text: ${charCountText}`);
    expect(charCountText).toContain('5000');

    // Take layout screenshot of normal fill
    await takeScreenshot(page, 'case_a', 'normal_limit');

    // 3. Bypass the client limit using page.evaluate and trigger optimize
    await page.evaluate((val) => {
      const el = document.getElementById('rawPrompt') as HTMLTextAreaElement;
      el.removeAttribute('maxlength');
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, largeInput);

    const bypassedValue = await page.locator('#rawPrompt').inputValue();
    console.log(`Case A: Bypassed prompt length: ${bypassedValue.length}`);
    expect(bypassedValue.length).toBe(largeInput.length);

    const bypassedCharCountText = await page.locator('#charCount').innerText();
    console.log(`Case A: Bypassed Char count text: ${bypassedCharCountText}`);

    // Click optimize and observe network/UI response
    tracker.clear();
    const optimizeBtn = page.locator('#optimizeBtn');
    await expect(optimizeBtn).toBeEnabled();
    await optimizeBtn.click();

    // The backend API limits prompts to 30,000 characters. Sending 50,000 characters
    // should fail at the API level (400 Bad Request). Let's see if the UI handles it or hangs.
    console.log('Case A: Sent request, waiting for response or error...');
    await page.waitForTimeout(5000); // Wait to see if loader resolves or hangs

    const errors = tracker.getErrors();
    console.log('Case A Errors during submit:', errors);

    const progressContainerVisible = await page.locator('#progressContainer').isVisible();
    const isSpinnerRunning = await page.locator('.spinner').isVisible().catch(() => false);
    
    await takeScreenshot(page, 'case_a', 'after_bypass_submit');

    // Output findings: check if UI is stuck or displays error
    console.log(`Case A Progress Container Visible: ${progressContainerVisible}`);
    console.log(`Case A Spinner Visible: ${isSpinnerRunning}`);
    
    // We expect the app to display a clear error if the network request fails with 400
    const emptyStateText = await page.locator('#emptyStateText').innerText().catch(() => '');
    console.log(`Case A Empty state or error text: ${emptyStateText}`);
  });

  // --- CASE B: Variable parser edge cases ---
  test('Case B - Variable parser edge cases', async ({ page }) => {
    const tracker = setupErrorTrackers(page);

    // Mock `/api/optimize-prompt` to echo the raw prompt back so we can verify frontend placeholder rendering
    await page.route(url => url.pathname.includes('/api/optimize-prompt'), async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            optimized_prompt: `Here are the variables: ${body.prompt}`,
            explanation: "Mocked response for testing placeholder parsing."
          })
        });
      } else {
        await route.continue();
      }
    });

    const testInputs = [
      { name: 'nested_brackets', prompt: '{{{{nested_brackets}}}}' },
      { name: 'unclosed_variable', prompt: '{{unclosed_variable' },
      { name: 'empty_variable', prompt: '{{ }}' },
      { name: 'number_variable', prompt: '{{1234}}' },
      { name: 'special_chars', prompt: '{{ spaces and $pecial #chars ! }}' },
      { name: 'concurrency_50_vars', prompt: Array.from({ length: 50 }, (_, i) => `{{var${i + 1}}}`).join(' ') }
    ];

    for (const input of testInputs) {
      console.log(`\n--- Testing Variable Input: ${input.name} ---`);
      tracker.clear();
      await page.goto(LIVE_URL);
      await page.waitForLoadState('networkidle');

      // Ensure options are expanded, then select "Deep" quality
      await ensureOptionsExpanded(page);
      await page.click('div[data-group="quality"] button[data-value="deep"]');

      await page.fill('#rawPrompt', input.prompt);
      await page.click('#optimizeBtn');

      // Wait for output card to appear
      await page.waitForSelector('#prettyView', { state: 'visible' });

      // Open developer menu to toggle compiled preview
      await page.click('#devMenuBtn');
      await page.click('#previewBtn');

      // Check if variables placeholder inputs are rendered (if any were matched)
      const containerExists = await page.locator('#placeholderInputsContainer').isVisible().catch(() => false);
      console.log(`  Inputs container rendered: ${containerExists}`);

      if (containerExists) {
        // Take screenshot of placeholder form
        await takeScreenshot(page, input.name, 'vars_panel');

        // List detected variable labels
        const labels = await page.locator('.placeholder-inputs-grid label').allInnerTexts();
        console.log(`  Detected placeholder fields:`, labels);

        // Try to type into the first variable input field
        const firstInput = page.locator('.placeholder-inputs-grid input').first();
        if (await firstInput.isVisible()) {
          await firstInput.fill('TEST_VAL');
          const previewText = await page.locator('#rawView').innerText();
          console.log(`  Preview updated: ${previewText.includes('TEST_VAL') ? 'Yes' : 'No'}`);
        }
      }

      const errors = tracker.getErrors();
      if (errors.hasErrors) {
        console.error(`  [FAIL] Case B (${input.name}) triggered errors:`, errors);
      } else {
        console.log(`  [PASS] Case B (${input.name}) ran without JS or network exceptions.`);
      }
    }
  });

  // --- CASE C: API key / network edge cases ---
  test('Case C - API key & network edge cases', async ({ page }) => {
    const tracker = setupErrorTrackers(page);
    await page.goto(LIVE_URL);
    await page.waitForLoadState('networkidle');

    // 1. Enter malformed key and check spinner/error timeout
    console.log('\n--- Case C.1: Malformed API Key validation ---');
    await page.click('#apiBtn');
    await page.locator('#settingsModal').waitFor({ state: 'visible' });

    // Select Google provider (Gemini) instead of non-existent openai
    await page.selectOption('#settingsProvider', 'google');
    await page.locator('#settingsApiKeyGroup').waitFor({ state: 'visible' });
    await page.fill('#settingsApiKey', 'invalid_google_key_999');
    await page.click('#settingsSave');
    await page.locator('#settingsModal').waitFor({ state: 'hidden' });

    // Verify engine chip shows "google"
    const engineText = await page.locator('#engineChip').innerText();
    console.log(`Engine chip updated to: ${engineText}`);

    // Input prompt and optimize
    await page.fill('#rawPrompt', 'Optimize this simple prompt, please.');
    tracker.clear();
    await page.click('#optimizeBtn');

    // We expect the request to fail (due to fake API key) and a clear error to show
    // We wait up to 10 seconds to see if the error is displayed or if it hangs
    console.log('Waiting for API error response...');
    let errorDetected = false;
    let didHang = true;

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const isProgressVisible = await page.locator('#progressContainer').isVisible();
      const errorContent = await page.locator('#emptyStateText').innerText().catch(() => '');
      
      // If progress bar is gone, it resolved (either success or error)
      if (!isProgressVisible) {
        didHang = false;
        if (errorContent.toLowerCase().includes('failed') || errorContent.toLowerCase().includes('error') || errorContent.toLowerCase().includes('unauthorized') || errorContent.length > 50) {
          errorDetected = true;
          console.log(`Clear user error displayed in UI: "${errorContent}"`);
        }
        break;
      }
    }

    if (didHang) {
      console.log('[BUG] Loading state hangs on invalid API key!');
      await takeScreenshot(page, 'case_c', 'hung_loading');
    }
    expect(didHang).toBe(false);

    const errors = tracker.getErrors();
    console.log('Case C.1 Errors:', errors);

    // 2. Switching providers and checking persistence
    console.log('\n--- Case C.2: Switching providers and persistence ---');
    const providersToTest = [
      { id: 'google', key: 'gemini-key-567', model: 'gemini-pro' },
      { id: 'openrouter', key: 'or-key-890', model: 'meta-llama/llama-3' },
      { id: 'groq', key: 'gsk-groq111', model: 'mixtral-8x7b' },
      { id: 'custom', key: 'custom-key-222', model: 'my-custom-model', baseUrl: 'https://test.custom/v1' }
    ];

    for (const prov of providersToTest) {
      console.log(`Setting provider: ${prov.id}`);
      await page.click('#apiBtn');
      await page.locator('#settingsModal').waitFor({ state: 'visible' });

      await page.selectOption('#settingsProvider', prov.id);
      await page.locator('#settingsApiKeyGroup').waitFor({ state: 'visible' });
      await page.fill('#settingsApiKey', prov.key);
      
      if (prov.model) {
        const modelInput = page.locator('#settingsModel');
        if (await modelInput.isVisible()) {
          await modelInput.fill(prov.model);
        }
      }
      if (prov.baseUrl) {
        const baseUrlInput = page.locator('#settingsBaseUrl');
        if (await baseUrlInput.isVisible()) {
          await baseUrlInput.fill(prov.baseUrl);
        }
      }

      await page.click('#settingsSave');
      await page.locator('#settingsModal').waitFor({ state: 'hidden' });

      // Close and reopen modal to verify values persist in memory/DOM
      await page.click('#apiBtn');
      await page.locator('#settingsModal').waitFor({ state: 'visible' });
      
      expect(await page.locator('#settingsProvider').inputValue()).toBe(prov.id);
      expect(await page.locator('#settingsApiKey').inputValue()).toBe(prov.key);
      
      if (prov.model && await page.locator('#settingsModel').isVisible()) {
        expect(await page.locator('#settingsModel').inputValue()).toBe(prov.model);
      }
      if (prov.baseUrl && await page.locator('#settingsBaseUrl').isVisible()) {
        expect(await page.locator('#settingsBaseUrl').inputValue()).toBe(prov.baseUrl);
      }

      await page.click('#settingsCancel'); // Close settings

      // Reload page to verify persistence in localStorage
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.click('#apiBtn');
      await page.locator('#settingsModal').waitFor({ state: 'visible' });
      
      expect(await page.locator('#settingsProvider').inputValue()).toBe(prov.id);
      expect(await page.locator('#settingsApiKey').inputValue()).toBe(prov.key);
      
      if (prov.model && await page.locator('#settingsModel').isVisible()) {
        expect(await page.locator('#settingsModel').inputValue()).toBe(prov.model);
      }
      if (prov.baseUrl && await page.locator('#settingsBaseUrl').isVisible()) {
        expect(await page.locator('#settingsBaseUrl').inputValue()).toBe(prov.baseUrl);
      }
      
      await page.click('#settingsCancel');
      console.log(`  [PASS] Provider ${prov.id} settings persisted correctly after reload.`);
    }
  });

  // --- CASE D: Test Bench concurrency & library data corruption ---
  test('Case D - Test Bench concurrency & library corruption', async ({ page }) => {
    const tracker = setupErrorTrackers(page);
    await page.goto(LIVE_URL);
    await page.waitForLoadState('networkidle');

    // Mock API requests for Test Bench
    let requestCount = 0;
    await page.route(url => url.pathname.includes('/api/optimize-prompt'), async (route) => {
      const request = route.request();
      if (request.url().includes('/test')) {
        requestCount++;
        const currentReq = requestCount;
        console.log(`Mocking Test Bench API Request #${currentReq}`);
        // Simulate a network delay of 2 seconds for the comparison run using a native promise
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            original_output: `Output A for request #${currentReq}`,
            optimized_output: `Output B for request #${currentReq}`
          })
        });
      } else {
        // Normal optimize endpoint
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            optimized_prompt: 'Optimized: Test Bench Context',
            explanation: 'Optimized explanation'
          })
        });
      }
    });

    // 1. Setup - Optimize a prompt to enable dev menu and Test Bench button
    // Ensure advanced options are expanded and set Quality to "Deep" to match our mock
    await ensureOptionsExpanded(page);
    await page.click('div[data-group="quality"] button[data-value="deep"]');

    await page.fill('#rawPrompt', 'Test Bench Base Prompt');
    await page.click('#optimizeBtn');
    await page.waitForSelector('#prettyView', { state: 'visible' });

    // 2. Open Test Bench
    await page.click('#devMenuBtn');
    await page.click('#testBenchBtn');
    await page.locator('#benchPanel').waitFor({ state: 'visible' });

    // Fill in a sample input in the test bench
    await page.fill('#benchInput', 'Sample test input');

    // 3. Concurrency check: Trigger "Run comparison" rapidly multiple times in succession
    // We will bypass the UI disabled attribute by calling click programmatically in loop,
    // simulating a double/triple click race condition
    tracker.clear();
    console.log('Triggering rapid successive clicks on Run Comparison...');
    
    await page.evaluate(() => {
      const btn = document.getElementById('benchRun') as HTMLButtonElement;
      // Dispatch 3 click events consecutively in the same macro-task loop
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Wait for requests to complete (we have a 2s delay in the mock)
    console.log('Waiting for Test Bench requests to finish...');
    await page.waitForTimeout(6000);

    // Verify the latest request results are rendered, and they don't get swapped/overwritten by aborted ones
    const textA = await page.locator('#benchBodyA').innerText();
    const textB = await page.locator('#benchBodyB').innerText();
    console.log(`Rendered Results after rapid clicking:\n  Card A: "${textA}"\n  Card B: "${textB}"`);
    
    // We triggered 3 requests. Request #3 was the last one, so output should be "Output A/B for request #3"
    expect(textA).toBe('Output A for request #3');
    expect(textB).toBe('Output B for request #3');

    // Verify how many requests actually fired
    console.log(`Total concurrent API requests recorded: ${requestCount}`);
    
    // 4. Data Corruption check:
    // Let's test the library entry overwrite bug we identified!
    console.log('\n--- Testing library entry data-loss bug ---');
    
    // Pick Winner A for the first prompt run
    await page.click('#benchCardA .bench-pick');
    console.log('Picked Winner A for Prompt 1');

    // Check library state in localStorage
    let library = await page.evaluate(() => JSON.parse(localStorage.getItem('promptOptimizerLibrary') || '[]'));
    console.log('Library entries after first save:', library.length);
    expect(library.length).toBe(1);
    const firstSavedId = library[0].id;
    console.log(`Saved entry ID: ${firstSavedId}`);

    // Close Test Bench
    await page.click('#benchClose');

    // Now, optimize a second prompt
    await page.fill('#rawPrompt', 'Second prompt for Test Bench');
    await page.click('#optimizeBtn');
    await page.waitForSelector('#prettyView', { state: 'visible' });

    // Open Test Bench again
    await page.click('#devMenuBtn');
    await page.click('#testBenchBtn');
    await page.locator('#benchPanel').waitFor({ state: 'visible' });

    // Run comparison on the second prompt
    await page.click('#benchRun');
    await page.waitForTimeout(3000); // Wait for mock network response (2s delay)

    // Pick Winner B for the second prompt run
    await page.click('#benchCardB .bench-pick');
    console.log('Picked Winner B for Prompt 2');

    // Check library state in localStorage
    library = await page.evaluate(() => JSON.parse(localStorage.getItem('promptOptimizerLibrary') || '[]'));
    console.log('Library entries after second save:', library.length);
    
    // Verify if firstSavedId is still in the library
    const hasFirstEntry = library.some((e: any) => e.id === firstSavedId);
    console.log(`Is the first saved prompt still in the library? ${hasFirstEntry ? 'Yes' : 'NO (Silently Deleted!)'}`);

    await takeScreenshot(page, 'case_d', 'library_state');

    if (!hasFirstEntry) {
      console.error('[BUG CONFIRMED] Picking a winner in a new Test Bench session silently deletes the previous session\'s winner due to stale global `benchLibraryEntryId` variable!');
    }
    
    // If the library only has 1 item, and it's the second one, it's a bug!
    expect(library.length).toBe(2); // We expect both to be saved!
  });

  // --- CASE E: localStorage exhaustion ---
  test('Case E - localStorage exhaustion', async ({ page }) => {
    const tracker = setupErrorTrackers(page);
    await page.goto(LIVE_URL);
    await page.waitForLoadState('networkidle');

    console.log('\n--- Case E: localStorage exhaustion ---');
    // 1. Programmatically fill localStorage completely (crack-filling down to 1 byte)
    const fillResult = await page.evaluate(() => {
      localStorage.clear();
      let count = 0;
      let size = 1024 * 1024; // start with 1MB chunk
      let totalBytes = 0;
      while (size >= 1) {
        try {
          const chunk = 'X'.repeat(size);
          localStorage.setItem(`fill_chunk_${count}`, chunk);
          totalBytes += size;
          count++;
        } catch (e) {
          // If it fails, shrink the chunk size and try to fill the remaining space
          size = Math.floor(size / 2);
        }
      }
      return { success: true, size: (totalBytes / 1024).toFixed(2) + ' KB' };
    });
    console.log(`localStorage filled size: ${fillResult.size}`);

    // Check if we can write anything else - it should throw a QuotaExceededError even for a 1-character key
    const isQuotaExceeded = await page.evaluate(() => {
      try {
        localStorage.setItem('a', 'b');
        return false;
      } catch (e: any) {
        return e.name === 'QuotaExceededError' || e.message.toLowerCase().includes('quota') || e.code === 22;
      }
    });
    console.log(`Confirmed QuotaExceededError is thrown on write: ${isQuotaExceeded}`);

    // 2. Try to use the app normally
    tracker.clear();
    console.log('Toggling theme with full localStorage...');
    await page.click('#themeToggle'); // This writes to localStorage.setItem(THEME_KEY)
    let errors = tracker.getErrors();
    console.log('Errors after toggling theme:', errors);
    expect(errors.pageErrors.length).toBe(0);

    tracker.clear();
    console.log('Toggling advanced options with full localStorage...');
    await page.click('#optionsToggle'); // This writes to localStorage.setItem(OPTIONS_KEY)
    errors = tracker.getErrors();
    console.log('Errors after toggling options:', errors);
    expect(errors.pageErrors.length).toBe(0);

    // Try to open settings and save settings
    tracker.clear();
    console.log('Saving settings in modal with full localStorage...');
    await page.click('#apiBtn');
    await page.locator('#settingsModal').waitFor({ state: 'visible' });
    await page.selectOption('#settingsProvider', 'google');
    await page.fill('#settingsApiKey', 'fake-key-exhaustion');
    await page.click('#settingsSave'); // This writes to localStorage.setItem(SETTINGS_KEY)
    
    // Check if modal closes or hangs, and if error throws
    await page.waitForTimeout(1000);
    const isModalVisible = await page.locator('#settingsModal').isVisible();
    errors = tracker.getErrors();
    console.log(`Settings Modal Visible after Save: ${isModalVisible}`);
    console.log('Errors after saving settings:', errors);
    expect(errors.pageErrors.length).toBe(0);
    expect(isModalVisible).toBe(false);

    await takeScreenshot(page, 'case_e', 'settings_error');

    // 3. Bricking/Load failure check on next load
    console.log('\n--- Case E.3: Page load/bricking check with full localStorage ---');
    // Clear only the visitor ID so the page attempts to generate a new visitor ID and write to localStorage on boot
    await page.evaluate(() => {
      localStorage.removeItem('prompt_optimizer_visitor_id');
    });

    tracker.clear();
    console.log('Reloading page with full localStorage and missing visitor ID...');
    await page.reload();
    
    // Wait to see if page loads and is functional, or throws fatal boot errors
    await page.waitForTimeout(3000);
    const errorsOnLoad = tracker.getErrors();
    console.log('Errors on reload:', errorsOnLoad);
    expect(errorsOnLoad.pageErrors.length).toBe(0);

    const isAppHeaderVisible = await page.locator('.topbar').isVisible().catch(() => false);
    console.log(`Is App Header Visible after reload: ${isAppHeaderVisible}`);
    expect(isAppHeaderVisible).toBe(true);
    
    await takeScreenshot(page, 'case_e', 'after_reload');
  });

  // --- CASE F: Responsive/viewport checks ---
  test('Case F - Responsive check for small viewports (375px)', async ({ page }) => {
    // Set viewport to mobile width (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    console.log('\n--- Case F: Mobile Viewport (375px) ---');
    
    await page.goto(LIVE_URL);
    await page.waitForLoadState('networkidle');

    // Verify layout with a screenshot
    await takeScreenshot(page, 'case_f', 'init_mobile');

    // Check if horizontal scrollbar is present on the body
    const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const bodyClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    console.log(`Mobile Viewport Widths - Client: ${bodyClientWidth}px, Scroll: ${bodyScrollWidth}px`);
    if (bodyScrollWidth > bodyClientWidth) {
      console.log(`[BUG] Layout breaks responsive grid on 375px width (causes horizontal overflow of ${bodyScrollWidth - bodyClientWidth}px)!`);
    }

    // Repeat Case A (Character-limit boundaries) on mobile to check for layout breaks
    const rawPrompt = page.locator('#rawPrompt');
    const unbrokenPart = 'W'.repeat(1000);
    await rawPrompt.fill(unbrokenPart);
    await takeScreenshot(page, 'case_f', 'char_limit_mobile');

    // Repeat Case B variable parser rendering check on mobile
    // Let's enter a few variables and see how the inputs rendering holds up
    await page.route(url => url.pathname.includes('/api/optimize-prompt'), async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            optimized_prompt: 'Variables: {{name}} {{email}} {{address}} {{phone_number_details}}',
            explanation: 'Responsive test'
          })
        });
      }
    });

    await page.fill('#rawPrompt', 'Name: {{name}} Info: {{email}} {{address}} {{phone_number_details}}');
    // Ensure options are expanded, then click Quality = deep so it bypasses stream
    await ensureOptionsExpanded(page);
    await page.click('div[data-group="quality"] button[data-value="deep"]');
    await page.click('#optimizeBtn');
    await page.waitForSelector('#prettyView', { state: 'visible' });

    // Open dev menu
    const isDevMenuBtnVisible = await page.locator('#devMenuBtn').isVisible();
    console.log(`Is Dev Menu Button visible on mobile: ${isDevMenuBtnVisible}`);
    
    if (isDevMenuBtnVisible) {
      await page.click('#devMenuBtn');
      await page.click('#previewBtn');
      await page.locator('#placeholderInputsContainer').waitFor({ state: 'visible' });
      await takeScreenshot(page, 'case_f', 'placeholder_inputs_mobile');

      // Check if placeholder inputs grid fits inside the viewport without pushing elements offscreen
      const gridScrollWidth = await page.evaluate(() => {
        const grid = document.querySelector('.placeholder-inputs-grid');
        return grid ? grid.scrollWidth : 0;
      });
      const gridClientWidth = await page.evaluate(() => {
        const grid = document.querySelector('.placeholder-inputs-grid');
        return grid ? grid.clientWidth : 0;
      });
      console.log(`Placeholder grid scroll width: ${gridScrollWidth}px, client width: ${gridClientWidth}px`);
      if (gridScrollWidth > gridClientWidth) {
        console.log('[BUG] Placeholder inputs grid causes horizontal overflow within its container on mobile.');
      }
    }
  });
});
