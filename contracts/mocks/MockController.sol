// SPDX-License-Identifier: BUSL-1.1

pragma solidity >0.7.6;

import "../interfaces/ControllerInterface.sol";
import "../IOPBorrowing.sol";
import "./MockLPool.sol";

contract MockController is ControllerInterface {
    uint public borrowCounter;
    uint public repayCounter;
    uint public redeemCounter;
    uint public liquidateCounter;
    IOPBorrowing public borrowing;
    uint16 private _marketId;
    uint public borrowRateOfPerBlock;

    function setOPBorrowing(IOPBorrowing _borrowing) external {
        borrowing = _borrowing;
    }

    function setBorrowRateOfPerBlock(uint _borrowRateOfPerBlock) external {
        borrowRateOfPerBlock = _borrowRateOfPerBlock;
    }

    function createLPoolPair(address tokenA, address tokenB, uint16 marginLimit, bytes memory dexData) external {
        marginLimit;
        MockLPool pool0 = new MockLPool(tokenA, borrowRateOfPerBlock);
        MockLPool pool1 = new MockLPool(tokenB, borrowRateOfPerBlock);

        borrowing.addMarket(_marketId, pool0, pool1, dexData);
        _marketId++;
    }

    function collBorrowAllowed(uint marketId, address borrower, bool collateralIndex) external override {
        borrowCounter++;
        marketId;
        borrower;
        collateralIndex;
    }

    function collRepayAllowed(uint marketId) external override {
        repayCounter++;
        marketId;
    }

    function collRedeemAllowed(uint marketId) external override {
        redeemCounter++;
        marketId;
    }

    function collLiquidateAllowed(uint marketId) external override {
        liquidateCounter++;
        marketId;
    }
}
