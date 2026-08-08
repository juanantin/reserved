// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title RfqProbe
/// @notice Disposable, single-purpose diagnostic for one question: **will the bStocks RFQ
/// venue fill an order placed by a contract, or only by an EOA?**
///
/// Those tokens are compliance-gated ("custodial model", BEP-8056) and settle through
/// signed off-chain quotes against the issuer's own vault rather than a public AMM pool.
/// It is entirely plausible the venue refuses contract takers, or binds each quote to the
/// address that requested it. If either holds, TreasuryConverterV2's generic executor can
/// never buy these assets no matter how well it is built — so this is worth answering for
/// ~$10 before any more effort goes into the keeper bot or the RFQ integration.
///
/// @dev THROWAWAY. Deploy it, learn the answer, withdraw the funds, forget it exists.
/// Deliberately unlike the production contracts in two ways, both correct *here* and
/// wrong there:
///  - It HAS withdraw functions. It holds your test money and you need it back. The
///    production converter's whole point is that no such function exists.
///  - probe() does NOT revert when the swap fails. A revert would throw away the one thing
///    this contract exists to capture: the venue's own failure reason. Instead the result
///    (including raw return data) is emitted as an event, so a rejection is recorded
///    on-chain and readable rather than lost.
///
/// Interpreting a failure needs care. RFQ quotes are typically signed over specific
/// parameters, often including the taker address — so a replayed quote can fail because it
/// was bound to your wallet, NOT because contracts are refused. Those two look identical
/// from a plain revert. Run both a freshly-requested quote and a replayed one and compare
/// the reasons before concluding anything.
contract RfqProbe {
    address public immutable owner;

    /// @param success Whether the forwarded call itself succeeded.
    /// @param received Balance delta of tokenOut on this contract (0 on failure).
    /// @param returnData Raw return/revert payload from the venue — the actual diagnostic.
    event ProbeResult(bool success, uint256 received, bytes returnData);

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Forward `data` to `target` with `msg.value` attached, then report how much
    /// `tokenOut` arrived. Never reverts on venue failure — see the contract note.
    /// @dev If the forwarded call reverts, its state changes (including the value transfer)
    /// revert with it, so the BNB stays in this contract and is recoverable via withdraw.
    function probe(
        address target,
        bytes calldata data,
        address tokenOut
    ) external payable onlyOwner returns (bool success, uint256 received) {
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        bytes memory returnData;
        (success, returnData) = target.call{value: msg.value}(data);

        received = success ? IERC20(tokenOut).balanceOf(address(this)) - balanceBefore : 0;
        emit ProbeResult(success, received, returnData);
    }

    /// @notice Same, but paying with an ERC20 instead of native BNB. Approves `target` for
    /// exactly `amountIn`, then revokes — so a failed probe leaves no standing allowance.
    function probeWithToken(
        address target,
        bytes calldata data,
        address tokenIn,
        uint256 amountIn,
        address tokenOut
    ) external onlyOwner returns (bool success, uint256 received) {
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).approve(target, amountIn);

        bytes memory returnData;
        (success, returnData) = target.call(data);

        IERC20(tokenIn).approve(target, 0);
        received = success ? IERC20(tokenOut).balanceOf(address(this)) - balanceBefore : 0;
        emit ProbeResult(success, received, returnData);
    }

    function withdrawToken(address token) external onlyOwner {
        IERC20(token).transfer(owner, IERC20(token).balanceOf(address(this)));
    }

    function withdrawNative() external onlyOwner {
        (bool ok, ) = payable(owner).call{value: address(this).balance}("");
        require(ok, "RfqProbe: native withdraw failed");
    }

    receive() external payable {}
}
