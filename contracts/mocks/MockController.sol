// SPDX-License-Identifier: BUSL-1.1

pragma solidity >0.7.6;

import "../interfaces/ControllerInterface.sol";

contract MockController is ControllerInterface {
    uint public borrowCounter;
    uint public repayCounter;
    uint public redeemCounter;
    uint public liquidateCounter;

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
