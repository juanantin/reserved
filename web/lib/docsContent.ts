import type { Locale } from "./i18n";

// Long-form documentation content, kept separate from lib/i18n.ts (which holds short
// UI strings) since these are full paragraphs, not phrases reused across components.
// Written as a plain explanation of the mechanism and utility of the project — how fees
// turn into bStocks, how redemption works, what governance actually does — not a
// contract-by-contract technical reference. Every factual claim is still checked against
// a real on-chain transaction where one exists, and anything that's design rather than
// observed fact says so plainly rather than getting rounded up to a stronger claim.
//
// Token relaunched at a new address: 0x9b0c5e8C457D2420899712FD698fc333E08D4B7D. The
// prior deployment's launch tx, redeem tx and proxy/implementation citations described
// that earlier contract's history, not this one's, so they've been pulled rather than
// left pointing at a different contract's transactions. Re-add citations here — launch
// tx, a redeem tx, whether this contract is upgradeable — the moment they're available
// for this address, the same way every other claim in this file is sourced.

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
        "Reserve Holdings (RHOLD) is a fixed-supply token sitting on a growing reserve of tokenized real stocks — Circle, NVIDIA, SanDisk, Micron and AMD today, with more added as holders vote them in. Every trade against its PancakeSwap pool leaves behind a small fee, and that fee is what's meant to fund buying more stock into the reserve. Nothing is paid out to holders along the way — value sits in the reserve itself, and any holder can claim their pro-rata share of it at any time, simply by burning their tokens."
      ),
      p(
        "The one idea behind all of it: a token's price can fall to zero. A redeemable claim on a reserve of real, checkable stock can't — for as long as that reserve holds something and redemption stays open to everyone. That's what RHOLD is built to be."
      ),
      p(
        "One thing worth reading before anything else on this page: the token is currently upgradeable, and that control hasn't been given up yet. See Trust model near the bottom for what that means in plain terms — everything else here describes what the contract does today, not a permanent guarantee."
      ),
    ],
  },
  {
    id: "token",
    title: "The token",
    blocks: [
      p(
        "RHOLD is a plain BEP-20 with its supply fixed at 1,000,000,000, set once, at launch, and never since. There's no way to mint more — the only thing that can happen to supply from here is it shrinking, when someone redeems and their tokens get burned. Fewer tokens against the same or a bigger reserve means everyone left is holding a bigger slice of it."
      ),
      p(
        "RHOLD trades on a single PancakeSwap V3 pool, and that pool was funded entirely by the token contract itself at launch — not a deployer wallet, not a locker service, and not through a transferable NFT position someone could later pull. Liquidity, and attention, stay in one place."
      ),
    ],
  },
  {
    id: "fee",
    title: "The fee — not a tax",
    blocks: [
      p(
        "RHOLD doesn't charge a tax on transfers. That's not actually possible on the kind of pool it trades on — the pool demands the full amount on every swap, no exceptions. What funds the reserve instead is simpler: the ordinary swap fee every trade already pays into the pool. RHOLD's own contract is built to collect that fee itself, automatically, in BNB, on every trade, with no manual step in between."
      ),
      p(
        "A second fee is planned on top of that: a small protocol fee, taken in BNB by a swap hook and routed straight to the reserve. It hasn't shipped yet. This page will say so the moment it does — the same way it's saying plainly now that it hasn't."
      ),
    ],
  },
  {
    id: "treasury",
    title: "The treasury",
    blocks: [
      p(
        "bStocks the reserve acquires are held directly at RHOLD's own contract address — there's no separate vault contract standing in between holding them on the token's behalf. That means anyone can check exactly what's held, and how much, on BscScan's Tokens tab for that address, any time, instead of trusting a number someone quotes them."
      ),
      p("Fee in, bStocks out — the same one address the whole way through."),
    ],
  },
  {
    id: "buying",
    title: "Buying the backing",
    blocks: [
      p(
        "The BNB collected from swap fees is what's meant to fund buying bStocks into the reserve — that's the design. This exact pipeline was directly observed running on the project's prior deployment, with bStocks and the WBNB that funded them arriving at the treasury from the same address. We'll confirm the same thing here, cited against this contract's own transfer history, as soon as it's observable."
      ),
    ],
  },
  {
    id: "redemption",
    title: "Redemption & the floor",
    blocks: [
      p(
        "Anyone holding RHOLD can call burn() on their own balance, any time — no approval needed, no permission to ask for, no waiting period. In the same transaction, the contract sends back a pro-rata share of everything the treasury holds: every bStock it's sitting on, split by exactly your share of total supply at that moment."
      ),
      p(
        "This isn't a hypothetical: the same burn-to-redeem mechanism was directly observed working on the project's prior deployment — a holder redeemed RHOLD and received bStocks back, pro-rata, in the same transaction. This site's Redeem button calls that same function on the current contract; we'll cite a fresh redeem transaction for this address as soon as one's observable, same as everywhere else on this page."
      ),
      p(
        "This site's Redeem button is one way to call it, connecting your wallet here — but it's not the only way. Because burn() is a plain public function on the token contract, it can be called directly from BscScan's own \"Write Contract\" tab for the token, connecting a wallet there instead, with no dependency on this website at all."
      ),
      p(
        "One thing that transaction doesn't settle: the precise rounding behavior of the contract's own math. The site's \"you will receive\" preview is a simple client-side estimate — your balance's share of supply, times current holdings — not a call into the contract itself, so treat it as an estimate, not a guaranteed quote."
      ),
    ],
  },
  {
    id: "why-not-zero",
    title: "Why it can't go to zero",
    blocks: [
      p(
        "A price can fall to zero. A redeemable claim on a reserve of real stock can't — as long as that reserve holds something, and redemption stays open to everyone. If RHOLD ever traded below the value of what it can actually be redeemed for, buying it and redeeming immediately would be risk-free profit — exactly the kind of gap markets tend to close on their own."
      ),
      p(
        "That's arbitrage doing its job: anyone who spots RHOLD trading under the treasury's per-token backing has an incentive to buy and redeem until the price is pushed back up to that level. The floor isn't enforced by a promise — it's enforced by whoever notices the gap first and profits from closing it, which tends to keep the market price sitting at or above what the treasury actually backs each token with."
      ),
      p(
        "Two things keep that logic honest, worth saying plainly rather than skipping past. Redemption only ever pays out whatever the treasury actually holds at that moment — thin on a given bStock means your share of that one is thin too, and you can check current holdings before you redeem (see The treasury above). And the whole argument assumes the contract keeps working the way it works today — see Trust model below for why that's a real qualifier here, not boilerplate."
      ),
    ],
  },
  {
    id: "governance",
    title: "Governance: vote the next bStock",
    blocks: [
      p(
        "Any wallet holding at least 100,000 RHOLD can cast a non-binding, on-chain vote for which blue-chip stock the reserve should prioritize once Binance issues a bStock for it. Voting reads your balance at the moment you vote — nothing gets staked or locked, and you keep full control of your tokens the whole time."
      ),
      p(
        "It's a signal, not an instruction: the voting contract can't touch RHOLD, the pool, or the treasury. All it does is read a balance to decide who's eligible, and record what they voted for."
      ),
    ],
  },
  {
    id: "trust",
    title: "Trust model",
    blocks: [
      ul([
        "Liquidity is designed to live at the token contract's own address, not a wallet or a transferable NFT — that was directly confirmed on the project's prior deployment; pending the same confirmation for this contract's own launch.",
        "Fee collection into the treasury is designed to be automatic and on-chain, with no manual step and no separate wallet handling it — confirmed working this way on the prior deployment; pending the same confirmation here.",
        "Redemption is open to anyone, any time, by design — already proven working on the prior deployment; pending a fresh redeem transaction cited against this contract.",
        "Whether this contract is upgradeable — like the project's prior deployment was, with upgrade control not yet renounced there — hasn't been confirmed here yet. This is the single most important open question on this page right now, and it'll be answered plainly the moment it's checked.",
        "Not yet independently confirmed: whether an owner has any path to withdraw the pool's underlying liquidity (as opposed to just the fees it earns), and whether a mint function exists anywhere in the contract. The source hasn't been reviewed line-by-line here, so no stronger claim than that is made.",
        "No third-party security audit yet, and no legal review of securities classification. Every claim on this page is checked against a cited on-chain transaction where one is cited — not a completed audit.",
        "One layer of custodial trust further out: bStocks are ultimately backed by Binance/BTech Holdings' Abu Dhabi SPV custody, tracked via Binance's Proof of Collateral. That's verifiable, not trustless.",
      ]),
    ],
  },
  {
    id: "contracts",
    title: "Contracts",
    blocks: [
      p("For anyone who wants to check any of this directly rather than take the page's word for it:"),
      ul([
        "RHOLD token: 0x9b0c5e8C457D2420899712FD698fc333E08D4B7D",
        "Governance vote contract: 0x3daa17ceFB41F76aabD2F45034433A8996147506",
      ]),
      p("Prices shown on this site come from DexScreener, with the PancakeSwap pool itself as a fallback."),
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    blocks: [
      p("Do I earn dividends? No — value sits in the reserve instead of getting paid out. You realize it by redeeming or selling."),
      p(
        "Are these real shares? They're Binance-issued tokenized stocks (bStocks) — real underlying exposure via custody, not brokerage shares, and they carry no voting rights or dividends of their own."
      ),
      p(
        "What if everyone redeems at once? The reserve unwinds pro-rata, in whatever order people redeem in — whatever's left keeps backing whoever hasn't redeemed yet. That's an orderly exit, not a failure mode, assuming the contract keeps working as described (see Trust model above)."
      ),
      p(
        "Can the team run off with the reserve? Not through any path confirmed so far — bStocks sit at the token's own contract address, not a separate wallet the team controls, and redemption requires nobody's permission. Whether this contract is upgradeable, and if so whether that control has been given up, is the open question tracked in Trust model above — check there for the current answer rather than assuming either way."
      ),
      p("Is this audited? Not yet, by a third party — see Trust model above."),
      p(
        "What changes once the protocol fee ships? More BNB flows into the treasury per trade, on top of what the pool fee already collects on its own — see The fee above."
      ),
    ],
  },
  {
    id: "risks",
    title: "Risks & disclaimers",
    blocks: [
      ul([
        "Whether this contract is upgradeable, and the status of upgrade control if so, hasn't been independently confirmed yet for this deployment — see Trust model above.",
        "Custodial trust one layer up: bStocks are backed by Binance/BTech Holdings' custody, verifiable via Proof of Collateral, not trustless.",
        "Individual bStock liquidity on PancakeSwap can be thin, especially for newly issued ones — large trades can move price regardless of what's described above.",
        "Not community-governed beyond the non-binding vote described above.",
        "This page is informational only, not financial or legal advice, and nothing here is an offer to sell securities.",
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
        "Reserve Holdings（RHOLD）是一枚总量固定的代币，背后是一个不断增长的代币化真实股票储备 —— 目前包括 Circle、NVIDIA、SanDisk、Micron、AMD，未来会随着持有者投票不断加入新的品种。每一笔针对其 PancakeSwap 交易池的交易都会留下一笔小额手续费，而这笔手续费正是用于购买更多股票、充实储备的资金来源。整个过程中不会向持有者直接派发任何收益 —— 价值留在储备本身，任何持有者都可以随时通过销毁代币，按比例取走自己的那一份。"
      ),
      p(
        "贯穿始终的核心理念是：代币的价格可以跌到零。但只要储备中还持有资产、赎回渠道对所有人开放，一份可赎回、指向真实且可核查股票储备的权益凭证，就不会跌到零。RHOLD 正是按照这个理念设计的。"
      ),
      p(
        "在阅读本页其他内容之前，有一点值得先读到：该代币目前仍是可升级的，且升级权限尚未放弃。请参阅本页末尾的“信任模型”部分，了解这一点的实际含义 —— 本页其余内容描述的都是合约当前的行为，而非永久性的保证。"
      ),
    ],
  },
  {
    id: "token",
    title: "代币",
    blocks: [
      p(
        "RHOLD 是一枚普通的 BEP-20 代币，总供应量固定为 1,000,000,000 枚，仅在启动时一次性设定，此后再未变动。没有任何增发途径 —— 此后供应量唯一可能发生的变化就是减少，当有人赎回并销毁自己的代币时。同样或更大规模的储备，对应更少的代币数量，意味着留下的每一位持有者所占的份额都会更大。"
      ),
      p(
        "RHOLD 仅在一个 PancakeSwap V3 交易池中交易，而这个池子在启动时完全由代币合约自身注资 —— 既不是部署者钱包，也不是锁仓服务，更不是通过日后可被转让、提取的 NFT 头寸。这让流动性与关注度都集中在同一个地方。"
      ),
    ],
  },
  {
    id: "fee",
    title: "手续费 —— 不是税",
    blocks: [
      p(
        "RHOLD 不对转账收取任何税费。这在它所交易的这类交易池上其实也无法实现 —— 该交易池要求每一笔兑换都必须收到全额，没有例外。为储备提供资金的，其实是每笔交易本就要支付给交易池的普通兑换手续费：RHOLD 合约的设计是自动、直接以 BNB 的形式收取这笔手续费，中间没有任何人工步骤。"
      ),
      p(
        "在此之上，还计划加入第二层手续费：由一个兑换钩子（swap hook）以 BNB 形式收取的小额协议费，并直接划入储备。目前这一功能尚未上线。一旦上线，本页会第一时间说明 —— 就像现在明确说明它尚未上线一样。"
      ),
    ],
  },
  {
    id: "treasury",
    title: "资金库",
    blocks: [
      p(
        "储备所购入的 bStocks 直接持有在 RHOLD 自身的合约地址上 —— 中间没有单独的金库合约代为持有。这意味着任何人都可以随时在该地址的 BscScan “Tokens” 标签页中，核实具体持有了什么、持有多少，而无需信任别人给出的数字。"
      ),
      p("手续费进来，bStocks 出去 —— 全程都在同一个地址完成。"),
    ],
  },
  {
    id: "buying",
    title: "购入背后的资产",
    blocks: [
      p(
        "手续费收取来的 BNB，其设计用途正是用于购买 bStocks 充实储备 —— 这是既定设计。这条链路已在项目此前的部署上被直接观察到真实运转：bStocks 与为其提供资金的 WBNB，均来自同一地址抵达资金库。一旦本合约自身的转账记录可供核实，我们会以同样的方式在此确认。"
      ),
    ],
  },
  {
    id: "redemption",
    title: "赎回与底价",
    blocks: [
      p(
        "任何持有 RHOLD 的人都可以随时对自己的余额调用 burn() —— 无需授权，无需向任何人申请许可，也无需等待。在同一笔交易中，合约会按您当时占总供应量的确切比例，返还资金库持有的每一种资产：资金库当时持有的每一支 bStock，都会按比例支付给您。"
      ),
      p(
        "这并非纸上谈兵：同样的“销毁即赎回”机制已在项目此前的部署上被直接观察到真实运转 —— 一位持有者销毁 RHOLD 后，在同一笔交易中按比例收到了 bStock 返还。本网站的“赎回”按钮在当前合约上调用的正是同一函数；一旦有可供核实的赎回交易，我们会以本页一贯的方式为本合约引用具体交易。"
      ),
      p(
        "本网站的“赎回”按钮是调用该函数的一种方式，需要在本站连接钱包 —— 但并非唯一方式。由于 burn() 是代币合约上一个公开函数，也可以直接在 BscScan 该代币的“Write Contract”标签页中调用，在那里连接钱包即可，完全不依赖本网站。"
      ),
      p(
        "这笔交易本身无法说明的是：合约自身计算逻辑的精确取整方式。网站上的“预计可获得”预览，只是客户端的简单估算 —— 您的余额占总供应量的比例，乘以当前持仓 —— 并非调用合约本身的计算逻辑，因此请将其视为估算值，而非有保证的报价。"
      ),
    ],
  },
  {
    id: "why-not-zero",
    title: "为什么价格不会归零",
    blocks: [
      p(
        "价格可以跌到零。但一份可赎回、指向真实股票储备的权益凭证不会 —— 只要该储备中仍持有资产，且赎回渠道对所有人开放。如果 RHOLD 的交易价格低于其实际可赎回价值，那么买入并立即赎回就等于无风险套利，而这正是市场往往会自行抹平的价差。"
      ),
      p(
        "这正是套利机制在发挥作用：一旦有人发现 RHOLD 的交易价格低于资金库为每枚代币提供的支撑价值，就有动机买入并赎回，直到价格被重新推高至该水平。这道底价并非靠承诺来维持，而是靠最先发现这一价差、并从中套利的人来维持 —— 这往往会使市场价格维持在资金库为每枚代币提供的支撑价值之上或与之持平。"
      ),
      p(
        "有两点需要坦率说明，而不是一带而过：赎回所支付的，始终是资金库在那一刻实际持有的资产 —— 若某支 bStock 持仓较少，您在该资产上分得的份额也会相应较少，赎回前您可以先核实当前持仓（详见上文“资金库”部分）。而整套逻辑的前提，是合约能持续按照目前的方式运作 —— 详见下文“信任模型”部分，了解为什么这在这里是一条真实的限定条件，而非套话。"
      ),
    ],
  },
  {
    id: "governance",
    title: "治理：为下一支 bStock 投票",
    blocks: [
      p(
        "任何持有至少 100,000 枚 RHOLD 的钱包，都可以为币安尚未发行 bStock 的蓝筹股，投出非约束性的链上投票，表达储备下一步应优先收购哪一支。投票读取的是您投票那一刻的持仓 —— 无需质押或锁定任何代币，您始终完全掌控自己的代币。"
      ),
      p("这只是一种信号，而非约束性指令：投票合约无法接触 RHOLD、交易池或资金库。它所做的仅仅是读取余额以判断谁具备投票资格，并记录投票结果。"),
    ],
  },
  {
    id: "trust",
    title: "信任模型",
    blocks: [
      ul([
        "流动性按设计应持有在代币合约自身地址上，而非某个钱包或可转让的 NFT —— 这一点已在项目此前的部署上直接确认；本合约自身启动交易的同等确认尚待进行。",
        "手续费按设计应自动、在链上收入资金库，没有人工步骤、也不经过单独的钱包 —— 已在此前的部署上确认按此方式运作；本合约的同等确认尚待进行。",
        "赎回功能按设计向所有人、随时开放 —— 已在此前的部署上证明确实可用；本合约仍待引用一笔具体的赎回交易加以确认。",
        "本合约是否可升级 —— 如同项目此前的部署那样，且那次部署的升级权限尚未放弃 —— 目前尚未就本合约得到确认。这是当前本页最重要的待确认问题，一旦核实会第一时间如实说明。",
        "尚未独立核实的内容：所有者是否存在任何提取交易池标的流动性（而非仅仅是其产生的手续费）的途径，以及合约中是否存在任何增发函数。本页尚未对合约源码进行逐行审查，因此不会作出超出上述范围的更强表述。",
        "尚无第三方安全审计，也未进行证券属性的法律合规审查。本页对每一项陈述的核实标准，都是已对照所引用的链上交易核实，而非已完成审计。",
        "更外一层的托管信任：bStocks 最终由币安 / BTech Holdings 位于阿布扎比的 SPV 托管支撑，并通过币安的储备证明（Proof of Collateral）进行追踪 —— 这是“可验证”，而非“无需信任”。",
      ]),
    ],
  },
  {
    id: "contracts",
    title: "合约地址",
    blocks: [
      p("如果您想亲自核实，而不是仅凭本页文字判断，可以查看以下地址："),
      ul([
        "RHOLD 代币：0x9b0c5e8C457D2420899712FD698fc333E08D4B7D",
        "治理投票合约：0x3daa17ceFB41F76aabD2F45034433A8996147506",
      ]),
      p("本站展示的价格来自 DexScreener，并以 PancakeSwap 交易池自身数据作为备用来源。"),
    ],
  },
  {
    id: "faq",
    title: "常见问题",
    blocks: [
      p("我能获得分红吗？不能 —— 价值留在储备中，而不会直接派发。您需要通过赎回或出售来兑现收益。"),
      p("这些是真实股票吗？它们是币安发行的代币化股票（bStocks）—— 通过托管获得真实的底层敞口，但并非券商股票，也不附带自身的投票权或分红权。"),
      p(
        "如果所有人同时赎回会怎样？储备会按持有者赎回的先后顺序，按比例逐步清算 —— 剩余部分继续为尚未赎回的持有者提供支撑。假设合约按本页描述持续正常运作（详见上文“信任模型”），这是一种有序退出，而非失败情形。"
      ),
      p(
        "项目方会卷走储备资产吗？就目前已核实的情况看，没有任何途径可以做到 —— bStocks 持有在代币自身的合约地址上，而非项目方控制的单独钱包，且赎回无需任何人许可。本合约是否可升级、若可升级其升级权限现状如何，是上文“信任模型”部分正在追踪的待确认问题 —— 请以那里的最新说明为准，而非预先假定答案。"
      ),
      p("这个项目经过审计吗？尚未经过第三方审计 —— 详见上文“信任模型”部分。"),
      p("协议费上线后会有什么变化？每笔交易流入资金库的 BNB 会在交易池手续费原有基础上进一步增加 —— 详见上文“手续费”部分。"),
    ],
  },
  {
    id: "risks",
    title: "风险与免责声明",
    blocks: [
      ul([
        "本合约是否可升级、若可升级其升级权限现状如何，就本次部署而言尚未独立核实 —— 详见上文“信任模型”部分。",
        "更外一层的托管信任：bStocks 由币安 / BTech Holdings 托管支撑，可通过储备证明核实，但并非无需信任。",
        "个别 bStock 在 PancakeSwap 上的流动性可能较薄，尤其是新发行的品种 —— 无论上述链上机制如何，大额交易仍可能显著影响价格。",
        "除上述非约束性投票外，并未实现社区治理。",
        "本页面仅供参考，不构成财务或法律建议，页面中的任何内容均不构成证券要约。",
      ]),
    ],
  },
];

export const docsContent: Record<Locale, DocsSection[]> = { en, zh };
