import type { Locale } from "./i18n";

// Long-form documentation content, kept separate from lib/i18n.ts (which holds short
// UI strings) since these are full paragraphs, not phrases reused across components.
// Every claim here is checked against an actual on-chain transaction where one exists —
// cited by short hash so it's independently checkable, not just asserted. Where a claim
// hasn't been independently verified (contract source not reviewed line-by-line here),
// that's said plainly in Security rather than rounded up to a stronger claim.
//
// Launch tx (token opens the pool, seeds liquidity, buys, and collects its first fee,
// all in one transaction — cited throughout this file):
// 0x9444fa2aeb525201da10c683826a14526df8f59630dbffc23f4c29adb0d44355

export type DocsBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };
export type DocsSection = { id: string; title: string; blocks: DocsBlock[] };

const p = (text: string): DocsBlock => ({ type: "p", text });
const ul = (items: string[]): DocsBlock => ({ type: "ul", items });

const en: DocsSection[] = [
  {
    id: "overview",
    title: "Overview",
    blocks: [
      p(
        "Reserved (RSVD) is a fixed-supply BEP-20 on BNB Chain. At launch, the token contract itself opened the PancakeSwap V3 pool and seeded 100% of the initial liquidity — not a deployer wallet, not a locker service, and not through a position-manager NFT that could later be transferred or sold. Every claim in this section and the next is checked against the launch transaction (tx 0x9444fa2a…d44355) and the pool's own event log."
      ),
      p(
        "This isn't a DAO, and the treasury isn't community-operated day to day. \"Vote the next bStock\" (see Governance below) is a real, on-chain, non-binding signal — not a claim that holders decide what gets bought."
      ),
    ],
  },
  {
    id: "token",
    title: "The token (RSVD)",
    blocks: [
      p(
        "RSVD's entire supply — 1,000,000,000 — was minted exactly once, directly into the PancakeSwap V3 pool, as part of the single launch transaction. No RSVD has been minted before or since that transaction."
      ),
      ul([
        "No transfer tax. Trading costs only the pool's own swap fee — the pool's PoolCreated event confirms a fee of 100 (PancakeSwap V3's units, equal to 0.01%) — not anything charged by the token itself on top.",
        "Burn (via ERC20Burnable) is the mechanism a redemption feature would use to remove RSVD from supply against a treasury payout — see Treasury below for where that actually stands today.",
      ]),
    ],
  },
  {
    id: "liquidity",
    title: "Liquidity: no NFT, no wallet, no locker",
    blocks: [
      p(
        "A typical launch mints a position through PancakeSwap's NonfungiblePositionManager, which hands back an NFT. Whoever holds that NFT can remove the liquidity, and an NFT can be transferred, lost, or stolen like any other asset. RSVD skipped that path: the token contract called the pool's mint() function directly, naming itself as the position's owner rather than routing through a position manager. This is confirmed directly by the pool's own Mint event in the launch transaction, which names owner as the RSVD token contract's address — not a wallet, not a locker contract, not an NFT."
      ),
      p(
        "The position was seeded single-sided — RSVD only, no BNB — from just above the launch price up to the maximum tick PancakeSwap V3 allows. BNB coming in from buys accumulates as trading fees rather than sitting idle in the position."
      ),
      p(
        "The token contract collects those trading fees itself, directly, in BNB. On the very first trade after launch, in that same transaction, it called the pool's burn(0) — a zero-amount call that updates accrued fees without removing any liquidity (amount, amount0 and amount1 in that Burn event were all exactly 0, meaning nothing was withdrawn) — then collect(), pulling the fee out as WBNB. That sequence is live and automatic, not a manual or planned step."
      ),
      p(
        "What that one transaction doesn't settle by itself: whether this same contract could ever call burn() with a non-zero amount — meaning withdrawing the underlying liquidity itself, not just collecting fees earned on it — for anyone, including an owner, or whether that's not possible for anyone at all. The position is confirmed owned by the contract rather than a wallet; whether the contract's code exposes any path to move the principal is a separate question addressed honestly in Security below, not rounded up here."
      ),
    ],
  },
  {
    id: "treasury",
    title: "The treasury",
    blocks: [
      p(
        "bStocks the treasury acquires are held directly at RSVD's own contract address — there is no separate vault contract. That means anyone can check exactly what's held, and how much, on BscScan's \"Tokens\" tab for that address, at any time, rather than trusting a claimed figure."
      ),
      p(
        "Fee collection into BNB, described above, is confirmed live and automatic from the very first trade. Using that accumulated BNB to acquire bStocks is the next step in the same pipeline — we'll cite the transaction that does it the first time it happens, the same way everything above is cited, rather than describe it ahead of confirming it."
      ),
      p(
        "Redemption — burning RSVD to claim a pro-rata share of whatever the treasury currently holds — is planned, and is what this site's Redeem button is built to do once it's live. It is not live today: there is currently no contract function that pays out reserve assets against a burn, so burning RSVD right now does not return anything. Said plainly here so the button's \"Coming Soon\" state isn't the only place that's clear."
      ),
    ],
  },
  {
    id: "governance",
    title: "Governance: vote the next bStock",
    blocks: [
      p(
        "Any wallet holding at least 100,000 RSVD can cast a non-binding, on-chain vote for which blue-chip stock the reserve should prioritize once Binance issues a bStock for it. Voting is gated by balance at the time of the vote, not by staking or locking tokens — you keep full custody and control throughout."
      ),
      p(
        "This is a signal, not a binding instruction: the governance contract has no access to RSVD or the treasury, and can't cause anything to actually be bought. It only reads RSVD's balance to decide who's eligible to vote."
      ),
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      p(
        "Directly verified on-chain, cited by transaction above: the liquidity position is owned by the token contract's own address, not a wallet or an NFT; fee collection into BNB happens automatically, confirmed on the first trade after launch; the full supply was minted exactly once, at launch, straight into the pool."
      ),
      p(
        "Not yet independently confirmed: the contract's source hasn't been reviewed line-by-line here, so stronger claims — \"no owner can ever withdraw the liquidity,\" \"no mint function exists,\" \"nothing is pausable\" — aren't things this page stands behind with the same confidence as the paragraph above. We'd rather list that as an open question than round it up to something it isn't yet."
      ),
      p(
        "Also open: a professional third-party security audit, and securities-classification legal review. Neither has happened. Read everything on this page as \"verified against a cited on-chain transaction where a citation appears\" — not as a completed audit."
      ),
    ],
  },
  {
    id: "risks",
    title: "Risks & disclaimers",
    blocks: [
      ul([
        "Custodial trust, one layer up: bStocks are ultimately backed by Binance/BTech Holdings' Abu Dhabi SPV custody, tracked via Binance's Proof of Collateral — this is \"verifiable,\" not \"trustless.\"",
        "PancakeSwap liquidity for individual bStock pairs may be thin, especially for newly issued ones — large trades can have real price impact regardless of the on-chain behavior described above.",
        "Not community-governed beyond the non-binding vote described above.",
        "Redemption is not live yet — see Treasury above. Holding RSVD today is not currently redeemable for treasury assets by any on-chain mechanism.",
        "RSVD represents a claim on a reserve of tokenized-equity exposure. This page is informational only, not financial or legal advice, and nothing here is an offer to sell securities.",
      ]),
    ],
  },
];

const zh: DocsSection[] = [
  {
    id: "overview",
    title: "概述",
    blocks: [
      p(
        "Reserved（RSVD）是运行于 BNB Chain 的固定总量 BEP-20 代币。启动时，代币合约本身直接开设了 PancakeSwap V3 交易池，并注入了全部初始流动性 —— 既不是部署者钱包，也不是锁仓服务，更没有通过头寸管理合约生成可被转让或出售的 NFT。本节及下一节的每一项陈述均已对照启动交易（交易哈希 0x9444fa2a…d44355）及交易池自身的事件日志核实。"
      ),
      p(
        "这不是一个 DAO，资金库日常运作也并非由社区管理。下文治理部分提到的“为下一支 bStock 投票”功能，是真实的、链上的、非约束性信号 —— 并不代表持有者可以决定实际购买什么。"
      ),
    ],
  },
  {
    id: "token",
    title: "代币（RSVD）",
    blocks: [
      p(
        "RSVD 的全部供应量 —— 1,000,000,000 枚 —— 在启动交易中一次性直接铸造进入 PancakeSwap V3 交易池。在此之前及之后均未再发生任何铸造。"
      ),
      ul([
        "完全不收取转账税。交易成本仅为池子自身的手续费 —— 池子的 PoolCreated 事件确认费率为 100（PancakeSwap V3 单位，等于 0.01%）—— 并非代币层面额外收取的费用。",
        "销毁（通过 ERC20Burnable）是未来赎回功能用于在资金库支付后从总供应量中移除 RSVD 的机制 —— 该功能目前的实际状态详见下方“资金库”部分。",
      ]),
    ],
  },
  {
    id: "liquidity",
    title: "流动性：没有 NFT，没有钱包，没有锁仓方",
    blocks: [
      p(
        "典型的做法是通过 PancakeSwap 的头寸管理合约（NonfungiblePositionManager）铸造头寸，并返回一枚 NFT —— 持有该 NFT 者即可移除流动性，而 NFT 和其他资产一样，可能被转让、遗失或盗取。RSVD 绕开了这一路径：代币合约直接调用了交易池自身的 mint() 函数，将自己指定为头寸的所有者，而非经由头寸管理合约。这一点已由启动交易中池子自身的 Mint 事件直接确认 —— owner 字段记录的正是 RSVD 代币合约地址，而非某个钱包、锁仓合约或 NFT。"
      ),
      p(
        "该头寸以单边方式注入 —— 仅有 RSVD，不含 BNB —— 区间从略高于启动价格一直延伸到 PancakeSwap V3 允许的最大刻度（tick）。买入带来的 BNB 会以交易手续费的形式累积，而非闲置在头寸之中。"
      ),
      p(
        "代币合约会自行、直接以 BNB 形式收取这些交易手续费。在启动后的第一笔交易中（同一笔交易内），它调用了池子的 burn(0) —— 一次金额为零的调用，仅更新累计手续费而不移除任何流动性（该 Burn 事件中的 amount、amount0、amount1 均恰好为 0，意味着没有任何提取发生）—— 随后调用 collect()，以 WBNB 形式将手续费取出。这一流程是实时且自动发生的，并非人工操作或规划中的步骤。"
      ),
      p(
        "这一笔交易本身尚无法说明的是：同一个合约是否可能在某种情况下以非零金额调用 burn() —— 也就是提取标的流动性本身，而非仅仅收取其产生的手续费 —— 无论是对任何人（包括所有者）而言是否可行，还是对任何人而言都不可行。头寸本身已确认由该合约持有，而非某个钱包；至于该合约代码中是否存在可动用本金的路径，是一个需要另行、如实说明的问题，详见下方“安全性”部分，此处不作夸大。"
      ),
    ],
  },
  {
    id: "treasury",
    title: "资金库",
    blocks: [
      p(
        "资金库收购的 bStocks 直接持有在 RSVD 自身的合约地址上 —— 不存在单独的金库合约。这意味着任何人都可以随时在该地址的 BscScan “Tokens” 标签页中核实具体持有了什么、持有多少，而无需信任某个声称的数字。"
      ),
      p(
        "如上文所述，手续费以 BNB 形式的自动收取，已确认自第一笔交易起便实时自动发生。使用这部分累积的 BNB 收购 bStocks 是同一流程的下一步 —— 这一步首次发生时，我们会像上文一样引用具体交易作为依据，而不会在确认之前提前描述。"
      ),
      p(
        "赎回 —— 销毁 RSVD 以按比例领取资金库当前持有资产的份额 —— 处于规划阶段，也是本网站“赎回”按钮在功能上线后要实现的效果。目前尚未上线：当前不存在任何在销毁时支付储备资产的合约函数，因此现在销毁 RSVD 不会返回任何资产。在此明确说明，而不仅仅依赖按钮上的“即将推出”状态。"
      ),
    ],
  },
  {
    id: "governance",
    title: "治理：为下一支 bStock 投票",
    blocks: [
      p(
        "任何持有至少 100,000 RSVD 的钱包都可以为币安尚未发行 bStock 的蓝筹股投出非约束性的链上投票，表达储备下一步应优先收购哪一支。投票资格根据投票时的持仓判定，代币无需质押或锁定 —— 您始终完全掌控和拥有自己的代币。"
      ),
      p("这只是一种信号，而非约束性指令：治理合约无法访问 RSVD 或资金库，也无法促成任何实际购买。它仅读取 RSVD 余额以判断谁具备投票资格。"),
    ],
  },
  {
    id: "security",
    title: "安全性",
    blocks: [
      p(
        "已在链上直接核实、并在上文引用具体交易作为依据的内容：流动性头寸由代币合约自身地址持有，而非钱包或 NFT；手续费以 BNB 形式自动收取，已在启动后第一笔交易中得到确认；全部供应量已在启动时一次性铸造，直接进入交易池。"
      ),
      p(
        "尚未独立核实的内容：本页尚未对合约源码逐行审查，因此诸如“任何所有者都永远无法提取流动性”“不存在增发函数”“不存在任何可暂停的功能”等更强的表述，其确定程度不及上一段所列内容。我们选择将其列为待核实的问题，而非将其拔高为尚未达到的结论。"
      ),
      p(
        "同样尚待完成的：专业的第三方安全审计，以及证券属性合规法律审查。二者均尚未进行。请将本页内容理解为“凡有引用具体链上交易之处即已核实”，而非“已完成审计”。"
      ),
    ],
  },
  {
    id: "risks",
    title: "风险与免责声明",
    blocks: [
      ul([
        "上一层的托管信任：bStocks 最终由币安 / BTech Holdings 位于阿布扎比的 SPV 托管支撑，并通过币安的储备证明进行追踪 —— 这是“可验证”，而非“无需信任”。",
        "个别 bStock 交易对在 PancakeSwap 上的流动性可能较薄，尤其是新发行的品种 —— 无论上述链上行为如何，大额交易仍可能造成实际的价格冲击。",
        "除上述非约束性投票外，并未实现社区治理。",
        "赎回功能尚未上线 —— 详见上方“资金库”部分。目前持有 RSVD 并不能通过任何链上机制兑换资金库资产。",
        "RSVD 代表对一篮子代币化股票敞口储备的权益凭证。本页面仅供参考，不构成财务或法律建议，页面中的任何内容均不构成证券要约。",
      ]),
    ],
  },
];

export const docsContent: Record<Locale, DocsSection[]> = { en, zh };
