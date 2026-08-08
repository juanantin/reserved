// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockSupplyInitializer
/// @notice Test-only initializer, delegatecalled through ReservedToken.postDeploy.
///
/// Since the constructor no longer mints, fixtures need something to create the fixed
/// supply before the rest of the suite can exercise transfers, tax, burns and the vault.
/// This does the minimum: mint the whole supply to one address, exactly as the old
/// constructor did, so every existing assertion keeps its original meaning.
///
/// The storage declarations below MUST mirror ReservedToken's layout slot for slot —
/// this contract's code runs against the token's storage. `test/StorageLayout.test.js`
/// asserts that alignment mechanically; do not edit either side without running it.
contract MockSupplyInitializer {
    mapping(address account => uint256) private _balances;
    mapping(address account => mapping(address spender => uint256)) private _allowances;
    uint256 private _totalSupply;
    string private _name;
    string private _symbol;
    address private _owner;
    address private _pendingOwner;
    bool private _paused;
    uint256 public taxBps;
    address public treasury;
    mapping(address => bool) public isAmmPair;
    mapping(address => bool) public isTaxExempt;

    event Transfer(address indexed from, address indexed to, uint256 value);

    error AlreadyInitialized();

    /// @notice Mint `amount` to `to`, mirroring the old `_mint(initialOwner_, fixedSupply_)`.
    function mintTo(address to, uint256 amount) external {
        if (_totalSupply != 0) revert AlreadyInitialized();
        _totalSupply = amount;
        _balances[to] = amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Writes nothing. Used to prove postDeploy stays open when a payload leaves
    /// totalSupply at zero, i.e. that the guard is not a one-shot latch.
    function noop() external {}

    /// @notice Always reverts, to check postDeploy bubbles the inner revert reason up.
    function boom() external pure {
        revert("initializer exploded");
    }

    /// @notice Writes taxBps directly, ignoring MAX_TAX_BPS. Exists to pin down that the
    /// cap in setTaxBps is not enforceable while postDeploy is reachable.
    function setTaxBpsRaw(uint256 newTaxBps) external {
        taxBps = newTaxBps;
    }

    /// @notice Writes _owner directly, bypassing Ownable2Step's accept step. Same purpose.
    function setOwnerRaw(address newOwner) external {
        _owner = newOwner;
    }
}
