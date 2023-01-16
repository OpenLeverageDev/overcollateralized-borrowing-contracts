// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.0 <0.9.0;

interface OPBuyBackInterface {
    function transferIn(address token, uint amount) external;
}