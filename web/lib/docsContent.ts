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
//
// Redeem tx (a holder burns RSVD; the token contract pays out four bStocks — CRCLB,
// NVDAB, SNDKB, MUB — directly to the burner's wallet in the same transaction):
// 0xaa57e40df7f9dab410e19af39a3bae34704053ec11d5ca7dc03a612e3eead9fb
//
// The token address is a proxy (confirmed by BscScan's own proxy detection), with its
// implementation at 0x776d3A522a9F61FD40eDE4604e870Ff288b53AeB. See the "upgradeability"
// section — every "confirmed" claim elsewhere in this file describes current behavior
// under that implementation, not a permanent guarantee, for as long as upgrade control
// exists.

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
      p(
        "One qualifier that applies to every claim in this document, stated up front rather than buried: see Upgradeability directly below before treating anything else here as permanent."
      ),
    ],
  },
  {
    id: "upgradeability",
    title: "Upgradeability: not fully locked down yet",
    blocks: [
      p(
        "0x5C8fB70C1Ec327434F0AC05FcE3791c10436Cb60 is a proxy, not a standalone contract — confirmed by BscScan's own proxy detection, which shows its implementation living at a separate address, 0x776d3A522a9F61FD40eDE4604e870Ff288b53AeB. Every call to the token routes through to whatever contract that address currently points at."
      ),
      p(
        "That matters for everything else on this page: a proxy's admin can redeploy the implementation at any time, changing what burn() does, whether a mint function exists, how the liquidity position is handled — anything — while the token's address, balance history and holder base stay exactly the same. Every claim described elsewhere in these docs as \"confirmed\" or \"verified\" describes what the current implementation does, checked against a real cited transaction. None of it is a claim about what the contract can be made to do in the future."
      ),
      p(
        "As of this writing, upgrade control has not been renounced. The project has stated this is deliberate, not an oversight: the proxy is being kept upgradeable while testing is still underway, with the stated intent to renounce it once that's complete. We'd rather say that plainly here than let the confident, cited tone of the rest of this page imply more permanence than currently exists. This section will be updated the moment renouncement happens, cited the same way as everything else in this file."
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
        "Calling burn(uint256) on your own balance does more than remove RSVD from supply: the contract pays out a pro-rata share of every bStock the treasury holds, to you, in that same transaction — confirmed by a real, executed burn (tx 0xaa57e40d…ead9fb). See Treasury below for what that transaction actually shows.",
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
        "The design: every trade against the RSVD pool generates a swap fee, the token contract harvests that fee in BNB (confirmed live and automatic, from the very first trade — see Liquidity above), and that BNB is what funds buying a basket of bStocks, landing at the same treasury address anyone can already check. Fee in, bStocks out, same contract the whole way — not a separate keeper wallet or a converter contract handling money in between."
      ),
      p(
        "What's independently confirmed on-chain versus what's the documented design, stated plainly: fee harvesting into BNB is proven, cited above. bStocks arriving at the treasury is proven — the redeem transaction below shows four of them sitting there and being paid out. That the harvested BNB specifically is what purchases those bStocks — as opposed to some other funding source — hasn't yet been observed in a cited transaction the way everything else on this page has. We'll cite that transaction the first time we see it, the same way as everywhere else here, rather than round the design up to a confirmed fact ahead of proof."
      ),
      p(
        "Redemption is confirmed live. In tx 0xaa57e40d…ead9fb, a holder called burn(185,458.208224…) on their own RSVD balance, and in that same transaction the token contract sent them a pro-rata share of every bStock the treasury held at the time — CRCLB, NVDAB, SNDKB and MUB all moved from the treasury address to the burner's wallet, cited directly from that transaction's logs, not described ahead of proof. This site's Redeem button calls the same burn(uint256) function."
      ),
      p(
        "One thing that transaction doesn't settle: the exact formula the contract uses (share of supply at the instant of the burn, rounding behavior, and so on). The site's own \"you will receive\" preview is a client-side estimate computed the same simple way — your balance's share of total supply, times current holdings — not a call into the contract's own math, so treat it as an estimate rather than a guaranteed quote."
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
        "Directly verified on-chain, cited by transaction above: the liquidity position is owned by the token contract's own address, not a wallet or an NFT; fee collection into BNB happens automatically, confirmed on the first trade after launch; the full supply was minted exactly once, at launch, straight into the pool; burning RSVD pays out a pro-rata share of the treasury's bStock holdings to the burner, confirmed by a real executed burn. See Upgradeability above first, though: every item in this list describes the current implementation behind the token's proxy, not a permanent guarantee, until upgrade control is renounced."
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
        "The token is upgradeable and upgrade control has not been renounced yet (see Upgradeability above) — until it is, an admin key can change how this contract behaves, including everything else described on this page.",
        "Custodial trust, one layer up: bStocks are ultimately backed by Binance/BTech Holdings' Abu Dhabi SPV custody, tracked via Binance's Proof of Collateral — this is \"verifiable,\" not \"trustless.\"",
        "PancakeSwap liquidity for individual bStock pairs may be thin, especially for newly issued ones — large trades can have real price impact regardless of the on-chain behavior described above.",
        "Not community-governed beyond the non-binding vote described above.",
        "Redemption pays out whatever the treasury holds at the moment you burn — if it holds little or nothing of a given bStock, your share of that asset is little or nothing too. See Treasury above for how to check current holdings before redeeming.",
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
      p(
        "有一条限定说明适用于本文档中的每一项陈述，在此先明确提出，而非放在文末带过：请先阅读下方紧接的“可升级性”部分，再将本页其余内容视为永久不变。"
      ),
    ],
  },
  {
    id: "upgradeability",
    title: "可升级性：尚未完全锁定",
    blocks: [
      p(
        "0x5C8fB70C1Ec327434F0AC05FcE3791c10436Cb60 是一个代理合约，而非独立合约 —— 这一点已由 BscScan 自身的代理检测确认，其显示实现合约位于另一独立地址 0x776d3A522a9F61FD40eDE4604e870Ff288b53AeB。对代币的每一次调用，都会转发至该地址当前指向的合约。"
      ),
      p(
        "这一点关系到本页其余的每一项内容：代理合约的管理员可以随时更换实现合约，从而改变 burn() 的行为、是否存在增发函数、流动性头寸的处理方式 —— 任何方面都可能改变，而代币地址、余额历史与持有人基础则保持不变。本文档其他部分所说的“已确认”或“已核实”，指的都是当前实现合约、经由真实交易核实后的行为，并不构成对该合约未来行为的承诺。"
      ),
      p(
        "截至本文撰写时，升级权限尚未放弃。项目方表示这是有意为之，而非疏漏：在测试仍在进行期间，代理合约被有意保留为可升级状态，计划在测试完成后放弃该权限。我们选择在此明确说明这一点，而不是让本页其余部分自信、有据可查的语气，暗示出目前尚不存在的永久性保证。一旦放弃升级权限的操作发生，本部分将以本文件一贯的方式引用具体交易并更新。"
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
        "对自己的余额调用 burn(uint256) 所做的不只是从总供应量中移除 RSVD：合约会在同一笔交易中，按比例将资金库持有的每一支 bStock 支付给您 —— 已由一笔真实执行的销毁交易确认（交易哈希 0xaa57e40d…ead9fb）。该交易的具体内容详见下方“资金库”部分。",
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
        "设计如下：每一笔针对 RSVD 交易池的交易都会产生一笔交易手续费，代币合约会以 BNB 形式收取该手续费（已确认实时自动发生，自第一笔交易起即是如此 —— 详见上文“流动性”部分），而这部分 BNB 正是用于购入一篮子 bStocks 的资金来源，购入后落地于同一个任何人都已可核实的资金库地址。手续费进来，bStocks 出去，全程都在同一个合约内完成 —— 中间没有单独的 keeper 钱包或转换合约经手资金。"
      ),
      p(
        "明确区分哪些已在链上独立核实、哪些仍是记录在案的设计：手续费自动收取为 BNB 已获证实，如上文所引用。bStocks 抵达资金库同样已获证实 —— 下文的赎回交易显示其中四支正持有在资金库中并已被支付出去。而“收取的 BNB 正是用于购入这些 bStocks 的资金”这一环节，尚未像本页其他内容那样，通过一笔被引用的具体交易得到直接观察确认。一旦我们看到这样的交易，会以本页一贯的方式引用它，而不会在证实之前就把设计拔高为既成事实。"
      ),
      p(
        "赎回功能已确认上线。在交易 0xaa57e40d…ead9fb 中，一位持有者对自己的 RSVD 余额调用了 burn(185,458.208224…)，而在同一笔交易中，代币合约按比例向其支付了当时资金库持有的每一支 bStock —— CRCLB、NVDAB、SNDKB 与 MUB 均从资金库地址转移到了该销毁者的钱包，这些数据直接引用自该交易的日志，而非在得到证实之前先行描述。本网站的“赎回”按钮调用的正是同一个 burn(uint256) 函数。"
      ),
      p(
        "这笔交易本身无法说明的是：合约所使用的精确计算公式（销毁那一刻的供应量占比、取整方式等细节）。网站自身的“预计可获得”预览，是以同样简单的方式在客户端计算得出 —— 您的余额占总供应量的比例，乘以当前持仓 —— 并非调用合约自身的计算逻辑，因此请将其视为估算值，而非有保证的报价。"
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
        "已在链上直接核实、并在上文引用具体交易作为依据的内容：流动性头寸由代币合约自身地址持有，而非钱包或 NFT；手续费以 BNB 形式自动收取，已在启动后第一笔交易中得到确认；全部供应量已在启动时一次性铸造，直接进入交易池；销毁 RSVD 会按比例向销毁者支付资金库持有的 bStock，已由一笔真实执行的销毁交易确认。不过请先参考上文“可升级性”部分：以上每一项描述的都是代币代理合约当前所指向实现合约的行为，而非永久性保证 —— 直到升级权限被放弃为止。"
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
        "代币目前是可升级的，且升级权限尚未放弃（详见上文“可升级性”部分）—— 在此之前，管理员密钥可以改变该合约的行为，包括本页描述的其他一切内容。",
        "上一层的托管信任：bStocks 最终由币安 / BTech Holdings 位于阿布扎比的 SPV 托管支撑，并通过币安的储备证明进行追踪 —— 这是“可验证”，而非“无需信任”。",
        "个别 bStock 交易对在 PancakeSwap 上的流动性可能较薄，尤其是新发行的品种 —— 无论上述链上行为如何，大额交易仍可能造成实际的价格冲击。",
        "除上述非约束性投票外，并未实现社区治理。",
        "赎回所支付的是您销毁那一刻资金库实际持有的资产 —— 若资金库某支 bStock 持仓很少甚至为零，您在该资产上分得的份额也会相应很少或为零。赎回前请先参考上方“资金库”部分核实当前持仓。",
        "RSVD 代表对一篮子代币化股票敞口储备的权益凭证。本页面仅供参考，不构成财务或法律建议，页面中的任何内容均不构成证券要约。",
      ]),
    ],
  },
];

export const docsContent: Record<Locale, DocsSection[]> = { en, zh };
