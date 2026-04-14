#!/usr/bin/env node
/**
 * Cato MCP Server — v0.1.0
 * Absolute doctrine for tokenized settlement governance.
 *
 * Named after Marcus Porcius Cato — Roman senator and institutional
 * conscience of the Republic. Cato is the Verana L0 data layer for
 * Project Aureon's tokenized settlement doctrine.
 *
 * Data sources (all free, no auth required):
 *   - NY Fed:        SOFR, BGCR, TGCR, EFFR, repo reference rates
 *   - FRED:          Treasury yields, fed funds, repo rates, macro regime
 *   - TreasuryDirect: Auction results, yield curves
 *   - OFR:           Financial stress index, systemic risk indicators
 *   - SEC EDGAR:     13F filings, institutional positioning
 *   - Blockscout:    On-chain ETH gas, block time, network utilization
 *
 * Reference: Duffie (2025) "The Case for PORTS" — Brookings Institution.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const axios = require("axios");

const FRED_BASE = "https://api.stlouisfed.org/fred";
const NYFED_BASE = "https://markets.newyorkfed.org/api";
const TREASURY_BASE = "https://api.fiscaldata.treasury.gov/services/api/v1";
const EDGAR_BASE = "https://data.sec.gov";
const BLOCKSCOUT_BASE = "https://eth.blockscout.com/api/v2";

const FRED_KEY = process.env.FRED_API_KEY || ""; // Free key from fred.stlouisfed.org

async function get(url, params = {}) {
  try {
    const res = await axios.get(url, { params, timeout: 10000,
      headers: { "User-Agent": "Cato-MCP-Server/0.1.0 (open-source; Project Aureon; contact: github)" }
    });
    return res.data;
  } catch (e) {
    return { error: e.message, url };
  }
}

// ── FRED helper ──────────────────────────────────────────────────────────────
async function fredSeries(seriesId, limit = 10) {
  const params = { series_id: seriesId, sort_order: "desc", limit, file_type: "json" };
  if (FRED_KEY) params.api_key = FRED_KEY;
  const data = await get(`${FRED_BASE}/series/observations`, params);
  if (data.error) return data;
  return {
    series: seriesId,
    observations: (data.observations || []).map(o => ({ date: o.date, value: o.value }))
  };
}

// ── Blockscout helper ────────────────────────────────────────────────────────
// Pulls the /api/v2/stats endpoint and returns the average gas price in gwei
// plus supporting fields. Returns { gas_gwei: null, ... } on failure so the
// caller can surface a null instead of crashing the tool.
async function blockscoutStats() {
  const data = await get(`${BLOCKSCOUT_BASE}/stats`);
  if (data.error) {
    return { gas_gwei: null, coin_price_usd: null, error: data.error };
  }
  const gasAvg = data?.gas_prices?.average;
  const coinPrice = parseFloat(data?.coin_price || "0");
  return {
    gas_gwei: gasAvg !== undefined ? parseFloat(gasAvg) : null,
    block_time_seconds: data?.average_block_time !== undefined
      ? parseFloat(data.average_block_time) / 1000
      : null,
    network_utilization_pct: data?.network_utilization_percentage !== undefined
      ? parseFloat(data.network_utilization_percentage)
      : null,
    coin_price_usd: coinPrice || null
  };
}

// ── TOOL DEFINITIONS ─────────────────────────────────────────────────────────
const TOOLS = [

  // ── NY FED TOOLS ──────────────────────────────────────────────────────────
  {
    name: "get_sofr",
    description: "SOFR (Secured Overnight Financing Rate) — the benchmark rate replacing LIBOR, based on overnight Treasury repo transactions cleared through FICC. Critical for eFICC pricing, swap valuation, and repo book management.",
    inputSchema: { type: "object", properties: {
      days: { type: "number", description: "Number of days of history (default 10)", default: 10 }
    }}
  },
  {
    name: "get_repo_reference_rates",
    description: "NY Fed repo reference rates: SOFR, BGCR (Broad General Collateral Rate — tri-party repo), TGCR (Tri-party General Collateral Rate). Essential for repo desk pricing and collateral valuation.",
    inputSchema: { type: "object", properties: {
      rate_type: { type: "string", enum: ["sofr", "bgcr", "tgcr", "all"], description: "Rate type to retrieve", default: "all" }
    }}
  },
  {
    name: "get_effr",
    description: "EFFR (Effective Federal Funds Rate) — the actual overnight interbank lending rate set by the Fed. Core eFICC macro context for rate product positioning.",
    inputSchema: { type: "object", properties: {
      days: { type: "number", description: "Days of history", default: 10 }
    }}
  },
  {
    name: "get_repo_operations",
    description: "NY Fed open market repo and reverse repo operations — daily Fed intervention in repo market. Shows Fed liquidity posture. Critical context for repo clearing mandate compliance.",
    inputSchema: { type: "object", properties: {
      operation_type: { type: "string", enum: ["repo", "reverserepo", "all"], default: "all" },
      days: { type: "number", default: 5 }
    }}
  },

  // ── TREASURY YIELD CURVE TOOLS ────────────────────────────────────────────
  {
    name: "get_treasury_yield_curve",
    description: "US Treasury constant maturity yields — full curve from 1-month to 30-year. Foundation for all fixed income relative value analysis, duration risk, and swap pricing.",
    inputSchema: { type: "object", properties: {
      tenor: { type: "string", enum: ["1m","3m","6m","1y","2y","3y","5y","7y","10y","20y","30y","all"],
        description: "Specific tenor or 'all' for full curve", default: "all" },
      days: { type: "number", description: "Days of history", default: 5 }
    }}
  },
  {
    name: "get_tips_yields",
    description: "TIPS (Treasury Inflation-Protected Securities) real yields and breakeven inflation rates. Used for real rate analysis and inflation expectations in eFICC portfolios.",
    inputSchema: { type: "object", properties: {
      tenor: { type: "string", enum: ["5y","10y","20y","30y","all"], default: "all" },
      days: { type: "number", default: 10 }
    }}
  },
  {
    name: "get_treasury_auctions",
    description: "US Treasury auction results — bid-to-cover ratios, high yields, indirect bidder participation. Real-time signal for institutional demand in Treasury market.",
    inputSchema: { type: "object", properties: {
      security_type: { type: "string", enum: ["Bill","Note","Bond","CMB","TIPS","FRN","all"], default: "all" },
      limit: { type: "number", description: "Number of recent auctions", default: 10 }
    }}
  },
  {
    name: "get_yield_curve_spread",
    description: "Treasury yield curve spreads: 2y10y, 3m10y (recession indicator), 5y30y. Key eFICC regime indicators for rate product positioning.",
    inputSchema: { type: "object", properties: {
      spread: { type: "string", enum: ["2y10y","3m10y","5y30y","all"], default: "all" },
      days: { type: "number", default: 30 }
    }}
  },

  // ── MACRO REGIME TOOLS ────────────────────────────────────────────────────
  {
    name: "get_macro_regime_snapshot",
    description: "Full eFICC macro regime snapshot: fed funds rate, SOFR, 10y Treasury, 2y10y spread, CPI YoY, unemployment. Single call for Neptune Spear signal context.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_cpi",
    description: "CPI (Consumer Price Index) — inflation data critical for TIPS valuation, real rate calculation, and Fed policy expectations in rate product trading.",
    inputSchema: { type: "object", properties: {
      series: { type: "string", enum: ["headline","core","all"], default: "all" },
      months: { type: "number", default: 12 }
    }}
  },
  {
    name: "get_fed_balance_sheet",
    description: "Federal Reserve balance sheet — total assets, Treasury holdings, MBS holdings, reserve balances. Critical for understanding quantitative tightening impact on eFICC supply/demand.",
    inputSchema: { type: "object", properties: {
      weeks: { type: "number", default: 12 }
    }}
  },

  // ── OFR / MONEY MARKETS ───────────────────────────────────────────────────
  {
    name: "get_ofr_stress_index",
    description: "OFR Financial Stress Index — composite measure of systemic stress across money markets, equity markets, funding markets. Verana L0 systemic stress overlay for doctrine gate decisions.",
    inputSchema: { type: "object", properties: {
      days: { type: "number", default: 30 }
    }}
  },
  {
    name: "get_money_market_rates",
    description: "Money market rates: commercial paper, banker acceptances, certificates of deposit. eFICC short-end context for repo pricing and MMF sweep optimization.",
    inputSchema: { type: "object", properties: {
      instrument: { type: "string", enum: ["cp_aa_nonfinancial","cp_aa_financial","cp_a2p2","all"], default: "all" },
      days: { type: "number", default: 10 }
    }}
  },

  // ── REPO MARKET TOOLS ─────────────────────────────────────────────────────
  {
    name: "get_repo_market_context",
    description: "Repo market context: overnight repo rate (SOFR), term SOFR rates (1m, 3m, 6m), reverse repo facility usage. Critical for repo clearing mandate compliance analysis.",
    inputSchema: { type: "object", properties: {
      include_term_sofr: { type: "boolean", default: true },
      days: { type: "number", default: 10 }
    }}
  },
  {
    name: "get_term_sofr",
    description: "CME Term SOFR reference rates (1-month, 3-month, 6-month, 12-month) via FRED. Forward-looking rates used in swap pricing and loan documentation post-LIBOR transition.",
    inputSchema: { type: "object", properties: {
      tenor: { type: "string", enum: ["1m","3m","6m","12m","all"], default: "all" },
      days: { type: "number", default: 10 }
    }}
  },

  // ── SEC EDGAR TOOLS ───────────────────────────────────────────────────────
  {
    name: "get_recent_13f_filers",
    description: "Recent 13F filings from SEC EDGAR — institutional positioning data. Fixed income and rates hedge fund positioning signal for Neptune Spear alpha origination.",
    inputSchema: { type: "object", properties: {
      days_back: { type: "number", description: "Days to look back for filings", default: 30 }
    }}
  },
  {
    name: "get_company_filings",
    description: "SEC EDGAR company filings — 10-K, 10-Q, 8-K for credit analysis. CIK lookup by company name for fundamental fixed income credit research.",
    inputSchema: { type: "object", properties: {
      cik: { type: "string", description: "SEC CIK number (10 digits)" },
      form_type: { type: "string", enum: ["10-K","10-Q","8-K","13F-HR","all"], default: "10-K" },
      limit: { type: "number", default: 5 }
    }, required: ["cik"] }
  },

  // ── TOKENIZED SETTLEMENT TOOLS (Cato doctrine layer) ──────────────────────
  {
    name: "get_tokenized_settlement_context",
    description: "Real-time signal for whether atomic on-chain settlement is viable right now. Combines Blockscout ETH gas price with FRED SOFR and OFR financial stress index. Returns settlement_posture of 'favorable' (stress < 0.5 AND gas < 30), 'monitor' (stress 0.5-1.0 OR gas 30-50), or 'elevated' (stress > 1.0 OR gas > 50).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "compare_settlement_rails",
    description: "Given a notional repo trade size in USD, estimate all-in cost on FICC traditional rail versus atomic on-chain rail and recommend which rail to use. FICC rail: GCF clearing fee (~0.5bps) net of 40% netting benefit, plus overnight cost of capital at SOFR. On-chain rail: ETH gas × 65000 units × ETH price proxy. Returns cost comparison, cheaper rail, savings, and doctrine note.",
    inputSchema: { type: "object", properties: {
      notional_usd: { type: "number", description: "Notional trade size in USD" },
      term_days: { type: "number", description: "Settlement term in days (default 1 for overnight repo)", default: 1 }
    }, required: ["notional_usd"] }
  },
  {
    name: "get_atomic_settlement_gate",
    description: "Verana L0 doctrine gate for tokenized settlement. Calls cato_gate for rates and stress, and get_tokenized_settlement_context for on-chain gas and posture. Returns PROCEED / HOLD / ESCALATE. ESCALATE if OFR stress > 1.0. HOLD if OFR stress > 0.5 OR gas > 50 gwei. PROCEED otherwise.",
    inputSchema: { type: "object", properties: {} }
  },

  // ── GOVERNANCE ────────────────────────────────────────────────────────────
  {
    name: "cato_gate",
    description: "Cato pre-settlement doctrine check — consolidated eFICC governance context for DSOR pre-trade record: SOFR, 10y yield, 2y10y spread, OFR stress index, fed liquidity posture. Single tool that Verana L0 calls before any tokenized settlement proceeds. (Renamed from get_ficc_context.)",
    inputSchema: { type: "object", properties: {} }
  }
];

// ── TOOL HANDLERS ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {

    case "get_sofr": {
      const data = await get(`${NYFED_BASE}/rates/sofr/last/${args.days || 10}.json`);
      if (data.error) return data;
      return { source: "NY Fed", rate_type: "SOFR", data: data.refRates || data };
    }

    case "get_repo_reference_rates": {
      const type = args.rate_type || "all";
      const results = {};
      const types = type === "all" ? ["sofr","bgcr","tgcr"] : [type];
      for (const t of types) {
        const d = await get(`${NYFED_BASE}/rates/${t}/last/5.json`);
        results[t.toUpperCase()] = d.refRates || d;
      }
      return { source: "NY Fed", rates: results };
    }

    case "get_effr": {
      const data = await get(`${NYFED_BASE}/rates/effr/last/${args.days || 10}.json`);
      return { source: "NY Fed", rate_type: "EFFR", data: data.refRates || data };
    }

    case "get_repo_operations": {
      const type = args.operation_type || "all";
      const results = {};
      if (type === "repo" || type === "all") {
        const d = await get(`${NYFED_BASE}/rp/results/details/last/${args.days || 5}.json`);
        results.repo_operations = d.repo || d;
      }
      if (type === "reverserepo" || type === "all") {
        const d = await get(`${NYFED_BASE}/rp/reverserepo/propositions/details/last/${args.days || 5}.json`);
        results.reverse_repo = d.reverse_repo || d;
      }
      return { source: "NY Fed", operations: results };
    }

    case "get_treasury_yield_curve": {
      const tenor = args.tenor || "all";
      const days = args.days || 5;
      const SERIES = {
        "1m": "DGS1MO", "3m": "DGS3MO", "6m": "DGS6MO",
        "1y": "DGS1", "2y": "DGS2", "3y": "DGS3",
        "5y": "DGS5", "7y": "DGS7", "10y": "DGS10",
        "20y": "DGS20", "30y": "DGS30"
      };
      if (tenor !== "all") {
        const seriesId = SERIES[tenor];
        if (!seriesId) return { error: `Unknown tenor: ${tenor}` };
        return await fredSeries(seriesId, days);
      }
      const results = {};
      for (const [t, s] of Object.entries(SERIES)) {
        const d = await fredSeries(s, 1);
        if (d.observations && d.observations[0]) {
          results[t] = { date: d.observations[0].date, yield: d.observations[0].value };
        }
      }
      return { source: "FRED", description: "US Treasury Constant Maturity Yields", curve: results };
    }

    case "get_tips_yields": {
      const tenor = args.tenor || "all";
      const SERIES = { "5y": "DFII5", "10y": "DFII10", "20y": "DFII20", "30y": "DFII30" };
      const BREAKEVEN = { "5y": "T5YIE", "10y": "T10YIE" };
      const results = {};
      const tenors = tenor === "all" ? Object.keys(SERIES) : [tenor];
      for (const t of tenors) {
        if (SERIES[t]) {
          const d = await fredSeries(SERIES[t], args.days || 10);
          results[`${t}_real_yield`] = d.observations?.[0];
        }
        if (BREAKEVEN[t]) {
          const d = await fredSeries(BREAKEVEN[t], args.days || 10);
          results[`${t}_breakeven`] = d.observations?.[0];
        }
      }
      return { source: "FRED", description: "TIPS Real Yields and Breakeven Inflation", data: results };
    }

    case "get_treasury_auctions": {
      const type = args.security_type || "all";
      const limit = args.limit || 10;
      const params = {
        "fields": "security_type,security_term,auction_date,high_yield,bid_to_cover_ratio,indirect_bidders_accepted_pct,total_accepted",
        "sort": "-auction_date",
        "page[size]": limit,
        "page[number]": 1
      };
      if (type !== "all") params["filter"] = `security_type:eq:${type}`;
      const data = await get(`${TREASURY_BASE}/accounting/od/auctions_query`, params);
      return { source: "TreasuryDirect / Fiscal Data API", auctions: data.data || data };
    }

    case "get_yield_curve_spread": {
      const spread = args.spread || "all";
      const days = args.days || 30;
      const SPREADS = {
        "2y10y": ["DGS10", "DGS2"],
        "3m10y": ["DGS10", "DGS3MO"],
        "5y30y": ["DGS30", "DGS5"]
      };
      const spreadsToCalc = spread === "all" ? Object.keys(SPREADS) : [spread];
      const results = {};
      for (const s of spreadsToCalc) {
        const [longId, shortId] = SPREADS[s];
        const [longD, shortD] = await Promise.all([fredSeries(longId, days), fredSeries(shortId, days)]);
        const obs = (longD.observations || []).map((o, i) => {
          const shortObs = (shortD.observations || [])[i];
          if (!shortObs || o.value === "." || shortObs.value === ".") return null;
          return { date: o.date, spread_bps: ((parseFloat(o.value) - parseFloat(shortObs.value)) * 100).toFixed(1) };
        }).filter(Boolean);
        results[s] = { description: `${s} spread (basis points)`, data: obs.slice(0, days) };
      }
      return { source: "FRED", yield_curve_spreads: results };
    }

    case "get_macro_regime_snapshot": {
      const [effr, sofr, t10y, t2y, t3m, cpi, unrate] = await Promise.all([
        fredSeries("FEDFUNDS", 1),
        fredSeries("SOFR", 1),
        fredSeries("DGS10", 1),
        fredSeries("DGS2", 1),
        fredSeries("DGS3MO", 1),
        fredSeries("CPIAUCSL", 2),
        fredSeries("UNRATE", 1)
      ]);
      const t10 = parseFloat(t10y.observations?.[0]?.value || 0);
      const t2  = parseFloat(t2y.observations?.[0]?.value || 0);
      const t3mV = parseFloat(t3m.observations?.[0]?.value || 0);
      const cpiVals = cpi.observations || [];
      const cpiYoY = cpiVals.length >= 2
        ? (((parseFloat(cpiVals[0].value) - parseFloat(cpiVals[1].value)) / parseFloat(cpiVals[1].value)) * 100 * 12).toFixed(2)
        : "N/A";
      return {
        source: "FRED + NY Fed",
        snapshot_date: new Date().toISOString().split("T")[0],
        rates: {
          fed_funds_rate: effr.observations?.[0],
          sofr: sofr.observations?.[0],
          treasury_10y: t10y.observations?.[0],
          treasury_2y: t2y.observations?.[0],
          treasury_3m: t3m.observations?.[0]
        },
        spreads: {
          "2y10y_bps": ((t10 - t2) * 100).toFixed(1),
          "3m10y_bps": ((t10 - t3mV) * 100).toFixed(1)
        },
        macro: {
          cpi_mom_annualized: cpiYoY,
          unemployment_rate: unrate.observations?.[0]
        }
      };
    }

    case "get_cpi": {
      const s = args.series || "all";
      const months = args.months || 12;
      const results = {};
      if (s === "headline" || s === "all") results.headline_cpi = await fredSeries("CPIAUCSL", months);
      if (s === "core" || s === "all") results.core_cpi = await fredSeries("CPILFESL", months);
      return { source: "FRED / BLS", cpi_data: results };
    }

    case "get_fed_balance_sheet": {
      const weeks = args.weeks || 12;
      const [total, treasuries, mbs, reserves] = await Promise.all([
        fredSeries("WALCL", weeks),
        fredSeries("TREAST", weeks),
        fredSeries("MBST", weeks),
        fredSeries("WRESBAL", weeks)
      ]);
      return {
        source: "FRED / Federal Reserve H.4.1",
        fed_balance_sheet: {
          total_assets: total.observations,
          treasury_securities: treasuries.observations,
          mbs_holdings: mbs.observations,
          reserve_balances: reserves.observations
        }
      };
    }

    case "get_ofr_stress_index": {
      const data = await fredSeries("STLFSI4", args.days || 30);
      return {
        source: "OFR / FRED — St. Louis Fed Financial Stress Index",
        description: "Values above 0 indicate above-average financial stress. Verana L0 systemic stress signal.",
        stress_index: data.observations
      };
    }

    case "get_money_market_rates": {
      const inst = args.instrument || "all";
      const days = args.days || 10;
      const SERIES = {
        "cp_aa_nonfinancial": "DCPN3M",
        "cp_aa_financial": "DCPF3M",
        "cp_a2p2": "DCPN30"
      };
      const results = {};
      const insts = inst === "all" ? Object.keys(SERIES) : [inst];
      for (const i of insts) {
        if (SERIES[i]) results[i] = await fredSeries(SERIES[i], days);
      }
      return { source: "FRED / Federal Reserve", money_market_rates: results };
    }

    case "get_repo_market_context": {
      const days = args.days || 10;
      const includeTerm = args.include_term_sofr !== false;
      const [sofr, rrp, bgcr] = await Promise.all([
        fredSeries("SOFR", days),
        fredSeries("RRPONTSYD", days),
        fredSeries("BGCR", days)
      ]);
      const result = {
        source: "NY Fed + FRED",
        overnight_rates: { sofr: sofr.observations, bgcr: bgcr.observations },
        fed_reverse_repo_volume: rrp.observations
      };
      if (includeTerm) {
        const [t1m, t3m, t6m] = await Promise.all([
          fredSeries("SOFR1", days),
          fredSeries("SOFR3", days),
          fredSeries("SOFR6", days)
        ]);
        result.term_sofr = { "1m": t1m.observations, "3m": t3m.observations, "6m": t6m.observations };
      }
      return result;
    }

    case "get_term_sofr": {
      const tenor = args.tenor || "all";
      const days = args.days || 10;
      const SERIES = { "1m": "SOFR1", "3m": "SOFR3", "6m": "SOFR6", "12m": "SOFR12" };
      const tenors = tenor === "all" ? Object.keys(SERIES) : [tenor];
      const results = {};
      for (const t of tenors) {
        if (SERIES[t]) results[t] = await fredSeries(SERIES[t], days);
      }
      return { source: "FRED — CME Term SOFR", term_sofr: results };
    }

    case "get_recent_13f_filers": {
      const days = args.days_back || 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
      const search = await get(
        `${EDGAR_BASE}/efts/v1/hits.json`,
        { q: '"13F-HR"', dateRange: "custom", startdt: cutoff, forms: "13F-HR" }
      );
      return {
        source: "SEC EDGAR",
        description: "Recent 13F institutional holdings filings",
        note: "Use get_company_filings with a specific CIK for full filing details",
        recent_filers: search.hits?.hits?.slice(0, 20).map(h => ({
          company: h._source?.display_names?.[0],
          filed: h._source?.file_date,
          accession: h._source?.accession_no
        })) || search
      };
    }

    case "get_company_filings": {
      const cik = args.cik.padStart(10, "0");
      const formType = args.form_type || "10-K";
      const limit = args.limit || 5;
      const data = await get(`${EDGAR_BASE}/submissions/CIK${cik}.json`);
      if (data.error) return data;
      const filings = data.filings?.recent;
      if (!filings) return { error: "No filings found", cik };
      const filtered = [];
      for (let i = 0; i < filings.form.length && filtered.length < limit; i++) {
        if (formType === "all" || filings.form[i] === formType) {
          filtered.push({
            form: filings.form[i],
            filed: filings.filingDate[i],
            accession: filings.accessionNumber[i],
            url: `https://www.sec.gov/Archives/edgar/full-index/${filings.filingDate[i].slice(0,4)}/`
          });
        }
      }
      return { source: "SEC EDGAR", company: data.name, cik, filings: filtered };
    }

    // ── CATO GATE (was get_ficc_context) ────────────────────────────────────
    case "cato_gate": {
      const [sofr, t10y, t2y, t3m, stress, rrp] = await Promise.all([
        fredSeries("SOFR", 1),
        fredSeries("DGS10", 1),
        fredSeries("DGS2", 1),
        fredSeries("DGS3MO", 1),
        fredSeries("STLFSI4", 1),
        fredSeries("RRPONTSYD", 1)
      ]);
      const t10 = parseFloat(t10y.observations?.[0]?.value || 0);
      const t2  = parseFloat(t2y.observations?.[0]?.value || 0);
      const t3mV = parseFloat(t3m.observations?.[0]?.value || 0);
      return {
        source: "FRED + NY Fed",
        dsor_context_date: new Date().toISOString(),
        description: "Cato pre-settlement doctrine check — DSOR governance context snapshot",
        rates: {
          sofr: sofr.observations?.[0],
          treasury_10y: t10y.observations?.[0],
          treasury_2y: t2y.observations?.[0],
          treasury_3m: t3m.observations?.[0]
        },
        spreads: {
          "2y10y_bps": ((t10 - t2) * 100).toFixed(1),
          "3m10y_bps": ((t10 - t3mV) * 100).toFixed(1),
          curve_shape: (t10 - t2) > 0 ? "normal" : (t10 - t2) < -0.25 ? "inverted" : "flat"
        },
        systemic_stress: {
          ofr_stress_index: stress.observations?.[0],
          stress_level: parseFloat(stress.observations?.[0]?.value || 0) > 1 ? "elevated" :
                        parseFloat(stress.observations?.[0]?.value || 0) > 0 ? "above_average" : "normal"
        },
        fed_liquidity: {
          reverse_repo_facility_volume: rrp.observations?.[0]
        }
      };
    }

    // ── TOKENIZED SETTLEMENT CONTEXT ────────────────────────────────────────
    case "get_tokenized_settlement_context": {
      const [chain, sofr, stress] = await Promise.all([
        blockscoutStats(),
        fredSeries("SOFR", 1),
        fredSeries("STLFSI4", 1)
      ]);
      const gas_gwei = chain?.gas_gwei;
      const sofr_rate = parseFloat(sofr.observations?.[0]?.value || "0");
      const ofr_stress = parseFloat(stress.observations?.[0]?.value || "0");

      // Settlement posture per Cato doctrine thresholds:
      //   elevated  — stress > 1.0 OR gas > 50
      //   monitor   — stress 0.5..1.0 OR gas 30..50
      //   favorable — stress < 0.5 AND gas < 30
      let settlement_posture;
      if (ofr_stress > 1.0 || (gas_gwei !== null && gas_gwei > 50)) {
        settlement_posture = "elevated";
      } else if (ofr_stress > 0.5 || (gas_gwei !== null && gas_gwei > 30)) {
        settlement_posture = "monitor";
      } else {
        settlement_posture = "favorable";
      }

      return {
        source: "Blockscout + FRED (SOFR, STLFSI4)",
        timestamp: new Date().toISOString(),
        gas_gwei,
        sofr_rate,
        ofr_stress,
        settlement_posture
      };
    }

    // ── COMPARE SETTLEMENT RAILS ────────────────────────────────────────────
    case "compare_settlement_rails": {
      const notional_usd = parseFloat(args.notional_usd);
      if (!Number.isFinite(notional_usd) || notional_usd <= 0) {
        return { error: "notional_usd is required and must be a positive number" };
      }
      const term_days = args.term_days || 1;

      // Live market state for both rails
      const [chain, sofrSeries] = await Promise.all([
        blockscoutStats(),
        fredSeries("SOFR", 1)
      ]);
      const sofr = parseFloat(sofrSeries.observations?.[0]?.value || "0");
      const gas_gwei = chain?.gas_gwei;

      // ── FICC traditional rail ──────────────────────────────────────────
      //   clearing fee: 0.5 bps gross, net of 40% netting benefit, annualized
      //                 to the trade term
      //   cost of capital: SOFR annualized to the trade term
      //   (Formulas per Cato v0.1.0 doctrine spec.)
      const ficc_clearing = notional_usd * 0.00005 * (1 - 0.4) * (term_days / 360);
      const ficc_cost_of_capital = notional_usd * (sofr / 100) * (term_days / 360);
      const ficc_cost_usd = ficc_clearing + ficc_cost_of_capital;

      // ── Atomic on-chain rail ───────────────────────────────────────────
      //   gas_gwei * 65000 gas units * 1e-9 (gwei → ETH) * eth_price_proxy
      //   eth_price_proxy = 1800 (conservative static for v0.1.0;
      //                           Phase 2 will use a live feed)
      const eth_price_proxy = 1800;
      const onchain_cost_usd = (gas_gwei !== null && gas_gwei !== undefined)
        ? gas_gwei * 65000 * 1e-9 * eth_price_proxy
        : null;

      // ── Recommendation ─────────────────────────────────────────────────
      let cheaper_rail;
      let cost_savings_usd;
      if (onchain_cost_usd === null) {
        cheaper_rail = "ficc";
        cost_savings_usd = null;
      } else if (onchain_cost_usd < ficc_cost_usd) {
        cheaper_rail = "onchain";
        cost_savings_usd = +(ficc_cost_usd - onchain_cost_usd).toFixed(4);
      } else {
        cheaper_rail = "ficc";
        cost_savings_usd = +(onchain_cost_usd - ficc_cost_usd).toFixed(4);
      }

      return {
        source: "FRED (SOFR) + Blockscout (gas)",
        timestamp: new Date().toISOString(),
        inputs: { notional_usd, term_days },
        market_state: {
          sofr_pct: sofr,
          eth_gas_gwei: gas_gwei,
          eth_price_proxy
        },
        ficc_cost_usd: +ficc_cost_usd.toFixed(4),
        onchain_cost_usd: onchain_cost_usd !== null ? +onchain_cost_usd.toFixed(4) : null,
        cheaper_rail,
        cost_savings_usd,
        doctrine_note: "On-chain atomic DvP eliminates T+1 counterparty risk window. FICC clearing provides netting benefit at scale."
      };
    }

    // ── ATOMIC SETTLEMENT GATE ──────────────────────────────────────────────
    case "get_atomic_settlement_gate": {
      // Call cato_gate for rates + stress context, and
      // get_tokenized_settlement_context for on-chain gas + posture.
      const [gateContext, settlementContext] = await Promise.all([
        handleTool("cato_gate", {}),
        handleTool("get_tokenized_settlement_context", {})
      ]);

      const ofr_stress = parseFloat(
        gateContext?.systemic_stress?.ofr_stress_index?.value ?? "0"
      );
      const gas_gwei = settlementContext?.gas_gwei;

      const reasons = [];
      let gate_decision = "PROCEED";
      let recommended_rail = "atomic";

      // ESCALATE first — systemic stress overrides everything
      if (ofr_stress > 1.0) {
        gate_decision = "ESCALATE";
        recommended_rail = "human_authority";
        reasons.push(`OFR stress index at ${ofr_stress.toFixed(2)} — systemic stress threshold (>1.0) breached`);
      } else {
        // HOLD if non-systemic friction
        if (ofr_stress > 0.5) {
          gate_decision = "HOLD";
          reasons.push(`OFR stress index at ${ofr_stress.toFixed(2)} — above-average stress (>0.5)`);
        }
        if (gas_gwei !== null && gas_gwei !== undefined && gas_gwei > 50) {
          gate_decision = "HOLD";
          reasons.push(`ETH gas at ${gas_gwei} gwei — above 50 gwei doctrine threshold`);
        }
        if (gate_decision === "HOLD") {
          recommended_rail = "traditional";
        } else {
          reasons.push("All doctrine thresholds clear — atomic settlement viable");
          recommended_rail = "atomic";
        }
      }

      return {
        gate_decision,
        reasons,
        recommended_rail,
        timestamp: new Date().toISOString(),
        doctrine: "Verana L0 — Cato settlement gate v0.1.0",
        inputs: {
          ofr_stress,
          gas_gwei,
          settlement_posture: settlementContext?.settlement_posture ?? null
        }
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── SERVER SETUP ─────────────────────────────────────────────────────────────
const server = new Server(
  { name: "cato", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true
    };
  }
});

// ── START ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Cato MCP Server running — 21 tools across NY Fed, FRED, TreasuryDirect, OFR, SEC EDGAR, Blockscout. Absolute doctrine for tokenized settlement governance.\n");
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
