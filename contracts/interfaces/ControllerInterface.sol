// SPDX-License-Identifier: BUSL-1.1

pragma solidity >0.7.6;

interface ControllerInterface {
    function collBorrowAllowed(uint marketId, address borrower, bool collateralIndex) external;

    function collRepayAllowed(uint marketId) external;

    function collRedeemAllowed(uint marketId) external;

    function collLiquidateAllowed(uint marketId) external;
}
