// SPDX-License-Identifier: BUSL-1.1

pragma solidity >0.7.6;

import "../interfaces/XOLEInterface.sol";

contract MockXOLE is XOLEInterface {
    mapping(address => uint256) private _balances;

    function mint(uint amount) external {
        _balances[msg.sender] += amount;
    }

    function balanceOf(
        address account
    ) external view override returns (uint256) {
        return _balances[account];
    }
}
