import type { Locale } from "./i18n";

// Long-form documentation content, kept separate from lib/i18n.ts (which holds short
// UI strings) since these are full paragraphs, not phrases reused across components.
// Every claim here is checked against what the contracts actually do — not aspirational
// copy. See contracts/README.md's Security section for the underlying detail this
// summarizes; if the two ever disagree, contracts/README.md is the source of truth.

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
        "Reserved is an on-chain treasury on BNB Chain that acquires and holds tokenized stocks (Binance bStocks) for the long term. RSVD is a fixed-supply BEP-20 token with no transfer tax and no admin functions of any kind. Any RSVD holder can burn their tokens at any time to redeem a pro-rata share of everything the vault holds — no permission, no waiting period, no DAO vote required to exit."
      ),
      p(
        "The mechanic is modeled on backed.is (Robinhood Chain), retargeted to BNB Chain and Binance's own bStocks. It was built without access to backed.is's deployed source, so treat it as a reconstruction of the described mechanic, not a line-by-line port."
      ),
      p(
        "Nothing here is a DAO, and the treasury is keeper-operated, not community-operated, at launch. The \"Vote the next bStock\" feature (see Governance below) is a real, on-chain, non-binding signal — not a claim that holders control what gets bought."
      ),
    ],
  },
  {
    id: "token",
    title: "The token (RSVD)",
    blocks: [
      p(
        "RSVD is a standard BEP-20 with a fixed supply set at deployment — there is no mint function reachable after deploy, by anyone, including the owner. Total supply only ever goes down, via burns."
      ),
      ul([
        "No tax on transfers at all. A fee charged at the token level cannot work against a Uniswap-V3-style pool: the pool verifies it received the full input amount and reverts otherwise, so a taxed sale fails while buys still succeed — which is the honeypot pattern itself. Trading costs only the pool's own swap fee.",
        "The tax rate is owner-adjustable but hard-capped at 5% — it can never be raised to a level that functions as a rug.",
        "Ordinary wallet-to-wallet transfers are never taxed, only trades against a registered pair.",
        "Burn (via ERC20Burnable) is how redemption removes tokens from supply — see Vault & Redemption below.",
        "Ownership uses Ownable2Step, not plain Ownable: transferring ownership requires the new owner to explicitly accept it, closing off the classic \"fat-fingered transferOwnership permanently bricks admin control\" failure mode.",
      ]),
    ],
  },
  {
    id: "fee",
    title: "The 3% fee, and why it lives at the pool",
    blocks: [
      p(
        "RSVD charges nothing on transfers. The 3% is charged by a swap hook attached to the pool, not by the token — and that distinction is the whole design, not an implementation detail."
      ),
      p(
        "A fee taken at the token level cannot work against a modern concentrated-liquidity pool. Such a pool measures its own balance across the swap and reverts unless it received the full input amount, so a fee skimmed on the way in leaves it short and the sale fails. Buys still succeed, because there the taxed leg is the pool paying the buyer and the pool never inspects that side. Buys working while sells revert is exactly the honeypot signature — which is why so many taxed tokens are stuck on older AMMs."
      ),
      p("Moving the fee to the pool avoids that entirely, and buys three things:"),
      ul([
        "RSVD stays a plain ERC20. No fee-on-transfer means aggregators, lending markets, bridges and centralised venues can all handle it — a taxed token is excluded or mishandled by most of them.",
        "Holders can always sell their entire position. A token-level fee has to come from somewhere beyond the amount the pool is owed, so a taxed sale needs a balance larger than the sale itself. At the pool, that constraint disappears.",
        "The fee is collected in BNB rather than RSVD. On a buy the hook takes its share of the BNB going in; on a sell, of the BNB coming out. Either way the treasury receives BNB directly.",
      ]),
      p(
        "That last point removes an entire subsystem. A treasury funded in RSVD has to sell it before it can buy anything, which means the protocol itself becomes a persistent seller of its own token, and that sale needs oracle machinery — a time-weighted price floor, slippage bounds, per-transaction caps — to stop a compromised keeper dumping into the pool. Collecting in BNB deletes the sale, the sell pressure and the oracle surface together."
      ),
      p(
        "Sequencing: the token and pool launch first, and the hook follows. A hook binds to a pool at creation, so enabling it means a new pool and moving liquidity across. Until it is live, treasury income is the pool's own 0.25% trading fee on protocol-owned liquidity."
      ),
    ],
  },
  {
    id: "treasury-converter",
    title: "From fee to bStock",
    blocks: [
      p(
        "Fee revenue is routed to a contract, not a wallet. A wallet holding accumulated revenue would mean whoever holds that private key can do anything with it before conversion — no on-chain constraint at all. The converter closes that gap."
      ),
      p("It exposes keeper-gated functions, each bounded, and nothing else moves value out of it:"),
      ul([
        "acquireReserveAsset — spends BNB on an owner-allowlisted bStock, capped by a per-transaction limit and by a rolling cumulative window, so a compromised key cannot drain by repetition the way a per-transaction cap alone allows. Where a Chainlink USD feed exists for the asset, the contract computes its own price floor and takes the stricter of that and the keeper's own quote. By default an allowlisted asset with no feed makes the call refuse rather than silently trust an unverified price.",
        "depositReserveAsset — forwards an allowlisted bStock the converter holds into the vault. This is the only way value ever reaches the vault from here.",
      ]),
      p(
        "The buy leg is deliberately venue-agnostic: it forwards opaque calldata to an owner-allowlisted target and judges the result purely by observed balance deltas plus that independent oracle floor. Binding a treasury contract to one market structure guarantees a rediscovery later — this project has already had to relearn that once."
      ),
      p(
        "There is no withdraw, rescue, or sweep function anywhere in this contract, for the owner or anyone else. A compromised keeper key can only trigger bounded, price-checked, pre-allowlisted conversions into the vault — it cannot extract value in any direction."
      ),
    ],
  },
  {
    id: "vault",
    title: "The vault & redemption",
    blocks: [
      p(
        "The vault holds every bStock the treasury has acquired, as plain BEP-20 balances — inspectable on BscScan by anyone, at any time, block by block."
      ),
      p(
        "Redeeming is a single call: burn RSVD (via burnFrom, so the vault needs an allowance first) and receive a pro-rata share of every reserve asset the vault currently holds, computed against total supply from before the burn so two redeemers in the same block both get their fair share rather than the second one benefiting from the first one's burn."
      ),
      p(
        "If one reserve asset's transfer fails during a redemption — it reverts, blacklists the vault, is paused, or is otherwise broken — that specific asset is skipped rather than reverting the entire redemption. A single bad token can't lock everyone else's exit; the tradeoff is that the redeemer's claim on that one broken asset is not preserved for a later retry."
      ),
    ],
  },
  {
    id: "keeper",
    title: "The keeper bot",
    blocks: [
      p(
        "An off-chain service periodically calls the treasury converter's own bounded functions — it has no privileged access beyond what TreasuryConverter.keeper already grants, and everything it can do is capped and price-checked on-chain regardless of what the bot itself decides."
      ),
      ul([
        "Sells accrued RSVD once its TWAP checkpoint window has elapsed.",
        "Buys each allowlisted bStock once its own TWAP + Chainlink price floor is ready, simulating the trade first so thin on-chain liquidity fails fast instead of reverting a real transaction.",
        "Deposits whatever it acquires into the vault.",
        "Falls through to a Binance API buy-and-withdraw path when on-chain liquidity is too thin for a clean fill — this fallback is wired into the bot's control flow but not yet implemented against a real Binance account, and is documented as such rather than silently faked.",
      ]),
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
        "This is a signal, not a binding instruction: the governance contract has no access to RSVD, the vault, or the treasury converter, and can't cause anything to actually be bought. It only reads RSVD's balance to decide who's eligible to vote."
      ),
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      p("What's been deliberately hardened, verified by an automated test suite covering every contract:"),
      ul([
        "No fund-drain backdoor: no owner-only withdraw/rescue function for vault or treasury assets, anywhere.",
        "No mint, no blacklist, no pause, no owner — the contract exposes nothing beyond ERC20 and burn, so there is no privileged call for a scanner to flag or for anyone to make.",
        "Ownable2Step everywhere, not plain Ownable.",
        "Emergency pause exists but is structurally incapable of blocking an exit: burns are exempt from the token's pause, and redeem() doesn't carry the vault's pause modifier at all.",
        "Timelock-ready ownership: contracts can be handed to a TimelockController so admin changes require a schedule-then-execute delay rather than taking effect instantly.",
      ]),
      p(
        "What hasn't happened yet: a professional security audit, and securities-classification legal review. Neither is optional before any public/mainnet launch with real value at stake — treat everything above as \"carefully built and tested,\" not \"audited.\""
      ),
    ],
  },
  {
    id: "risks",
    title: "Risks & disclaimers",
    blocks: [
      ul([
        "Custodial trust, one layer up: bStocks are ultimately backed by Binance/BTech Holdings' Abu Dhabi SPV custody, tracked via Binance's Proof of Collateral — this is \"verifiable,\" not \"trustless.\"",
        "PancakeSwap liquidity for individual bStock pairs may be thin, especially for newly issued ones — large trades can have real price impact regardless of the on-chain protections described above.",
        "Not community-governed beyond the non-binding vote described above — the keeper decides what actually gets bought.",
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
        "Reserved 是一个运行于 BNB Chain 的链上资金库，长期收购并持有代币化股票（币安 bStocks）。RSVD 是固定总量的 BEP-20 代币，不收取任何转账税，也没有任何管理员权限。任何 RSVD 持有者均可随时销毁代币，按比例赎回金库持有的全部资产 — 无需许可、无需等待、无需 DAO 投票即可退出。"
      ),
      p(
        "该机制参照 backed.is（Robinhood Chain）设计，并针对 BNB Chain 与币安自有的 bStocks 进行了改造。由于构建过程中无法访问 backed.is 的已部署源码，请将其视为对所述机制的重新实现，而非逐行移植。"
      ),
      p(
        "这不是一个 DAO：启动阶段资金库由 keeper（管理机器人）运营，而非社区运营。下文治理部分提到的“为下一支 bStock 投票”功能，是真实的、链上的、非约束性信号 — 并不代表持有者可以决定实际购买什么。"
      ),
    ],
  },
  {
    id: "token",
    title: "代币（RSVD）",
    blocks: [
      p("RSVD 是标准的 BEP-20 代币，总量在部署时固定 — 部署后任何人（包括所有者）都无法再增发。总供应量只会因销毁而减少。"),
      ul([
        "完全不收取转账税。在 Uniswap V3 架构的池子中，代币层面的税费无法运作：池子会校验是否收到完整的输入数量，否则直接回滚，因此卖出会失败而买入仍然成功 — 这正是蜜罐的表现。交易成本仅为池子本身的手续费。",
        "税率可由所有者调整，但硬性上限为 5% — 永远不会被提高到足以构成收割的程度。",
        "普通钱包间转账不征税，仅针对与已注册交易对的交易征税。",
        "赎回通过销毁（ERC20Burnable）将代币从总供应量中移除 — 详见下方“金库与赎回”。",
        "所有权采用 Ownable2Step 而非普通 Ownable：转移所有权需新所有者显式接受，避免了“误操作 transferOwnership 导致管理权限永久失效”这一经典故障模式。",
      ]),
    ],
  },
  {
    id: "fee",
    title: "3% 手续费，以及它为何位于池子层面",
    blocks: [
      p("RSVD 对转账不收取任何费用。3% 由挂载在池子上的 swap hook 收取，而非由代币本身收取 —— 这一区别正是整体设计的核心，而非实现细节。"),
      p(
        "在现代集中流动性池中，代币层面的费用根本无法运作。此类池会在交换过程中校验自身余额，若未收到完整的输入数量便直接回滚；因此在转入途中被抽走的费用会使池子收款不足，卖出随之失败。而买入仍能成功，因为此时被征税的一方是池子向买家付款，池子并不校验这一侧。买入正常、卖出回滚 —— 这正是蜜罐的典型特征，也是众多征税代币被困在老版本 AMM 上的原因。"
      ),
      p("将费用移至池子层面可彻底规避该问题，并带来三点收益："),
      ul([
        "RSVD 保持为标准 ERC20。没有转账税意味着聚合器、借贷市场、跨链桥以及中心化平台都能正常支持它 —— 征税代币会被其中大多数排除或错误处理。",
        "持有者可随时卖出全部仓位。代币层面的费用必须来自池子应收数量之外的部分，因此一笔被征税的卖出所需余额会大于卖出本身。在池子层面收费后，这一限制不复存在。",
        "费用以 BNB 而非 RSVD 收取。买入时 hook 从流入的 BNB 中抽取份额，卖出时则从流出的 BNB 中抽取。无论哪种情况，资金库都直接收到 BNB。",
      ]),
      p(
        "最后一点消除了一整个子系统。以 RSVD 计价的资金库必须先卖出代币才能进行采购，这意味着协议自身会成为其代币的长期卖方，而该卖出操作还需要预言机机制 —— 时间加权价格下限、滑点约束、单笔交易上限 —— 来防止 keeper 私钥被攻破后向池子倾销。以 BNB 收取费用同时消除了这笔卖出、卖压与预言机攻击面。"
      ),
      p(
        "推进顺序：代币与池子先行上线，hook 随后跟进。hook 在池子创建时即绑定，因此启用它意味着创建新池并迁移流动性。在其上线之前，资金库收入来自协议自持流动性所产生的池子 0.25% 交易手续费。"
      ),
    ],
  },
  {
    id: "treasury-converter",
    title: "从手续费到 bStock",
    blocks: [
      p("手续费收入会进入合约，而非钱包。若由钱包持有累积收入，持有该私钥的人可在兑换前对资金为所欲为 —— 完全没有链上约束。转换合约正是为弥补这一漏洞而设计。"),
      p("它暴露若干受 keeper 权限限制的函数，且均设有边界，除此之外没有任何途径可将价值转出："),
      ul([
        "acquireReserveAsset — 使用 BNB 购入所有者已允许的 bStock，受单笔交易限额与滚动累计窗口双重约束，因此即便私钥被攻破，也无法像仅有单笔限额时那样通过反复调用抽干资金。当该资产存在 Chainlink 美元价格源时，合约会自行计算价格下限，并在其与 keeper 报价之间取更严格者。默认情况下，已允许但缺少价格源的资产会导致调用直接拒绝，而不会悄悄信任未经验证的价格。",
        "depositReserveAsset — 将转换合约持有的已允许 bStock 转入金库。这是价值从此处进入金库的唯一途径。",
      ]),
      p(
        "买入环节刻意与交易场所解耦：它将不透明的 calldata 转发至所有者已允许的目标合约，并仅依据观测到的余额变化以及上述独立预言机下限来判定结果。将资金库合约绑定到单一市场结构必然导致日后重新发现问题 —— 本项目已经为此付出过一次代价。"
      ),
      p("该合约中不存在任何提现、救援或清扫函数，无论是所有者还是任何其他人皆无法使用。即便 keeper 私钥被攻破，也只能触发受限、经价格校验、预先白名单化的兑换操作转入金库 —— 无法向任何方向提取价值。"),
    ],
  },
  {
    id: "vault",
    title: "金库与赎回",
    blocks: [
      p("金库以普通 BEP-20 余额形式持有资金库已收购的每一支 bStock — 任何人均可随时在 BscScan 上逐块核实。"),
      p(
        "赎回只需一次调用：销毁 RSVD（通过 burnFrom，因此需先向金库授权），即可按销毁前的总供应量比例，获得金库当前持有的每一项储备资产份额 — 这样同一区块内的两次赎回都能获得公平份额，而不会让后一位赎回者因前一位的销毁而占到便宜。"
      ),
      p(
        "若在赎回过程中某一储备资产的转账失败（回滚、将金库拉黑、被暂停或其他异常），该资产会被跳过，而不会导致整个赎回失败。单个问题代币不会锁死其他所有人的退出通道；代价是赎回者对该特定问题资产的份额不会保留以供后续重试。"
      ),
    ],
  },
  {
    id: "keeper",
    title: "Keeper 机器人",
    blocks: [
      p(
        "一个链下服务会定期调用资金库转换合约自身的受限函数 — 它除了 TreasuryConverter.keeper 已授予的权限外没有任何特权，无论机器人自身如何决策，其可执行的一切操作均在链上受到限额与价格校验约束。"
      ),
      ul([
        "在 RSVD 的 TWAP 检查点窗口到期后卖出累积的 RSVD。",
        "在每支已允许 bStock 自身的 TWAP + Chainlink 价格下限就绪后买入，且会先模拟交易，使链上流动性不足时快速失败，而非让真实交易被回滚。",
        "将购入的资产存入金库。",
        "当链上流动性过薄、无法干净成交时，会转向通过币安 API 购买并提现的备用路径 — 该备用路径已接入机器人的控制流程，但尚未针对真实币安账户实现和验证，且如实标注这一状态，而非悄悄伪造。",
      ]),
    ],
  },
  {
    id: "governance",
    title: "治理：为下一支 bStock 投票",
    blocks: [
      p(
        "任何持有至少 100,000 RSVD 的钱包都可以为币安尚未发行 bStock 的蓝筹股投出非约束性的链上投票，表达储备下一步应优先收购哪一支。投票资格根据投票时的持仓判定，代币无需质押或锁定 — 您始终完全掌控和拥有自己的代币。"
      ),
      p("这只是一种信号，而非约束性指令：治理合约无法访问 RSVD、金库或资金库转换合约，也无法促成任何实际购买。它仅读取 RSVD 余额以判断谁具备投票资格。"),
    ],
  },
  {
    id: "security",
    title: "安全性",
    blocks: [
      p("以下是经过刻意加固、并由覆盖全部合约的自动化测试套件验证过的部分："),
      ul([
        "不存在资金抽离后门：金库或资金库资产不存在任何仅所有者可用的提现/救援函数。",
        "无增发、无黑名单、无暂停、无 owner — 合约除 ERC20 与销毁之外不暴露任何函数，因此没有任何特权调用可供扫描器标记或被任何人使用。",
        "全部采用 Ownable2Step，而非普通 Ownable。",
        "存在紧急暂停功能，但在结构上无法阻止退出：销毁操作不受代币暂停影响，金库的 redeem() 函数也完全不带暂停修饰符。",
        "所有权已为时间锁做好准备：合约可移交给 TimelockController，使管理变更需经过“先排期、后执行”的延迟，而非即时生效。",
      ]),
      p("尚未完成的事项：专业安全审计与证券合规法律审查。在任何涉及真实资金的公开/主网上线之前，这两项都不是可选项 — 请将以上内容理解为“经过精心构建与测试”，而非“已通过审计”。"),
    ],
  },
  {
    id: "risks",
    title: "风险与免责声明",
    blocks: [
      ul([
        "上一层的托管信任：bStocks 最终由币安 / BTech Holdings 位于阿布扎比的 SPV 托管支撑，并通过币安的储备证明进行追踪 — 这是“可验证”，而非“无需信任”。",
        "个别 bStock 交易对在 PancakeSwap 上的流动性可能较薄，尤其是新发行的品种 — 无论上述链上保护机制如何，大额交易仍可能造成实际的价格冲击。",
        "除上述非约束性投票外，并未实现社区治理 — 实际购买决策仍由 keeper 决定。",
        "RSVD 代表对一篮子代币化股票敞口储备的权益凭证。本页面仅供参考，不构成财务或法律建议，页面中的任何内容均不构成证券要约。",
      ]),
    ],
  },
];

export const docsContent: Record<Locale, DocsSection[]> = { en, zh };
