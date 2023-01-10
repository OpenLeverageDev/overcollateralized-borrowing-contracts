// SPDX-License-Identifier: BUSL-1.1
pragma solidity >0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) {
        mint(msg.sender, 10000000 ether);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
