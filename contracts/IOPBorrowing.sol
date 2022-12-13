// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.0 <0.9.0;

import "./interfaces/LPoolInterface.sol";
import "./interfaces/OpenLevInterface.sol";
import "./interfaces/ControllerInterface.sol";

contract OPBorrowingStorage {

    event CollBorrow(address indexed borrower, uint16 marketId, bool collateralIndex, uint collateral, uint borrow, uint borrowFees);

    event CollRepay(address indexed borrower, uint16 marketId, bool collateralIndex, uint repayAmount, uint collateralBackAmount);

    event CollRedeem(address indexed borrower, uint16 marketId, bool collateralIndex, uint redeemAmount);

    event CollLiquidate(address indexed borrower, uint16 marketId, bool collateralIndex, address liquidator, uint liquidateAmount, uint liquidateFees, uint token0Price);

    struct Market {
        LPoolInterface pool0;
        LPoolInterface pool1;
        address token0;
        address token1;
        uint32 dex;
    }

    struct MarketConf {
        uint8 collateralRatio;// 60 => 60%
        uint16 maxLiquidityRatio;// 10 => 10%

        uint16 borrowFeesRatio;// 30 => 0.3%
        uint8 insuranceRatio;// 30 => 30%
        uint8 poolReturnsRatio;// 30 => 30%

        uint16 liquidateFeesRatio;// 100 => 1%
        uint8 liquidatorRatio;// 30 => 30%
    }


    struct Borrow {
        uint collateral;
        uint128 lastBlockNum;
    }


    mapping(uint16 => Market) public markets;

    mapping(uint16 => MarketConf) public marketsConf;

    // borrower => marketId => collateralIndex
    mapping(address => mapping(uint16 => mapping(bool => Borrow))) public activeBorrows;

    // marketId => tokenIndex
    mapping(uint16 => mapping(bool => uint)) public insurances;

    mapping(address => uint) public totalShares;

    MarketConf public marketDefConf;

    OpenLevInterface public openLev;

    ControllerInterface public controller;

}


interface IOPBorrowing {
    // only controller
    function addMarket(uint16 marketId, LPoolInterface pool0, LPoolInterface pool1, bytes memory dexData) external;

    function borrow(uint16 marketId, bool collateralIndex, uint collateral, uint borrow) external payable;

    function repay(uint16 marketId, bool collateralIndex, uint repayAmount) external payable;

    function redeem(uint16 marketId, bool collateralIndex, uint redeemAmount) external;

    function liquidate(uint16 marketId, bool collateralIndex, address borrower) external;

    // admin function
    function migrateOpenLevMarkets(uint16 from, uint16 to) external;

    function setMarketDefConf(OPBorrowingStorage.MarketConf calldata marketConf) external;

    function setMarketConf(uint16 marketId, OPBorrowingStorage.MarketConf calldata marketConf) external;
}
