// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal WBNB: native in via receive(), ERC20 out.
contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}

    receive() external payable {
        _mint(msg.sender, msg.value);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /// TreasuryConverterV3.sellRsvd unwraps its WBNB proceeds so the buy leg keeps
    /// spending native BNB.
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "WBNB: withdraw failed");
    }
}

/// @notice A V3 pool with the Uniswap slot0 shape — `uint8 feeProtocol`, which is what
/// UniswapV3TokenInitializer's interface declares.
contract MockUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public tickSpacing;

    uint160 public sqrtPriceX96;
    int24 public currentTick;

    constructor(address token0_, address token1_, uint24 fee_, int24 tickSpacing_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    function initialize(uint160 sqrtPriceX96_, int24 tick_) external {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = tick_;
    }

    function setTick(int24 tick_) external {
        currentTick = tick_;
    }

    // --- observation ring, as TreasuryConverterV3's TWAP reads it ---
    int24 public twapTickValue;
    bool public observeReverts;
    uint16 public observationCardinalityNext = 1;

    function setTwapTick(int24 t) external {
        twapTickValue = t;
    }

    /// A fresh V3 pool holds one observation, so observe() over a real window reverts
    /// with "OLD" until the ring has grown. This models that state.
    function setObserveReverts(bool v) external {
        observeReverts = v;
    }

    function increaseObservationCardinalityNext(uint16 n) external {
        observationCardinalityNext = n;
    }

    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) {
        require(!observeReverts, "OLD");
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        // The consumer computes (c[1] - c[0]) / window, so seed a cumulative whose delta
        // over the requested window averages exactly twapTickValue.
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(twapTickValue) * int56(uint56(secondsAgos[0]));
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, currentTick, 0, 0, 0, 0, true);
    }

    /// @dev Lets MockSwapRouter deliver the output leg out of the pool's inventory.
    function payOut(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
}

/// @notice Same pool, but with PancakeSwap V3's slot0 shape: `uint32 feeProtocol`,
/// which packs two uint16 fees. Used to show what happens when the initializer's
/// `uint8` declaration meets a pool whose protocol fee does not fit in a byte.
contract MockPancakeV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public tickSpacing;

    uint160 public sqrtPriceX96;
    int24 public currentTick;
    uint32 public feeProtocol;

    constructor(address token0_, address token1_, uint24 fee_, int24 tickSpacing_, uint32 feeProtocol_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
        feeProtocol = feeProtocol_;
    }

    function initialize(uint160 sqrtPriceX96_, int24 tick_) external {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = tick_;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint32, bool)
    {
        return (sqrtPriceX96, currentTick, 0, 0, 0, feeProtocol, true);
    }

    function payOut(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
}

contract MockUniswapV3Factory {
    mapping(bytes32 => address) private _pools;

    function _key(address a, address b, uint24 fee) private pure returns (bytes32) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(t0, t1, fee));
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return _pools[_key(a, b, fee)];
    }

    function setPool(address a, address b, uint24 fee, address pool) external {
        _pools[_key(a, b, fee)] = pool;
    }
}

contract MockNonfungiblePositionManager {
    address public immutable WETH9;
    address public immutable factory;

    /// Tick handed to pools created from here. Real V3 derives it from sqrtPriceX96;
    /// tests set it explicitly when they care about the resulting tick range.
    int24 public nextPoolTick;
    int24 public nextPoolTickSpacing = 50;

    /// Real V3 derives liquidity from the desired amounts by rounding down, then
    /// recomputes what that liquidity consumes, so the deposit lands a few wei short.
    /// Modelling that is what makes an `amountMin == amountDesired` bound fail here the
    /// way it fails on-chain.
    uint256 public mintShortfallWei = 3;
    /// 10000 = the range takes the full desired amount. Lower it to simulate a range
    /// straddling the current tick, where the funded leg is only partly consumed.
    uint256 public mintFillBps = 10_000;

    // Recorded for assertions.
    uint160 public lastSqrtPriceX96;
    address public lastPool;
    address public lastRecipient;
    int24 public lastTickLower;
    int24 public lastTickUpper;
    uint256 public lastAmount0Desired;
    uint256 public lastAmount1Desired;
    uint256 public mintCallCount;

    constructor(address weth9_, address factory_) {
        WETH9 = weth9_;
        factory = factory_;
    }

    function setNextPoolTick(int24 tick_) external {
        nextPoolTick = tick_;
    }

    function setNextPoolTickSpacing(int24 spacing_) external {
        nextPoolTickSpacing = spacing_;
    }

    function setMintShortfallWei(uint256 wei_) external {
        mintShortfallWei = wei_;
    }

    function setMintFillBps(uint256 bps_) external {
        mintFillBps = bps_;
    }

    function _consumed(uint256 desired) private view returns (uint256) {
        if (desired == 0) return 0;
        uint256 filled = (desired * mintFillBps) / 10_000;
        return filled > mintShortfallWei ? filled - mintShortfallWei : 0;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool) {
        lastSqrtPriceX96 = sqrtPriceX96;
        pool = MockUniswapV3Factory(factory).getPool(token0, token1, fee);
        if (pool == address(0)) {
            pool = address(new MockUniswapV3Pool(token0, token1, fee, nextPoolTickSpacing));
            MockUniswapV3Factory(factory).setPool(token0, token1, fee, pool);
            MockUniswapV3Pool(pool).initialize(sqrtPriceX96, nextPoolTick);
        }
        lastPool = pool;
    }

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(params.deadline >= block.timestamp, "deadline");
        mintCallCount++;
        lastRecipient = params.recipient;
        lastTickLower = params.tickLower;
        lastTickUpper = params.tickUpper;
        lastAmount0Desired = params.amount0Desired;
        lastAmount1Desired = params.amount1Desired;

        address pool = MockUniswapV3Factory(factory).getPool(params.token0, params.token1, params.fee);
        require(pool != address(0), "no pool");

        amount0 = _consumed(params.amount0Desired);
        amount1 = _consumed(params.amount1Desired);
        // Same bound, same message as the real position manager.
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage check");

        // Pull the funded leg through the allowance the initializer set, so the test
        // exercises the approval path and the token's own transfer hook.
        if (amount0 > 0) {
            IERC20(params.token0).transferFrom(msg.sender, pool, amount0);
        }
        if (amount1 > 0) {
            IERC20(params.token1).transferFrom(msg.sender, pool, amount1);
        }

        return (1, 1, amount0, amount1);
    }
}

contract MockSwapRouter {
    address public immutable factory;

    /// Output per unit of input, scaled 1e18. Set by the test.
    uint256 public rate = 1e18;

    address public WETH9;
    int24 public tickAfterSwap;
    bool public movesTick;

    function setWETH9(address w) external {
        WETH9 = w;
    }

    /// Where the pool's tick ends up once the swap has been executed. Real V3 derives
    /// this from the trade size; tests set it directly so the tick-floor bound in
    /// TreasuryConverterV3.sellRsvd can be exercised at chosen distances from the TWAP.
    function setTickAfterSwap(int24 t) external {
        tickAfterSwap = t;
        movesTick = true;
    }

    address public lastRecipient;
    uint256 public lastAmountIn;
    uint256 public lastAmountOut;
    uint256 public lastAmountOutMinimum;

    constructor(address factory_) {
        factory = factory_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(params.deadline >= block.timestamp, "deadline");
        address pool = MockUniswapV3Factory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        require(pool != address(0), "no pool");

        IERC20(params.tokenIn).transferFrom(msg.sender, pool, params.amountIn);

        amountOut = (params.amountIn * rate) / 1e18;
        require(amountOut >= params.amountOutMinimum, "slippage");
        MockUniswapV3Pool(pool).payOut(params.tokenOut, params.recipient, amountOut);
        if (movesTick) MockUniswapV3Pool(pool).setTick(tickAfterSwap);

        lastRecipient = params.recipient;
        lastAmountIn = params.amountIn;
        lastAmountOut = amountOut;
        lastAmountOutMinimum = params.amountOutMinimum;
    }
}
