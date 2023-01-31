// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.17;

import "../interfaces/ControllerInterface.sol";
import "../IOPBorrowing.sol";
import "./MockLPool.sol";

contract MockController is ControllerInterface {
    bool public suspend;
    IOPBorrowing public borrowing;
    uint16 private _marketId;
    uint public borrowRateOfPerBlock;

    function setOPBorrowing(IOPBorrowing _borrowing) external {
        borrowing = _borrowing;
    }

    function setBorrowRateOfPerBlock(uint _borrowRateOfPerBlock) external {
        borrowRateOfPerBlock = _borrowRateOfPerBlock;
    }

    function setSuspend(bool _suspend) external {
        suspend = _suspend;
    }

    function createLPoolPair(address tokenA, address tokenB, uint16 marginLimit, bytes memory dexData) external {
        marginLimit;
        MockLPool pool0 = new MockLPool(tokenA, borrowRateOfPerBlock);
        MockLPool pool1 = new MockLPool(tokenB, borrowRateOfPerBlock);

        borrowing.addMarket(_marketId, pool0, pool1, dexData);
        _marketId++;
    }

    function collBorrowAllowed(
        uint marketId,
        address borrower,
        bool collateralIndex
    ) external view override onlyOpBorrowingNotSuspended(marketId) returns (bool) {
        borrower;
        collateralIndex;
        return true;
    }

    function collRepayAllowed(uint marketId) external view override onlyOpBorrowingNotSuspended(marketId) returns (bool) {
        return true;
    }

    function collRedeemAllowed(uint marketId) external view override onlyOpBorrowingNotSuspended(marketId) returns (bool) {
        return true;
    }

    function collLiquidateAllowed(uint marketId) external view override onlyOpBorrowingNotSuspended(marketId) returns (bool) {
        return true;
    }

    modifier onlyOpBorrowingNotSuspended(uint marketId) {
        require(!suspend, "Suspended borrowing");
        _;
    }
}
