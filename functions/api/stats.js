export async function onRequestGet({ request, env }) {
  const acceptHeader = request.headers.get("accept") || "";
  const wantHtml = acceptHeader.includes("text/html");

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  const tokenHeader = request.headers.get("x-stats-token");
  const providedToken = tokenParam || tokenHeader;

  const expectedToken = env.STATS_TOKEN;
  const isTokenConfigured = typeof expectedToken === 'string' && expectedToken.trim() !== '';

  if (isTokenConfigured && providedToken !== expectedToken) {
    if (wantHtml) {
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <title>Unauthorized - Stats Dashboard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: rgba(17, 24, 39, 0.7); padding: 2.5rem; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(12px); }
            h1 { color: #f43f5e; margin-top: 0; font-size: 1.8rem; }
            p { color: #9ca3af; font-size: 0.95rem; line-height: 1.5; }
            .input-form { margin-top: 1.5rem; display: flex; gap: 0.5rem; }
            input { flex: 1; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: #fff; font-size: 0.9rem; outline: none; }
            input:focus { border-color: #6366f1; }
            button { padding: 0.75rem 1.25rem; border-radius: 8px; border: none; background: #6366f1; color: #fff; font-weight: 600; cursor: pointer; transition: background 0.2s; }
            button:hover { background: #4f46e5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>🔒 Unauthorized Access</h1>
            <p>Please enter the stats access token to view this dashboard.</p>
            <form class="input-form" method="GET" action="">
              <input type="password" name="token" placeholder="Enter Token..." required />
              <button type="submit">Unlock</button>
            </form>
          </div>
        </body>
        </html>`,
        {
          status: 401,
          headers: { "Content-Type": "text/html" }
        }
      );
    } else {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
  }

  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  const qEvents = `
SELECT
  blob1 AS event_name,
  count() AS total_count,
  count(DISTINCT blob2) AS unique_sessions
FROM prompt_optimizer_events
WHERE timestamp >= now() - INTERVAL '30' DAY
GROUP BY event_name
  `.trim();

  const qTimes = `
SELECT
  avg(double1) AS avg_time_ms,
  quantileExactWeighted(0.5)(double1, _sample_interval) AS median_time_ms
FROM prompt_optimizer_events
WHERE timestamp >= now() - INTERVAL '30' DAY
  AND blob1 = 'copy'
  AND double1 > 0
  `.trim();

  const qReturnRate = `
SELECT
  count() AS total_visitors,
  countIf(first_seen <= now() - INTERVAL '7' DAY) AS cohort_size,
  countIf(first_seen <= now() - INTERVAL '7' DAY AND last_seen >= first_seen + INTERVAL '7' DAY) AS returned_size
FROM (
  SELECT
    blob3 AS visitor_id,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen
  FROM prompt_optimizer_events
  WHERE timestamp >= now() - INTERVAL '30' DAY
  GROUP BY visitor_id
)
  `.trim();

  if (!apiToken || !accountId) {
    const missingMsg = `Missing environment variables: ${!apiToken ? 'CLOUDFLARE_API_TOKEN ' : ''}${!accountId ? 'CLOUDFLARE_ACCOUNT_ID' : ''}`;
    if (wantHtml) {
      return renderConfigErrorHtml(missingMsg, qEvents, qTimes, qReturnRate);
    } else {
      return json({
        ok: false,
        error: missingMsg,
        documented_queries: {
          event_counts_and_uniques: qEvents,
          paste_to_copy_times: qTimes,
          cohort_7day_retention: qReturnRate
        }
      }, 500);
    }
  }

  try {
    // Execute queries in parallel
    const [eventsData, timesData, returnRateData] = await Promise.all([
      runQuery(qEvents, accountId, apiToken),
      runQuery(qTimes, accountId, apiToken),
      runQuery(qReturnRate, accountId, apiToken),
    ]);

    // Format query results
    const eventCounts = {};
    const eventSessions = {};
    const eventTypes = ['session_start', 'optimize_run', 'copy', 'placeholder_filled', 'test_both_run', 'save_to_library'];
    
    // Initialize default values
    eventTypes.forEach(t => {
      eventCounts[t] = 0;
      eventSessions[t] = 0;
    });

    for (const row of eventsData) {
      if (row.event_name) {
        eventCounts[row.event_name] = Number(row.total_count) || 0;
        eventSessions[row.event_name] = Number(row.unique_sessions) || 0;
      }
    }

    // Calculations
    const optimizeSessions = eventSessions['optimize_run'] || 0;
    const totalSessions = eventSessions['session_start'] || 1; // avoid division by zero

    const copyRateSessions = optimizeSessions > 0 ? (eventSessions['copy'] / optimizeSessions) * 100 : 0;
    const copyRateTotal = (eventSessions['copy'] / totalSessions) * 100;
    const placeholderFilledRate = optimizeSessions > 0 ? (eventSessions['placeholder_filled'] / optimizeSessions) * 100 : 0;
    const testBothUsageRate = optimizeSessions > 0 ? (eventSessions['test_both_run'] / optimizeSessions) * 100 : 0;

    const timesRow = timesData[0] || {};
    const pasteToCopyAvgSec = timesRow.avg_time_ms ? (Number(timesRow.avg_time_ms) / 1000) : null;
    const pasteToCopyMedianSec = timesRow.median_time_ms ? (Number(timesRow.median_time_ms) / 1000) : null;

    const returnRow = returnRateData[0] || {};
    const cohortSize = Number(returnRow.cohort_size) || 0;
    const returnedSize = Number(returnRow.returned_size) || 0;
    const returnRate7Day = cohortSize > 0 ? (returnedSize / cohortSize) * 100 : 0;

    const metrics = {
      period: "Last 30 Days",
      sessions: {
        total: totalSessions,
        optimize: optimizeSessions,
        copy: eventSessions['copy'] || 0,
        placeholder_filled: eventSessions['placeholder_filled'] || 0,
        test_both_run: eventSessions['test_both_run'] || 0,
      },
      counts: eventCounts,
      success_metrics: {
        copy_rate_optimize_sessions_pct: copyRateSessions,
        copy_rate_total_sessions_pct: copyRateTotal,
        placeholder_filled_rate_pct: placeholderFilledRate,
        test_both_usage_pct: testBothUsageRate,
        paste_to_copy_avg_sec: pasteToCopyAvgSec,
        paste_to_copy_median_sec: pasteToCopyMedianSec,
        cohort_7day: {
          cohort_size: cohortSize,
          returned_size: returnedSize,
          return_rate_pct: returnRate7Day
        }
      }
    };

    if (wantHtml) {
      return renderHtmlDashboard(metrics, !isTokenConfigured, providedToken);
    } else {
      return json({ ok: true, data: metrics });
    }
  } catch (err) {
    if (wantHtml) {
      return renderErrorHtml(err.message, qEvents, qTimes, qReturnRate);
    } else {
      return json({
        ok: false,
        error: err.message,
        hint: "This usually means your CLOUDFLARE_API_TOKEN is missing the 'Account Analytics: Read' permission.",
        documented_queries: {
          event_counts_and_uniques: qEvents,
          paste_to_copy_times: qTimes,
          cohort_7day_retention: qReturnRate
        }
      }, 500);
    }
  }
}

async function runQuery(query, accountId, apiToken) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "text/plain",
      },
      body: query.trim(),
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Cloudflare API error (${resp.status}): ${errorText}`);
  }

  const result = await resp.json();
  return result.data || [];
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function renderConfigErrorHtml(missingMsg, qEvents, qTimes, qReturnRate) {
  return new Response(
    `<!DOCTYPE html>
    <html>
    <head>
      <title>Configuration Required - Stats Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; margin: 0; line-height: 1.5; }
        .container { max-width: 800px; margin: 0 auto; }
        .card { background: rgba(17, 24, 39, 0.7); padding: 2.5rem; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(12px); margin-bottom: 2rem; }
        h1 { color: #f59e0b; margin-top: 0; font-size: 1.8rem; }
        p { color: #d1d5db; font-size: 0.95rem; }
        code { background: rgba(0,0,0,0.4); padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; color: #a5b4fc; }
        pre { background: rgba(0,0,0,0.5); padding: 1.25rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); font-family: monospace; color: #f3f4f6; overflow-x: auto; white-space: pre-wrap; font-size: 0.85rem; margin-top: 0.5rem; }
        .sql-section { margin-top: 2rem; }
        .sql-title { font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h1>⚙️ Configuration Required</h1>
          <p>To pull live metrics, you must set these environment variables/secrets in the Cloudflare dashboard or <code>.dev.vars</code>:</p>
          <p>1. <code>CLOUDFLARE_API_TOKEN</code> (with Account Analytics Read permission)</p>
          <p>2. <code>CLOUDFLARE_ACCOUNT_ID</code> (e.g. <code>14df474ff0c537e534c38492484b20be</code>)</p>
          <p>Missing parameters: <strong>${missingMsg}</strong></p>
        </div>

        <div class="card sql-section">
          <h2>📊 Documented SQL Queries</h2>
          <p>You can run these queries directly in your Cloudflare dashboard (under Analytics &gt; Analytics Engine) or via the API client:</p>
          
          <div class="sql-title">1. Event Counts &amp; Uniques (Last 30 Days)</div>
          <pre>${qEvents}</pre>

          <div class="sql-title" style="margin-top:1.5rem;">2. Average &amp; Median Paste-to-Copy Times</div>
          <pre>${qTimes}</pre>

          <div class="sql-title" style="margin-top:1.5rem;">3. 7-Day Cohort Return Rate</div>
          <pre>${qReturnRate}</pre>
        </div>
      </div>
    </body>
    </html>`,
    {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}

function renderErrorHtml(errorMsg, qEvents, qTimes, qReturnRate) {
  const isAuthError = errorMsg.includes("Authentication error") || errorMsg.includes("403");
  const errorTitle = isAuthError ? "🔒 API Token Permissions Required" : "❌ Query Execution Failed";
  const errorDesc = isAuthError 
    ? "The Cloudflare API Token does not have permission to query the SQL API. Please edit your token on the Cloudflare Dashboard and add <strong>Account Analytics: Read</strong> permissions." 
    : "An error occurred while fetching or calculating the statistics from the Analytics Engine:";

  return new Response(
    `<!DOCTYPE html>
    <html>
    <head>
      <title>API Authorization Required - Stats Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; margin: 0; line-height: 1.5; }
        .container { max-width: 800px; margin: 0 auto; }
        .card { background: rgba(17, 24, 39, 0.7); padding: 2.5rem; border-radius: 16px; border: 1px solid rgba(244, 63, 94, 0.2); box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(12px); margin-bottom: 2rem; }
        h1 { color: #f43f5e; margin-top: 0; font-size: 1.8rem; }
        p { color: #e5e7eb; font-size: 0.95rem; }
        pre { background: rgba(0,0,0,0.5); padding: 1.25rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); font-family: monospace; color: #f3f4f6; overflow-x: auto; white-space: pre-wrap; font-size: 0.85rem; margin-top: 0.5rem; }
        .sql-section { margin-top: 2rem; border-color: rgba(255,255,255,0.08); }
        .sql-title { font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
        .btn { background: #6366f1; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
        .btn:hover { background: #4f46e5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h1>${errorTitle}</h1>
          <p>${errorDesc}</p>
          <pre>${errorMsg}</pre>
          ${isAuthError ? `<p style="margin-top: 1.5rem;"><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" class="btn">Go to Cloudflare Tokens Dashboard &rarr;</a></p>` : ''}
        </div>

        <div class="card sql-section">
          <h2>📊 Documented SQL Queries</h2>
          <p>In the meantime, you can execute these SQL queries directly on your Cloudflare Analytics Engine dataset:</p>
          
          <div class="sql-title">1. Event Counts &amp; Uniques (Last 30 Days)</div>
          <pre>${qEvents}</pre>

          <div class="sql-title" style="margin-top:1.5rem;">2. Average &amp; Median Paste-to-Copy Times</div>
          <pre>${qTimes}</pre>

          <div class="sql-title" style="margin-top:1.5rem;">3. 7-Day Cohort Return Rate</div>
          <pre>${qReturnRate}</pre>
        </div>
      </div>
    </body>
    </html>`,
    {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}

function renderHtmlDashboard(metrics, showPublicWarning, token) {
  const m = metrics.success_metrics;
  const counts = metrics.counts;
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';

  const formatPct = (val) => typeof val === 'number' ? `${val.toFixed(1)}%` : '0.0%';
  const formatSec = (val) => typeof val === 'number' ? `${val.toFixed(2)}s` : 'N/A';
  const formatNum = (val) => typeof val === 'number' ? val.toLocaleString() : '0';

  return new Response(
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Insights &amp; Stats Dashboard — Promptimizer</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #0b0f19;
          --panel-bg: rgba(17, 24, 39, 0.65);
          --border: rgba(255, 255, 255, 0.08);
          --accent: #6366f1;
          --accent-hover: #4f46e5;
          --text: #f3f4f6;
          --text-mut: #9ca3af;
          --success: #10b981;
          --warning: #f59e0b;
        }

        body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background-color: var(--bg);
          color: var(--text);
          margin: 0;
          padding: 2rem 1.5rem;
          min-height: 100vh;
        }

        .container {
          max-width: 1100px;
          margin: 0 auto;
        }

        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2.5rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 1.5rem;
        }

        h1 {
          font-family: 'Outfit', sans-serif;
          font-size: 2.2rem;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .period-badge {
          background: rgba(99, 102, 241, 0.15);
          color: #a5b4fc;
          border: 1px solid rgba(99, 102, 241, 0.3);
          padding: 0.4rem 1rem;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .warning-banner {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.25);
          color: var(--warning);
          padding: 1rem;
          border-radius: 12px;
          margin-bottom: 2rem;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        /* Metrics Grid */
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2.5rem;
        }

        .card {
          background: var(--panel-bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.5rem;
          backdrop-filter: blur(12px);
          transition: transform 0.2s, border-color 0.2s;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .card-title {
          font-size: 0.85rem;
          color: var(--text-mut);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
        }

        .card-value {
          font-family: 'Outfit', sans-serif;
          font-size: 2.2rem;
          font-weight: 700;
          margin-bottom: 0.25rem;
          color: #fff;
        }

        .card-subtext {
          font-size: 0.75rem;
          color: var(--text-mut);
        }

        /* Detailed Tables Section */
        .section-title {
          font-family: 'Outfit', sans-serif;
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0 0 1.25rem 0;
          color: #fff;
        }

        .tables-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 2rem;
        }

        @media (max-width: 768px) {
          .tables-grid {
            grid-template-columns: 1fr;
          }
        }

        .table-container {
          background: var(--panel-bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.5rem;
          backdrop-filter: blur(12px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        th {
          font-size: 0.8rem;
          color: var(--text-mut);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border);
        }

        td {
          padding: 1rem;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 0.95rem;
        }

        tr:last-child td {
          border-bottom: none;
        }

        .numeric {
          text-align: right;
        }

        .event-badge {
          background: rgba(255,255,255,0.06);
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-family: monospace;
          font-size: 0.85rem;
          color: #818cf8;
        }

        footer {
          margin-top: 4rem;
          text-align: center;
          padding-top: 1.5rem;
          border-top: 1px solid var(--border);
          font-size: 0.8rem;
          color: var(--text-mut);
        }

        .api-link {
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
          transition: color 0.2s;
        }
        .api-link:hover {
          color: #a5b4fc;
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${showPublicWarning ? `
          <div class="warning-banner">
            <span>⚠️</span>
            <span><strong>Public Mode:</strong> The <code>STATS_TOKEN</code> environment variable is not configured. Access to this dashboard is currently public. Define the secret to protect it.</span>
          </div>
        ` : ''}

        <header>
          <div>
            <h1>Promptimizer</h1>
            <div style="font-size:0.9rem; color: var(--text-mut); margin-top: 0.25rem;">Analytics &amp; Success Insights Dashboard</div>
          </div>
          <div class="period-badge">${metrics.period}</div>
        </header>

        <!-- KPI Cards -->
        <div class="grid">
          <div class="card">
            <div class="card-title">Copy Conversion Rate</div>
            <div class="card-value">${formatPct(m.copy_rate_optimize_sessions_pct)}</div>
            <div class="card-subtext">Of sessions that ran optimize. (${formatPct(m.copy_rate_total_sessions_pct)} of total)</div>
          </div>

          <div class="card">
            <div class="card-title">Placeholder-Filled Rate</div>
            <div class="card-value">${formatPct(m.placeholder_filled_rate_pct)}</div>
            <div class="card-subtext">Sessions filling template variable inputs.</div>
          </div>

          <div class="card">
            <div class="card-title">Test Bench Usage</div>
            <div class="card-value">${formatPct(m.test_both_usage_pct)}</div>
            <div class="card-subtext">Sessions running side-by-side comparisons.</div>
          </div>

          <div class="card">
            <div class="card-title">7-Day return rate</div>
            <div class="card-value">${formatPct(m.cohort_7day.return_rate_pct)}</div>
            <div class="card-subtext">Cohort of ${formatNum(m.cohort_7day.cohort_size)} users returning 7+ days later.</div>
          </div>

          <div class="card">
            <div class="card-title">Paste &rarr; Copy Time</div>
            <div class="card-value" style="font-size: 1.8rem; padding: 0.2rem 0;">
              Avg: ${formatSec(m.paste_to_copy_avg_sec)}
            </div>
            <div class="card-subtext">Median: ${formatSec(m.paste_to_copy_median_sec)}</div>
          </div>
        </div>

        <div class="tables-grid">
          <!-- Raw Event List -->
          <div>
            <h2 class="section-title">Raw Event Frequency &amp; Uniques</h2>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Event Type</th>
                    <th class="numeric">Total Occurrences</th>
                    <th class="numeric">Unique Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span class="event-badge">session_start</span></td>
                    <td class="numeric">${formatNum(counts['session_start'])}</td>
                    <td class="numeric">${formatNum(metrics.sessions.total)}</td>
                  </tr>
                  <tr>
                    <td><span class="event-badge">optimize_run</span></td>
                    <td class="numeric">${formatNum(counts['optimize_run'])}</td>
                    <td class="numeric">${formatNum(metrics.sessions.optimize)}</td>
                  </tr>
                  <tr>
                    <td><span class="event-badge">copy</span></td>
                    <td class="numeric">${formatNum(counts['copy'])}</td>
                    <td class="numeric">${formatNum(metrics.sessions.copy)}</td>
                  </tr>
                  <tr>
                    <td><span class="event-badge">placeholder_filled</span></td>
                    <td class="numeric">${formatNum(counts['placeholder_filled'])}</td>
                    <td class="numeric">${formatNum(metrics.sessions.placeholder_filled)}</td>
                  </tr>
                  <tr>
                    <td><span class="event-badge">test_both_run</span></td>
                    <td class="numeric">${formatNum(counts['test_both_run'])}</td>
                    <td class="numeric">${formatNum(metrics.sessions.test_both_run)}</td>
                  </tr>
                  <tr>
                    <td><span class="event-badge">save_to_library</span></td>
                    <td class="numeric">${formatNum(counts['save_to_library'])}</td>
                    <td class="numeric">${formatNum(counts['save_to_library'])}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Quick documentation -->
          <div>
            <h2 class="section-title">Developer Resources</h2>
            <div class="table-container" style="font-size: 0.9rem; line-height: 1.6; color: var(--text-mut);">
              <p style="margin-top:0;">This dashboard aggregates telemetry logs from a serverless Cloudflare Workers Analytics Engine dataset.</p>
              <p>To fetch the raw structured payload directly, query the JSON API endpoint:</p>
              <p><a class="api-link" href="/api/stats${tokenQuery}">GET /api/stats (JSON)</a></p>
              <p><strong>Privacy Architecture:</strong> No persistent cookies or storage are used except for random UUIDs in LocalStorage/SessionStorage. IP addresses are completely discarded. Zero third-party scripts loaded.</p>
            </div>
          </div>
        </div>

        <footer>
          <div>Promptimizer Insights &bull; Powered by Cloudflare Workers Analytics Engine</div>
        </footer>
      </div>
    </body>
    </html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}
