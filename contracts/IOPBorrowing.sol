// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.0 <0.9.0;

import "./interfaces/LPoolInterface.sol";
import "./interfaces/OpenLevInterface.sol";
import "./interfaces/ControllerInterface.sol";
import "./interfaces/DexAggregatorInterface.sol";
import "./interfaces/XOLEInterface.sol";
import "./interfaces/OPBuyBackInterface.sol";

contract OPBorrowingStorage {
    event NewMarket(uint16 marketId, LPoolInterface pool0, LPoolInterface pool1, address token0, address token1, uint32 dex, uint token0Liq, uint token1Liq);

    event CollBorrow(address indexed borrower, uint16 marketId, bool collateralIndex, uint collateral, uint borrow, uint borrowFees);

    event CollRepay(address indexed borrower, uint16 marketId, bool collateralIndex, uint repayAmount, uint collateral);

    event CollRedeem(address indexed borrower, uint16 marketId, bool collateralIndex, uint collateral);

    event CollLiquidate(address indexed borrower, uint16 marketId, bool collateralIndex, address liquidator, uint collateralDecrease, uint repayAmount, uint outstandingAmount, uint liquidateFees, uint token0Price);

    event NewLiquidity(uint16 marketId, uint oldToken0Liq, uint oldToken1Liq, uint newToken0Liq, uint newToken1Liq);

    event NewMarketConf(
        uint16 marketId,
        uint16 collateralRatio,
        uint16 maxLiquidityRatio,
        uint16 borrowFeesRatio,
        uint16 insuranceRatio,
        uint16 poolReturnsRatio,
        uint16 liquidateFeesRatio,
        uint16 liquidatorReturnsRatio,
        uint16 liquidateInsuranceRatio,
        uint16 liquidatePoolReturnsRatio,
        uint16 liquidateMaxLiquidityRatio,
        uint16 twapDuration
    );

    struct Market {
        LPoolInterface pool0;
        LPoolInterface pool1;
        address token0;
        address token1;
        uint32 dex;
    }

    struct MarketConf {
        uint16 collateralRatio; // 6000 => 60%
        uint16 maxLiquidityRatio; // 1000 => 10%
        uint16 borrowFeesRatio; // 30 => 0.3%
        uint16 insuranceRatio; // 3000 => 30%
        uint16 poolReturnsRatio; // 3000 => 30%
        uint16 liquidateFeesRatio; // 100 => 1%
        uint16 liquidatorReturnsRatio; // 3000 => 30%
        uint16 liquidateInsuranceRatio; // 3000 => 30%
        uint16 liquidatePoolReturnsRatio; // 3000 => 30%
        uint16 liquidateMaxLiquidityRatio; // 1000=> 10%
        uint16 twapDuration; // 60 =>60s
    }

    struct Borrow {
        uint collateral;
        uint128 lastBlockNum;
    }

    struct Liquidity {
        uint token0Liq;
        uint token1Liq;
    }

    struct Insurance {
        uint insurance0;
        uint insurance1;
    }

    struct LiquidationConf {
        uint128 liquidatorXOLEHeld;
        uint8 priceDiffRatio; // 10 => 10%
        OPBuyBackInterface buyBack;
    }

    uint internal constant RATIO_DENOMINATOR = 10000;

    address public immutable wETH;

    OpenLevInterface public immutable openLev;

    ControllerInterface public immutable controller;

    DexAggregatorInterface public immutable dexAgg;

    XOLEInterface public immutable xOLE;

    mapping(uint16 => Market) public markets;

    mapping(uint16 => MarketConf) public marketsConf;

    // borrower => marketId => collateralIndex
    mapping(address => mapping(uint16 => mapping(bool => Borrow))) public activeBorrows;

    mapping(uint16 => Insurance) public insurances;

    // time weighted average liquidity
    mapping(uint16 => Liquidity) public twaLiquidity;

    // token => shares
    mapping(address => uint) public totalShares;

    MarketConf public marketDefConf;

    LiquidationConf public liquidationConf;

    constructor(OpenLevInterface _openLev,
        ControllerInterface _controller,
        DexAggregatorInterface _dexAgg,
        XOLEInterface _xOLE,
        address _wETH){
        openLev = _openLev;
        controller = _controller;
        dexAgg = _dexAgg;
        xOLE = _xOLE;
        wETH = _wETH;
    }
}

interface IOPBorrowing {
    function initialize(
        OPBorrowingStorage.MarketConf memory _marketDefConf,
        OPBorrowingStorage.LiquidationConf memory _liquidationConf
    ) external;

    // only controller
    function addMarket(uint16 marketId, LPoolInterface pool0, LPoolInterface pool1, bytes memory dexData) external;

    function borrow(uint16 marketId, bool collateralIndex, uint collateral, uint borrowing) external payable;

    function repay(uint16 marketId, bool collateralIndex, uint repayAmount, bool isRedeem) external payable;

    function redeem(uint16 marketId, bool collateralIndex, uint collateral) external;

    function liquidate(uint16 marketId, bool collateralIndex, address borrower) external;

    /*** Admin Functions ***/
    function migrateOpenLevMarkets(uint16 from, uint16 to) external;

    function setTwaLiquidity(uint16[] calldata marketIds, OPBorrowingStorage.Liquidity[] calldata liquidity) external;

    function setMarketDefConf(OPBorrowingStorage.MarketConf calldata _marketConf) external;

    function setMarketConf(uint16 marketId, OPBorrowingStorage.MarketConf calldata _marketConf) external;

    function setLiquidationConf(OPBorrowingStorage.LiquidationConf calldata _liquidationConf) external;

    function moveInsurance(uint16 marketId, bool poolIndex, address to, uint moveShare) external;
}
