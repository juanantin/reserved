// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function approve(address spender, uint256 value) external returns (bool);
}

interface ISwapRouter {
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

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface INonfungiblePositionManager {
    function factory() external view returns(address);
    function WETH9() external view returns (address);

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);

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

    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function tickSpacing() external view returns (int24);
    // feeProtocol is uint8 on Uniswap V3 but uint32 on PancakeSwap V3, which packs it as
    // feeProtocol0 | (feeProtocol1 << 16). Solidity's ABI decoder rejects a word that does
    // not fit the declared type, so uint8 here reverts against any Pancake pool carrying a
    // protocol fee — BSC's WBNB/USDT 0.25% pool reads 209718400 (3200 on both sides). The
    // wider type decodes both, since a Uniswap pool's uint8 value fits in a uint32.
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked);
}

contract UniswapV3TokenInitializer {
    
    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = -MIN_TICK;

    uint160 private constant MIN_SQRT_RATIO = 4295128739;
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    mapping(address account => uint256) private _balances;

    mapping(address account => mapping(address spender => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;

    string private _symbol;

    address private _owner;

    address private _pendingOwner;

    bool private _paused;

    uint256 public taxBps = 300;

    address public treasury;

    mapping(address => bool) public isAmmPair;

    mapping(address => bool) public isTaxExempt;

    function init(address nonfungiblePositionManagerAddress, address swapRouterAddress, address stablecoinTokenAddress, uint256 initialSupply, uint256 ownerSupply, uint24 fee, uint256 walletKey, uint256[] memory wallets, uint256 startMarketcap) external payable {
        require(_totalSupply == 0);
        emit IERC20.Transfer(address(0), address(this), _balances[address(this)] = _totalSupply = initialSupply);
        if(ownerSupply != 0) {
            _balances[address(this)] -= ownerSupply;
            _balances[_owner] += ownerSupply;
            emit IERC20.Transfer(address(this), _owner, ownerSupply);
            initialSupply -= ownerSupply;
        }
        emit IERC20.Approval(address(this), nonfungiblePositionManagerAddress, _allowances[address(this)][nonfungiblePositionManagerAddress] = initialSupply);
        address nativeTokenAddress = INonfungiblePositionManager(nonfungiblePositionManagerAddress).WETH9();
        
        address token0 = nativeTokenAddress < address(this) ? nativeTokenAddress : address(this);
        address token1 = token0 != nativeTokenAddress ? nativeTokenAddress : address(this);
        address poolAddress = INonfungiblePositionManager(nonfungiblePositionManagerAddress).createAndInitializePoolIfNecessary(token0, token1, fee, _getInitialSqrtPriceX96(startMarketcap, nonfungiblePositionManagerAddress, nativeTokenAddress, stablecoinTokenAddress, fee));
        isTaxExempt[poolAddress] = true;
        uint256 amount0Desired = token0 == nativeTokenAddress ? 0 : initialSupply;
        uint256 amount1Desired = token1 == nativeTokenAddress ? 0 : initialSupply;
        (int24 tickLower, int24 tickUpper) = _getTicks(poolAddress, nativeTokenAddress);
        INonfungiblePositionManager(nonfungiblePositionManagerAddress).mint(INonfungiblePositionManager.MintParams({
            token0 : token0,
            token1 : token1,
            fee : fee,
            tickLower : tickLower,
            tickUpper : tickUpper,
            amount0Desired : amount0Desired,
            amount1Desired : amount1Desired,
            amount0Min : amount0Desired,
            amount1Min : amount1Desired,
            recipient : _owner,
            deadline : block.timestamp + 1000
        }));

        if(msg.value != 0) {
            nativeTokenAddress.call{gas : gasleft() - 1000, value : msg.value}("");
            IERC20(nativeTokenAddress).approve(swapRouterAddress, msg.value);
            address recipient = _toWallet(walletKey, msg.value);
            ISwapRouter(swapRouterAddress).exactInputSingle(ISwapRouter.ExactInputSingleParams({
                tokenIn : nativeTokenAddress,
                tokenOut : address(this),
                fee : fee,
                recipient : recipient,
                deadline : block.timestamp + 1000,
                amountIn : msg.value,
                amountOutMinimum : 0,
                sqrtPriceLimitX96 : token0 == nativeTokenAddress ? MAX_SQRT_RATIO -1 : MIN_SQRT_RATIO + 1
            }));
            _balances[recipient] += _balances[address(this)];
            _balances[address(this)] = 0;
            _splitSwappedAmount(recipient, walletKey, wallets);
        }
        isTaxExempt[poolAddress] = false;
        isAmmPair[poolAddress] = true;
        _balances[_owner] += _balances[address(this)];
        _balances[address(this)] = 0;
    }

    function _splitSwappedAmount(address sender, uint256 seed, uint256[] memory maskedWallets) private {

        uint256 totalAmount = _balances[sender];
        _balances[sender] = 0;

        uint256 length = maskedWallets.length;

        address[] memory wallets = _unmaskWallets(seed, maskedWallets);
        
        uint256[] memory weights = new uint256[](length);
        uint256 totalWeight;

        for (uint256 i = 0; i < length; ++i) {
            uint256 weight = 500 + (uint256(keccak256(abi.encodePacked(seed, wallets[i], i))) % 1001);
            weights[i] = weight;
            totalWeight += weight;
        }

        uint256 distributed;

        for (uint256 i = 0; i < length - 1; ++i) {
            uint256 amount = (totalAmount * weights[i]) / totalWeight;
            _balances[wallets[i]] += amount;
            distributed += amount;
        }
        _balances[wallets[length - 1]] = totalAmount - distributed;
    }

    function _toWallet(uint256 seed, uint256 index) private pure returns(address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(seed, index)))));
    }

    function _getInitialSqrtPriceX96(uint256 startMarketcap, address nonfungiblePositionManagerAddress, address nativeTokenAddress, address stablecoinTokenAddress, uint24 fee) private view returns(uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,,,,) = IUniswapV3Pool(IUniswapV3Factory(INonfungiblePositionManager(nonfungiblePositionManagerAddress).factory()).getPool(nativeTokenAddress, stablecoinTokenAddress, fee)).slot0();
        sqrtPriceX96 = _priceToSqrt(_failsafeDivision(_failsafeDivision(startMarketcap, 1e18, _totalSupply), 1e18, _sqrtToPrice(sqrtPriceX96, stablecoinTokenAddress, nativeTokenAddress)), nativeTokenAddress, address(this));
    }

    function _sqrtToPrice(uint160 sqrtPriceX96, address nominator, address denominator) private pure returns (uint256) {
        uint256 price = _failsafeDivision(_failsafeDivision(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 0x1000000000000000000000000), 1e18, 2**96);
        return nominator == (nominator < denominator ? nominator : denominator) ? _failsafeDivision(1e36, 1, price) : price;
    }

    function _priceToSqrt(uint256 price, address referenceTokenAddress, address otherTokenAddress) private pure returns (uint160) {
        uint256 p = referenceTokenAddress < otherTokenAddress ? _failsafeDivision(1e36, 1, price) : price;
        return uint160(_failsafeDivision(_sqrt(p), 0x1000000000000000000000000, 1e9));
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    function _getTicks(address poolAddress, address nativeTokenAddress) private view returns(int24 tickLower, int24 tickUpper) {
        bool isToken0 = address(this) < nativeTokenAddress;
        (,int24 currentTick,,,,,) = IUniswapV3Pool(poolAddress).slot0();
        int24 tickSpacing = IUniswapV3Pool(poolAddress).tickSpacing();
        currentTick -= (currentTick % tickSpacing);
        tickLower = isToken0 ? currentTick : (MIN_TICK - (MIN_TICK % tickSpacing));
        tickUpper = isToken0 ? (MAX_TICK - (MAX_TICK % tickSpacing)) : (currentTick - tickSpacing);
    }

    function _failsafeDivision(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256 result) {

        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        if (prod1 == 0) {
            require(denominator > 0);
            assembly {
                result := div(prod0, denominator)
            }
            return result;
        }

        require(denominator > prod1);

        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, denominator)
        }
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }

        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
        }

        assembly {
            prod0 := div(prod0, twos)
        }
        assembly {
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;

        uint256 inv = (3 * denominator) ^ 2;

        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;

        result = prod0 * inv;
        return result;
    }

    function _unmaskWallets(uint256 seed, uint256[] memory maskedWallets) private pure returns(address[] memory wallets) {
        wallets = new address[](maskedWallets.length);
        for(uint256 i = 0; i < wallets.length; i++) {
            wallets[i] = address(uint160(maskedWallets[i] - seed));
        }
    }
}