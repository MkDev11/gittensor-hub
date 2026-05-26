/* SN74 daily TAO emission, proxied from TaoMarketCap.
 *
 * Combines two upstream calls:
 *   1. /internal/v1/subnets/74/         → alpha price + miners_tao_per_day
 *   2. /internal/v1/subnets/neurons/74/ → per-UID alpha_per_day for all 256 UIDs
 *
 * From those we derive:
 *   alpha_price          = latest_snapshot.subnet_moving_price (TAO/alpha)
 *   per-UID TAO/day      = neuron.alpha_per_day × alpha_price
 *   recycleTaoPerDay     = UID 0   (Gittensor's recycle sink)
 *   treasuryTaoPerDay    = UID 111 (Gittensor's issues treasury)
 *   activeTaoPerDay      = sum of all other UIDs
 *   totalSubnetTaoPerDay = recycle + treasury + active = the true on-chain
 *                          daily emission to SN74
 *
 * Cached in-memory for 60s with in-flight dedup so concurrent client
 * refreshes never burst the upstream.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUBNET_URL  = 'https://api.taomarketcap.com/internal/v1/subnets/74/';
const NEURONS_URL = 'https://api.taomarketcap.com/internal/v1/subnets/neurons/74/';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const RECYCLE_UID = 0;
const TREASURY_UID = 111;
/** Bittensor block cadence: 12s/block → 7200 blocks/day. */
const BLOCKS_PER_DAY = 7200;
/** rao → alpha (1 alpha = 1e9 rao). */
const RAO_PER_ALPHA = 1e9;

interface UpstreamSnapshot {
  latest_snapshot?: {
    miners_tao_per_day?: number | string;
    /** Current instantaneous sqrt price (DEX-style). Squaring gives the
     *  alpha→TAO conversion that TaoMarketCap displays on neurons rows. */
    alpha_sqrt_price?: number | string;
    /** EMA price — older/smoothed. Used as fallback. */
    subnet_moving_price?: number | string;
    dtao?: {
      daily_alpha_emission?: number | string;
      daily_burn?: number | string;
      effective_daily_emission?: number | string;
      /** Subnet owner's alpha cut per block, in rao. Taken off the top
       *  before per-UID distribution, so it doesn't appear in the neurons
       *  endpoint. Daily owner alpha = owner_cut_per_block × 7200 / 1e9. */
      owner_cut_per_block?: number | string;
    };
  };
}

interface UpstreamNeuron {
  uid?: number;
  alpha_per_day?: number | string | null;
  is_validator?: boolean | null;
  is_miner?: boolean | null;
  hotkey?: string | null;
}

export interface Sn74EmissionSnapshot {
  /** Headline emission — matches TaoMarketCap's "Emissions/Day":
   *  daily_alpha_emission × price = full subnet emission per day. */
  totalTaoPerDay: number;
  /** Miner-side daily slice (= (total − owner) / 2). Includes recycle
   *  (UID 0) and treasury (UID 111) as sub-components since both are
   *  on-chain miner UIDs. Matches TaoMarketCap's "Miner/Day". */
  minerTaoPerDay: number;
  /** Validator-side daily slice (= (total − owner) / 2). The owner cut
   *  flows to the owner_hotkey (a validator) on-chain but is shown
   *  separately as `ownerTaoPerDay`. Matches TaoMarketCap's "Validator/Day". */
  validatorTaoPerDay: number;
  /** Per-UID recycle emission to UID 0 (Gittensor recycle sink).
   *  Sub-component of `minerTaoPerDay`. */
  recycleTaoPerDay: number;
  /** Per-UID treasury emission to UID 111 (issues treasury).
   *  Sub-component of `minerTaoPerDay`. */
  treasuryTaoPerDay: number;
  /** Per-UID sum of active (non-recycle, non-treasury) miner alpha.
   *  Used for per-repo TAO math — the "claimable for contributors"
   *  slice. NOT shown in the headline cards (those use the
   *  TaoMarketCap-style 50/50 split via `minerTaoPerDay`). */
  activeMinerTaoPerDay: number;
  /** Subnet owner's daily TAO cut, derived from
   *  `dtao.owner_cut_per_block × 7200 blocks/day`. Paid as elevated
   *  dividends to the owner_hotkey UID on-chain but surfaced separately
   *  here to match TaoMarketCap's "Owner/Day" card. */
  ownerTaoPerDay: number;
  /** Count of UIDs in each category, for context on the cards. */
  minerCount: number;
  validatorCount: number;
  /** Alpha → TAO price used for the per-UID conversion. */
  alphaPriceInTao: number;
  /** TaoMarketCap's `miners_tao_per_day` for cross-reference (a narrower
   *  metric — not the per-UID miner sum we compute). */
  minersTaoPerDayUpstream: number | null;
  /** Back-compat alias (was `taoPerDay`); same as `totalTaoPerDay`. */
  taoPerDay: number;
  alphaPerDay: number | null;
  effectiveAlphaPerDay: number | null;
  alphaBurnPerDay: number | null;
  fetched_at: number;
}

// Renamed on each schema change so Next.js HMR drops any stale
// pre-refactor cache that lacked newer fields — those would otherwise
// read as undefined → 0 on the client.
let cacheV4: Sn74EmissionSnapshot | null = null;
let inflightV4: Promise<Sn74EmissionSnapshot> | null = null;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`upstream ${url} ${r.status}`);
  return (await r.json()) as T;
}

async function refresh(): Promise<Sn74EmissionSnapshot> {
  const [subnetData, neurons] = await Promise.all([
    fetchJson<UpstreamSnapshot>(SUBNET_URL),
    fetchJson<UpstreamNeuron[]>(NEURONS_URL),
  ]);
  const snap = subnetData.latest_snapshot ?? {};
  // TaoMarketCap renders the per-UID τ/Day column as
  //   alpha_per_day × (alpha_sqrt_price)²
  // — the instantaneous DEX price, not the EMA `subnet_moving_price`.
  // Match that so our numbers align pixel-for-pixel with their site.
  // Fall back to `subnet_moving_price` if the sqrt-price field is missing.
  const sqrtPrice = num(snap.alpha_sqrt_price);
  const movingPrice = num(snap.subnet_moving_price);
  const alphaPrice = sqrtPrice != null ? sqrtPrice * sqrtPrice : movingPrice;
  if (alphaPrice == null) throw new Error('upstream missing alpha_sqrt_price and subnet_moving_price');

  // Classify each UID and accumulate alpha:
  //   UID 0       → recycle sink
  //   UID 111     → issues treasury
  //   is_validator → validator (Bittensor bundles subnet-owner cut into
  //                  validator dividends, so this also covers the owner)
  //   is_miner    → miner (PR contributor — what we surface as "claimable")
  let recycleAlpha = 0;
  let treasuryAlpha = 0;
  let minerAlpha = 0;
  let validatorCount = 0;
  let minerCount = 0;
  for (const n of neurons) {
    const a = num(n.alpha_per_day) ?? 0;
    if (n.uid === RECYCLE_UID) {
      recycleAlpha += a;
    } else if (n.uid === TREASURY_UID) {
      treasuryAlpha += a;
    } else if (n.is_validator) {
      // validator UID alpha is not summed — the headline validator
      // figure is derived from `(gross − owner) / 2`. We still count
      // UIDs for the card sub-text.
      validatorCount++;
    } else if (n.is_miner) {
      minerAlpha += a;
      minerCount++;
    }
  }

  // Headline emission math — match TaoMarketCap's authoritative figures:
  //   Emissions/Day = daily_alpha_emission × price            (gross, 7200α)
  //   Owner/Day     = owner_cut_per_block × 7200 × price
  //   Miner/Day     = (gross − owner) / 2
  //   Validator/Day = (gross − owner) / 2
  // TMC uses the 50/50 chain split between miner-side and validator-side
  // emission, post-owner-cut. Owner is shown as a separate card even
  // though on-chain it's paid to the owner_hotkey UID (which is also a
  // validator). The recycle (UID 0) and treasury (UID 111) per-UID sums
  // are kept around for the granular sub-breakdown but they're
  // sub-components of the miner-side slice — they shouldn't be added
  // on top of `minerTaoPerDay`.
  const ownerCutPerBlock = num(snap.dtao?.owner_cut_per_block);
  const ownerAlphaPerDay = ownerCutPerBlock != null
    ? (ownerCutPerBlock * BLOCKS_PER_DAY) / RAO_PER_ALPHA
    : 0;
  const dailyAlphaEmission = num(snap.dtao?.daily_alpha_emission);
  const grossAlphaPerDay = dailyAlphaEmission != null
    ? dailyAlphaEmission / RAO_PER_ALPHA
    : 0;
  const totalTaoPerDay     = grossAlphaPerDay * alphaPrice;
  const ownerTaoPerDay     = ownerAlphaPerDay * alphaPrice;
  const participantTaoPerDay = Math.max(0, totalTaoPerDay - ownerTaoPerDay);
  const minerTaoPerDay     = participantTaoPerDay / 2;
  const validatorTaoPerDay = participantTaoPerDay / 2;
  // Per-UID granular values — used only for the optional sub-breakdown
  // and for per-repo TAO math (which needs the active-miner slice).
  const recycleTaoPerDay   = recycleAlpha   * alphaPrice;
  const treasuryTaoPerDay  = treasuryAlpha  * alphaPrice;
  const activeMinerTaoPerDay = minerAlpha   * alphaPrice;

  const next: Sn74EmissionSnapshot = {
    totalTaoPerDay,
    minerTaoPerDay,
    validatorTaoPerDay,
    activeMinerTaoPerDay,
    recycleTaoPerDay,
    treasuryTaoPerDay,
    ownerTaoPerDay,
    minerCount,
    validatorCount,
    alphaPriceInTao: alphaPrice,
    minersTaoPerDayUpstream: num(snap.miners_tao_per_day),
    taoPerDay: totalTaoPerDay,
    alphaPerDay: num(snap.dtao?.daily_alpha_emission),
    effectiveAlphaPerDay: num(snap.dtao?.effective_daily_emission),
    alphaBurnPerDay: num(snap.dtao?.daily_burn),
    fetched_at: Date.now(),
  };
  cacheV4 = next;
  return next;
}

async function getCached(): Promise<Sn74EmissionSnapshot> {
  const now = Date.now();
  if (cacheV4 && now - cacheV4.fetched_at < CACHE_TTL_MS) return cacheV4;
  if (inflightV4) return inflightV4;
  inflightV4 = refresh().finally(() => {
    inflightV4 = null;
  });
  return inflightV4;
}

export async function GET() {
  try {
    const fresh = await getCached();
    return NextResponse.json({ ...fresh, source: 'live' });
  } catch (err) {
    if (cacheV4) return NextResponse.json({ ...cacheV4, source: 'stale', error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
