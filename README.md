# Cato — FICC MCP

**Absolute doctrine for tokenized settlement governance.**

Named after **Marcus Porcius Cato** — Roman senator and institutional conscience of the Republic. He ended every speech with the same line regardless of the topic. Unwavering doctrine before action. That is this server's function.

## What Cato Does

Cato is a free, open-source MCP (Model Context Protocol) server that provides the governance data layer for eFICC (electronic Fixed Income, Currencies & Commodities) operations and tokenized atomic settlement decisions.

It feeds the **Verana L0 doctrine gate** in the Aureon governance architecture — providing real-time rate regime, systemic stress, and on-chain settlement conditions before any settlement proceeds on any rail.

> *"Ceterum censeo Carthaginem esse delendam"* — Cato the Elder
>
> Settlement must be governed. Every time. No exceptions.

---

## 23 Tools

### NY Fed

- `get_sofr` — SOFR daily rate history
- `get_repo_reference_rates` — SOFR, BGCR, TGCR
- `get_effr` — Effective Federal Funds Rate
- `get_repo_operations` — Fed open market repo/reverse repo

### Treasury Yield Curve

- `get_treasury_yield_curve` — Full curve 1m → 30y
- `get_tips_yields` — TIPS real yields and breakeven inflation
- `get_treasury_auctions` — Auction results, bid-to-cover, indirect bidder %
- `get_yield_curve_spread` — 2y10y, 3m10y, 5y30y in basis points

### Macro Regime

- `get_macro_regime_snapshot` — Full eFICC regime in one call
- `get_cpi` — CPI headline and core
- `get_fed_balance_sheet` — Total assets, Treasury holdings, MBS, reserves

### OFR / Money Markets

- `get_ofr_stress_index` — Financial stress composite
- `get_money_market_rates` — Commercial paper rates

### Repo Market

- `get_repo_market_context` — Overnight + term SOFR + reverse repo facility
- `get_term_sofr` — CME Term SOFR 1m/3m/6m/12m

### SEC EDGAR

- `get_recent_13f_filers` — Recent institutional holdings filings
- `get_company_filings` — Company-specific SEC filings by CIK

### Tokenized Settlement (Multi-Chain Router — v0.2.1)

- `get_onchain_prices` — Live ETH and SOL USD prices via CoinGecko public API (no auth). Standalone tool, also used internally by the rail cost tools.
- `get_multichain_gas` — Live gas/fee state across Ethereum, Base, Arbitrum, Solana, plus the `fed_l1` placeholder. Includes live USD prices via `price_sources`.
- `get_tokenized_settlement_context` — ETH gas + SOFR + OFR stress → settlement posture
- `compare_settlement_rails` — Ranked cost comparison across all 5 rails + recommended rail. Uses live ETH/SOL prices from CoinGecko.
- `get_atomic_settlement_gate` — Verana L0 doctrine gate: `PROCEED` / `HOLD` / `ESCALATE` with `recommended_chain`. Uses live prices for rail cost math.

### Governance

- `cato_gate` — Pre-trade DSOR context package for Aureon integration (now includes live multi-chain state and recommended chain)

---

## Supported Settlement Rails

| Rail | Speed | Cost | Status |
|------|-------|------|--------|
| **FICC Traditional** | T+1 | ~0.5 bps clearing fee net of 40% netting benefit + SOFR cost-of-capital | Live |
| **Ethereum L1** | ~12s | Variable gwei · current: fetched from `eth.blockscout.com` | Live |
| **Base** (Ethereum L2) | ~2s | ~0.01 gwei · fetched from `base.blockscout.com` | Live |
| **Arbitrum** (Ethereum L2) | ~2s | ~0.02 gwei · fetched from `arbitrum.blockscout.com` | Live |
| **Solana** | ~400ms | ~$0.001 per settlement · `getRecentPrioritizationFees` via public RPC | Experimental |
| **Fed L1 / PORTS** | Instant | TBD | **Pending — GENIUS Act / Duffie 2025** |

> **Cato is chain-agnostic by design. The governance gate — not the rail — is the product. When the Fed issues tokenized reserves or PORTS, Cato routes there. The doctrine doesn't change. The rail does.**

### Routing Doctrine (v0.2.0)

```
if OFR stress > 0.5                     → ficc_traditional   (stress overrides everything)
else if notional > $10M and eth_gas < 30 → ethereum_l1        (large notional, gas is noise)
else if solana_fee_usd < $0.01           → solana             (ultra-low cost for any size)
else if base_gas < 1 gwei                → base               (L2 default when available)
else if eth_gas > 50 gwei                → ficc_traditional   (gas spike → fall back)
else                                     → ethereum_l1        (safe fallback)
```

### Solana notes

Solana is included as an experimental settlement rail. The speed case is real — 400ms finality vs 12 seconds on Ethereum is a genuine advantage for high-frequency repo settlement. The cost case is real — sub-cent fees at any notional. The concern is also real: Solana had multiple network outages between 2022 and 2023 that would have been catastrophic for live settlement infrastructure. The doctrine answer is: **Solana as primary rail requires a proven fallback path (Base L2 or FICC) and a resilience record that warrants SR 11-7 consideration.** That's not a reason to exclude it. It's a reason to govern it properly. Which is exactly what Cato does.

### Fed L1 / PORTS notes

The `fed_l1` placeholder is not wishful thinking. Darrell Duffie is testifying before Congress about it. The GENIUS Act is moving through the legislative pipeline. When tokenized Fed reserves arrive, every system that didn't plan for them will scramble to retrofit. **Cato has the slot ready now.** The doctrine doesn't change when Fed L1 arrives; the rail does.

---

## Data Sources (All Free)

| Source | Data |
|---|---|
| **NY Fed** | SOFR, BGCR, TGCR, EFFR, repo operations |
| **FRED** | Treasury yields, fed funds, CPI, Fed balance sheet, Term SOFR |
| **TreasuryDirect** | Auction results |
| **OFR** | Financial Stress Index |
| **SEC EDGAR** | 13F filings, company filings |
| **Blockscout** | ETH gas, network stats |

---

## Installation

```bash
git clone https://github.com/br-collab/Cato---FICC-MCP
cd Cato---FICC-MCP
npm install
```

## Claude Desktop Config

```json
{
  "mcpServers": {
    "cato": {
      "command": "node",
      "args": ["/path/to/Cato---FICC-MCP/index.js"],
      "env": {
        "FRED_API_KEY": "optional_free_key_from_fred.stlouisfed.org"
      }
    }
  }
}
```

---

## Academic Foundation

- **Duffie, D. (2025).** *The Case for PORTS: Perpetual Overnight Rate Treasury Securities.* Brookings Institution. — The framework for on-chain Treasury settlement that Cato's rail comparison tools implement.
- **Duffie, D. (2025).** *How US Treasuries Can Remain the World's Safe Haven.* Journal of Economic Perspectives.

---

## Aureon Integration

Cato is the **Verana L0 data layer** in the Aureon Post-Trade eFICC architecture. The `cato_gate` and `get_atomic_settlement_gate` tools feed directly into Thifur-J's bounded autonomy engine for convergence zone settlement rail selection.

```
Aureon → Verana L0 → Cato → [NY Fed | FRED | TreasuryDirect | OFR | Blockscout]
```

---

## License

MIT — free to use, fork, and build on.

---

*Project Aureon · Ravelo Strategic Solutions LLC · Columbia University MS Technology Management*
