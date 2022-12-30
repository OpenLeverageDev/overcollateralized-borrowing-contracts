// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.0 <0.9.0;

import "../interfaces/OPBuyBackInterface.sol";
import "./MockToken.sol";

contract MockBuyBack is OPBuyBackInterface {
    function transferIn(address token, uint amount) external override {
        MockToken(token).transferFrom(msg.sender, address(this), amount);
    }
}
